/**
 * Shared helpers for bank-statement adapters (Axis, KVB, …). Bank exports differ from Paytm in two
 * structural ways this module smooths over:
 *   1. a metadata preamble sits ABOVE the real header row, so we locate the header in the raw matrix;
 *   2. transfers to the user's OWN accounts must be recognised (by the account-holder name) so they
 *      can be marked as self-transfers rather than counted as spend/income.
 *
 * Pure TypeScript (no RN imports) — unit-testable in Node.
 */

import type { RawRow } from '../types';

/** Lower-case and strip every non-alphanumeric char: "KOTHA NIKHIL" → "kothanikhil". */
export function compactName(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * True when a counterparty name looks like the account holder (a transfer to one's own account).
 * Bank statements often TRUNCATE the name, so we accept an exact match or either being a prefix of
 * the other (guarded by a min length so short tokens don't match by accident).
 */
export function looksLikeSelf(counterparty: string | null, holder: string | null): boolean {
  const a = compactName(counterparty);
  const b = compactName(holder);
  if (a.length < 6 || b.length < 6) return a !== '' && a === b;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/** A UPI RRN / bank reference token: a run of 6–20 digits. */
export function isRefNumber(token: string | null | undefined): boolean {
  return !!token && /^\d{6,20}$/.test(token.trim());
}

/**
 * Find the header row inside a sheet matrix: the first row whose (lower-cased) cells contain ALL
 * the given tokens. Returns -1 when not found.
 */
export function findHeaderIndex(matrix: string[][], requiredTokens: string[]): number {
  const tokens = requiredTokens.map((t) => t.toLowerCase());
  for (let i = 0; i < matrix.length; i++) {
    const cells = matrix[i].map((c) => c.toLowerCase().trim());
    if (tokens.every((t) => cells.some((c) => c.includes(t)))) return i;
  }
  return -1;
}

/**
 * Build header-keyed {@link RawRow}s for the data rows below `headerIdx`, keeping only those the
 * `isDataRow` predicate accepts (used to stop at the trailing legend/notes). `extraCells` are
 * merged into every row (e.g. the account-holder name for self-detection).
 */
export function keyedRowsBelow(
  matrix: string[][],
  headerIdx: number,
  isDataRow: (cells: Record<string, string>) => boolean,
  extraCells: Record<string, string> = {},
): RawRow[] {
  const headers = matrix[headerIdx].map((h) => h.trim());
  const out: RawRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const cells: Record<string, string> = { ...extraCells };
    headers.forEach((h, idx) => {
      if (h !== '') cells[h] = matrix[i][idx] ?? '';
    });
    if (isDataRow(cells)) out.push({ cells, rowNumber: i + 1 });
  }
  return out;
}

/** Read a cell by the first header that contains any of the given substrings (case-insensitive). */
export function field(cells: Record<string, string>, ...substrings: string[]): string {
  const keys = Object.keys(cells);
  for (const sub of substrings) {
    const lower = sub.toLowerCase();
    const key = keys.find((k) => k.toLowerCase().includes(lower));
    if (key) return (cells[key] ?? '').trim();
  }
  return '';
}

/** The synthetic holder-name cell key injected into bank rows for self-transfer detection. */
export const HOLDER_CELL = '__holder';
