/**
 * Pure helpers for local backup/restore (Step 8, local part).
 *
 * A backup is just the app's SQLite database file. These helpers name the backup and sanity-check
 * that a file the user hands back for restore is actually a SQLite database (so we don't wipe the
 * live data with garbage). No React Native / filesystem here — unit-tested in Node.
 */

// Every SQLite 3 file starts with the 16 bytes "SQLite format 3\0" (15 ASCII chars + a NUL).
const SQLITE_MAGIC_TEXT = 'SQLite format 3';

/** True if the bytes begin with the SQLite 3 file header. */
export function isSqliteFile(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  for (let i = 0; i < SQLITE_MAGIC_TEXT.length; i++) {
    if (bytes[i] !== SQLITE_MAGIC_TEXT.charCodeAt(i)) return false;
  }
  return bytes[15] === 0; // the terminating NUL byte
}

/** The tables a valid Finance Tracker backup must contain (checked before a restore overwrites data). */
export const REQUIRED_TABLES = [
  'categories',
  'subcategories',
  'payment_modes',
  'people',
  'transactions',
  'category_rules',
] as const;

/** True if every required table is present in the given list of table names. */
export function hasRequiredTables(tableNames: string[]): boolean {
  const present = new Set(tableNames);
  return REQUIRED_TABLES.every((t) => present.has(t));
}

/** Parts of a timestamp used to name a backup (all numbers; month/day are 1-based). */
export interface StampParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Backup filename, e.g. `FinanceTracker-backup-2026-08-16-0815.db` (sorts chronologically). */
export function backupFileName(s: StampParts): string {
  const p = (n: number, len = 2) => String(n).padStart(len, '0');
  return `FinanceTracker-backup-${p(s.year, 4)}-${p(s.month)}-${p(s.day)}-${p(s.hour)}${p(s.minute)}.db`;
}
