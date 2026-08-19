/**
 * Translates a {@link TxnFilter} into a Drizzle SQL `WHERE` condition, so the transaction list,
 * the count, the aggregates, and the Excel export all filter server-side from ONE definition —
 * mirroring the pure {@link matchesFilter} predicate (the tested spec) exactly.
 *
 * This lives under `services/db/` (not in the pure `core/analytics` layer) so `core/` stays free
 * of Drizzle/schema imports. It's still framework-free and unit-tested by compiling the returned
 * condition with Drizzle's `SQLiteSyncDialect` and asserting the SQL text + params.
 *
 * Convention (same as the filter type): a field `undefined` = no constraint; `null` = the empty
 * bucket (uncategorized / no sub-category / not-assigned).
 */

import { and, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

import type { MonthKey, TxnFilter } from '@/core/analytics';
import { transactions as t } from '@/core/db/schema';

/** Zero-pad a 1-based month to two digits. */
function pad(month: number): string {
  return String(month).padStart(2, '0');
}

/** Inclusive lower date bound (`YYYY-MM-01`) for a month — dates are fixed-width `YYYY-MM-DD`. */
function monthStart(m: MonthKey): string {
  return `${m.year}-${pad(m.month)}-01`;
}

/**
 * Inclusive upper date bound for a month. `-31` is a safe lexicographic ceiling: every valid day
 * `01..31` sorts ≤ `31`, and the next month's `-01` sorts higher, so no neighbouring date leaks in.
 */
function monthEnd(m: MonthKey): string {
  return `${m.year}-${pad(m.month)}-31`;
}

/** Escape LIKE wildcards (`%` `_`) and the escape char itself in a user search term. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** A case-insensitive LIKE across the searchable text columns (raw `sql` so we get ESCAPE). */
function searchCondition(term: string): SQL {
  const like = `%${escapeLike(term)}%`;
  return sql`(${t.counterpartyName} like ${like} escape '\\' or ${t.rawDetails} like ${like} escape '\\' or ${t.counterpartyVpa} like ${like} escape '\\' or ${t.remarks} like ${like} escape '\\' or ${t.rawTag} like ${like} escape '\\')`;
}

/** An equality/`IS NULL` condition honouring the `null = empty bucket` convention. */
function eqOrNull(col: AnySQLiteColumn, value: number | null): SQL {
  return value === null ? isNull(col) : eq(col, value);
}

/**
 * Build the `WHERE` condition for a filter, or `undefined` when nothing is constrained (so
 * `.where(undefined)` is a no-op). Only fields that are set contribute a clause.
 */
export function buildTxnConditions(f: TxnFilter): SQL | undefined {
  const parts: (SQL | undefined)[] = [];

  if (f.from) parts.push(gte(t.isoDate, monthStart(f.from)));
  if (f.to) parts.push(lte(t.isoDate, monthEnd(f.to)));
  if (f.categoryId !== undefined) parts.push(eqOrNull(t.categoryId, f.categoryId));
  if (f.subcategoryId !== undefined) parts.push(eqOrNull(t.subcategoryId, f.subcategoryId));
  if (f.personId !== undefined) parts.push(eqOrNull(t.personId, f.personId));
  if (f.account !== undefined) parts.push(eq(t.accountName, f.account));
  if (f.direction !== undefined) parts.push(eq(t.direction, f.direction));
  if (f.isRefund !== undefined) parts.push(eq(t.isRefund, f.isRefund));
  if (f.needsReview !== undefined) parts.push(eq(t.needsReview, f.needsReview));
  if (f.since !== undefined) parts.push(gte(t.createdAt, f.since));

  const q = f.search?.trim();
  if (q) parts.push(searchCondition(q));

  const set = parts.filter((p): p is SQL => p !== undefined);
  if (set.length === 0) return undefined;
  return set.length === 1 ? set[0] : and(...set);
}
