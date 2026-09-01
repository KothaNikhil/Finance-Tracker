/**
 * The import pipeline: parsed sheets → normalized transactions → duplicates removed → a
 * preview the user confirms before saving. Auto-categorization (Step 4) and the actual
 * database save (Step 2) plug in on top of this later.
 */

import { categorize } from '../categorize/categorize';
import type {
  CategoryIndex,
  Confidence,
  LearnedRule,
  SuggestionVia,
} from '../categorize/types';
import { partitionDuplicates } from './dedupe';
import type { NormalizedTxn, SheetLike, SourceAdapter } from './types';

/** One row that could not be parsed, with why. */
export interface ImportRowError {
  rowNumber: number;
  message: string;
}

/** What the preview screen shows and the commit step consumes. */
export interface ImportPreview {
  source: string;
  /** Total data rows found in the chosen sheet. */
  totalRows: number;
  /** Rows that parsed successfully (including salvaged rows kept as needs-review). */
  parsed: NormalizedTxn[];
  /** New transactions to save. */
  newTxns: NormalizedTxn[];
  /** Rows skipped as duplicates (already stored, or repeated within the file). */
  duplicates: NormalizedTxn[];
  /** Rows kept only via `salvage` (couldn't be fully read) — a subset of `parsed`, for the summary. */
  salvaged: NormalizedTxn[];
  /** Rows that could not be parsed OR salvaged (genuinely not transactions). */
  errors: ImportRowError[];
  /** Statement debit total (paise) over all parsed rows — for reconciliation against the bank. */
  totalDebitPaise: number;
  /** Statement credit total (paise) over all parsed rows. */
  totalCreditPaise: number;
}

/** One side-effect-free category/review projection shown before Save. */
export interface ImportPreviewRow {
  txn: NormalizedTxn;
  categoryId: number | null;
  subcategoryId: number | null;
  /** Resolved category name at preview time, including emoji/subcategory when available. */
  categoryLabel: string | null;
  confidence: Confidence;
  needsReview: boolean;
  via: SuggestionVia;
  reason: string;
}

/** Dry-run enrichment for all new rows. It never writes transactions or learned rules. */
export interface ImportDryRun {
  rows: ImportPreviewRow[];
  reviewCount: number;
}

/** Pick the adapter that recognizes these sheets. */
export function chooseAdapter(sheets: SheetLike[], adapters: readonly SourceAdapter[]): SourceAdapter {
  const adapter = adapters.find((a) => a.detect(sheets));
  if (!adapter) {
    throw new Error('Could not recognize this file. No matching statement reader was found.');
  }
  return adapter;
}

/**
 * Run the import over already-parsed sheets.
 * `existingKeys` are dedupe keys already in the database (empty on a first import).
 *
 * A row that `normalize` rejects is handed to the adapter's `salvage` (if any) so it's kept as a
 * needs-review transaction rather than silently dropped — only rows that aren't transactions at
 * all become `errors`.
 */
export function runImport(
  sheets: SheetLike[],
  adapters: readonly SourceAdapter[],
  existingKeys: ReadonlySet<string> = new Set(),
): ImportPreview {
  const adapter = chooseAdapter(sheets, adapters);
  const sheet = adapter.selectSheet(sheets);
  const dataRows = adapter.rows ? adapter.rows(sheet) : sheet.rows;

  const parsed: NormalizedTxn[] = [];
  const salvaged: NormalizedTxn[] = [];
  const errors: ImportRowError[] = [];

  for (const row of dataRows) {
    try {
      parsed.push(adapter.normalize(row));
    } catch (err) {
      const rescued = adapter.salvage?.(row) ?? null;
      if (rescued) {
        parsed.push(rescued);
        salvaged.push(rescued);
      } else {
        errors.push({
          rowNumber: row.rowNumber,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const { unique, duplicates } = partitionDuplicates(parsed, existingKeys);

  let totalDebitPaise = 0;
  let totalCreditPaise = 0;
  for (const txn of parsed) {
    if (txn.ledgerSide === 'debit') totalDebitPaise += txn.paise;
    else if (txn.ledgerSide === 'credit') totalCreditPaise += txn.paise;
  }

  return {
    source: adapter.source,
    totalRows: dataRows.length,
    parsed,
    newTxns: unique,
    duplicates,
    salvaged,
    errors,
    totalDebitPaise,
    totalCreditPaise,
  };
}

/**
 * Apply the same pure categorizer inputs used by the save path without touching the database.
 *
 * Callers provide snapshots of the current category index and learned rules. Self-transfers and
 * person-to-person sends are forced into review here exactly as they are in `saveTransactions`, so
 * the preview count remains honest while Save stays the only operation that persists anything.
 */
export function dryRunImportPreview(
  preview: Pick<ImportPreview, 'newTxns'>,
  index: CategoryIndex,
  learned: readonly LearnedRule[] = [],
): ImportDryRun {
  let reviewCount = 0;
  const learnedRules = [...learned];
  const rows = preview.newTxns.map((txn): ImportPreviewRow => {
    const suggestion = categorize(
      {
        kind: txn.kind,
        direction: txn.direction,
        rawTag: txn.rawTag,
        counterpartyName: txn.counterpartyName,
        counterpartyVpa: txn.counterpartyVpa,
        rawDetails: txn.rawDetails,
        remarks: txn.remarks,
      },
      index,
      learnedRules,
    );
    const needsReview =
      suggestion.needsReview || txn.kind === 'self' || txn.kind === 'sent';
    if (needsReview) reviewCount++;

    const category =
      suggestion.categoryId == null ? null : index.byId.get(suggestion.categoryId) ?? null;
    const subcategory =
      category && suggestion.subcategoryId != null
        ? category.subcategories.find((item) => item.id === suggestion.subcategoryId) ?? null
        : null;
    const categoryLabel = category
      ? `${category.emoji ? `${category.emoji} ` : ''}${category.name}${
          subcategory ? ` · ${subcategory.name}` : ''
        }`
      : null;

    return {
      txn,
      categoryId: suggestion.categoryId,
      subcategoryId: suggestion.subcategoryId,
      categoryLabel,
      confidence: suggestion.confidence,
      needsReview,
      via: suggestion.via,
      reason: suggestion.reason,
    };
  });

  return { rows, reviewCount };
}
