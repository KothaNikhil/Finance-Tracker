/**
 * The transaction filter that drives the Reports workspace AND the Excel export (Block B). One
 * predicate, one filtered set — so "what you see" on Reports and "what you export" can never drift
 * apart. Pure and unit-tested; the UI supplies the filter and the export reuses it.
 *
 * Convention: an **undefined** field means "no constraint on this dimension". A **null** field
 * means "the empty bucket" — uncategorized, no sub-category, or not-assigned-to-a-person.
 */

import type { Direction } from '../domain/money';

/** A calendar month, 1-based (month 1 = January). */
export interface MonthKey {
  year: number;
  month: number;
}

/** A transaction filter. Date bounds are inclusive and by whole month (statements are monthly). */
export interface TxnFilter {
  /** Inclusive earliest month; omit for open-ended (from the beginning of history). */
  from?: MonthKey;
  /** Inclusive latest month; omit for open-ended (to the end of history). */
  to?: MonthKey;
  /** Category id, `null` for uncategorized, `undefined` for any. */
  categoryId?: number | null;
  /** Sub-category id, `null` for "no sub-category", `undefined` for any. */
  subcategoryId?: number | null;
  /** Exact funding account name; `undefined` for any. */
  account?: string;
  /** "For" person id, `null` for "not assigned", `undefined` for any. */
  personId?: number | null;
  /** Money direction (`in`/`out`/`self`); `undefined` for any. */
  direction?: Direction;
  /** Only rows still flagged "needs review" when `true`; `undefined` for any. */
  needsReview?: boolean;
  /**
   * Free-text search, matched case-insensitively across the counterparty name, the original
   * statement text, the counterparty UPI id, the user's note (remarks) and the Paytm tag.
   * `undefined`/empty means no constraint.
   */
  search?: string;
}

/** The minimal transaction shape the predicate needs — satisfied by both the stored row and AnalyticsTxn. */
export interface FilterableTxn {
  isoDate: string;
  direction: Direction;
  categoryId: number | null;
  subcategoryId: number | null;
  accountName: string | null;
  personId: number | null;
  /** Original statement text — one of the fields free-text search matches against. */
  rawDetails: string | null;
  /** Counterparty UPI id — also matched by free-text search. */
  counterpartyVpa: string | null;
  /** Counterparty display name — also matched by free-text search. */
  counterpartyName: string | null;
  /** The user's note on the transaction — also matched by free-text search. */
  remarks: string | null;
  /** The Paytm tag — also matched by free-text search. */
  rawTag: string | null;
  /** Whether the row is still flagged "needs review". */
  needsReview: boolean;
}

/** A month as a single comparable ordinal (year*12 + month index), so ranges are simple integer compares. */
function ordinal(key: MonthKey): number {
  return key.year * 12 + (key.month - 1);
}

/** The `MonthKey` an ISO date (`YYYY-MM-DD`) falls in. */
export function monthKeyOf(isoDate: string): MonthKey {
  return { year: parseInt(isoDate.slice(0, 4), 10), month: parseInt(isoDate.slice(5, 7), 10) };
}

/** True when a transaction satisfies every set constraint in the filter. */
export function matchesFilter(txn: FilterableTxn, filter: TxnFilter): boolean {
  const o = ordinal(monthKeyOf(txn.isoDate));
  if (filter.from && o < ordinal(filter.from)) return false;
  if (filter.to && o > ordinal(filter.to)) return false;
  if (filter.categoryId !== undefined && txn.categoryId !== filter.categoryId) return false;
  if (filter.subcategoryId !== undefined && txn.subcategoryId !== filter.subcategoryId) return false;
  if (filter.account !== undefined && txn.accountName !== filter.account) return false;
  if (filter.personId !== undefined && txn.personId !== filter.personId) return false;
  if (filter.direction !== undefined && txn.direction !== filter.direction) return false;
  if (filter.needsReview !== undefined && txn.needsReview !== filter.needsReview) return false;
  if (!matchesSearch(txn, filter.search)) return false;
  return true;
}

/**
 * Case-insensitive substring match across the counterparty name, original statement text, and
 * UPI id. Empty/undefined search matches everything. This is the JS spec the SQL `LIKE` builder
 * mirrors, so "what you see" and "what you export" agree.
 */
function matchesSearch(txn: FilterableTxn, search: string | undefined): boolean {
  const q = search?.trim().toLowerCase();
  if (!q) return true;
  return (
    (txn.counterpartyName?.toLowerCase().includes(q) ?? false) ||
    (txn.rawDetails?.toLowerCase().includes(q) ?? false) ||
    (txn.counterpartyVpa?.toLowerCase().includes(q) ?? false) ||
    (txn.remarks?.toLowerCase().includes(q) ?? false) ||
    (txn.rawTag?.toLowerCase().includes(q) ?? false)
  );
}

/** Keep only the transactions matching the filter (preserves input order). */
export function filterTxns<T extends FilterableTxn>(txns: T[], filter: TxnFilter): T[] {
  return txns.filter((t) => matchesFilter(t, filter));
}

/** True when the filter constrains nothing (everything matches) — used to hide the "clear" affordance. */
export function isEmptyFilter(filter: TxnFilter): boolean {
  return (
    filter.from === undefined &&
    filter.to === undefined &&
    filter.categoryId === undefined &&
    filter.subcategoryId === undefined &&
    filter.account === undefined &&
    filter.personId === undefined &&
    filter.direction === undefined &&
    filter.needsReview === undefined &&
    (filter.search === undefined || filter.search.trim() === '')
  );
}
