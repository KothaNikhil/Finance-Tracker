/**
 * The import pipeline: parsed sheets → normalized transactions → duplicates removed → a
 * preview the user confirms before saving. Auto-categorization (Step 4) and the actual
 * database save (Step 2) plug in on top of this later.
 */

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

/** Pick the adapter that recognizes these sheets. */
export function chooseAdapter(sheets: SheetLike[], adapters: SourceAdapter[]): SourceAdapter {
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
  adapters: SourceAdapter[],
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
