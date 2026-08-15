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
  /** Rows that parsed successfully. */
  parsed: NormalizedTxn[];
  /** New transactions to save. */
  newTxns: NormalizedTxn[];
  /** Rows skipped as duplicates (already stored, or repeated within the file). */
  duplicates: NormalizedTxn[];
  /** Rows that failed to parse (bad date/amount, etc.). */
  errors: ImportRowError[];
}

/** Pick the adapter that recognizes these sheets. */
export function chooseAdapter(sheets: SheetLike[], adapters: SourceAdapter[]): SourceAdapter {
  const names = sheets.map((s) => s.name);
  const adapter = adapters.find((a) => a.detect(names));
  if (!adapter) {
    throw new Error('Could not recognize this file. No matching statement reader was found.');
  }
  return adapter;
}

/**
 * Run the import over already-parsed sheets.
 * `existingKeys` are dedupe keys already in the database (empty on a first import).
 */
export function runImport(
  sheets: SheetLike[],
  adapters: SourceAdapter[],
  existingKeys: ReadonlySet<string> = new Set(),
): ImportPreview {
  const adapter = chooseAdapter(sheets, adapters);
  const sheet = adapter.selectSheet(sheets);

  const parsed: NormalizedTxn[] = [];
  const errors: ImportRowError[] = [];

  for (const row of sheet.rows) {
    try {
      parsed.push(adapter.normalize(row));
    } catch (err) {
      errors.push({
        rowNumber: row.rowNumber,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const { unique, duplicates } = partitionDuplicates(parsed, existingKeys);

  return {
    source: adapter.source,
    totalRows: sheet.rows.length,
    parsed,
    newTxns: unique,
    duplicates,
    errors,
  };
}
