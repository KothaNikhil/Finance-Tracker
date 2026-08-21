/**
 * Spend-dashboard aggregations (Step 5). Pure functions over a list of {@link AnalyticsTxn}.
 *
 * See {@link ./types} for the two invariants enforced here: self-transfers are excluded from
 * every total, and refunds/cashback offset spend rather than counting as income.
 */

import { isPrincipal } from '../lending/roles';
import type {
  AnalyticsTxn,
  CategorySpend,
  MonthPoint,
  PeriodFilter,
  PeriodTotals,
  SubcategorySpend,
  YearPoint,
} from './types';

/** Short month names, indexed 0 = Jan … 11 = Dec. */
export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** A period-totals accumulator with a zero starting point. */
function emptyTotals(): PeriodTotals {
  return { spentPaise: 0, receivedPaise: 0, refundPaise: 0, netSpentPaise: 0, txnCount: 0 };
}

/**
 * Fold one transaction into a totals accumulator.
 * Self-transfers, and lending PRINCIPAL (lend/borrow/repay), contribute nothing — they're transfers,
 * not spend or income. Interest and gifts/donations DO count. `netSpentPaise` = spent − refund.
 */
function addTxn(t: PeriodTotals, txn: AnalyticsTxn): void {
  if (txn.direction === 'self') return;
  if (isPrincipal(txn.transferRole)) return;

  if (txn.direction === 'out') {
    t.spentPaise += txn.paise;
    t.txnCount += 1;
  } else if (txn.direction === 'in') {
    if (txn.isRefund) t.refundPaise += txn.paise;
    else t.receivedPaise += txn.paise;
    t.txnCount += 1;
  }
  t.netSpentPaise = t.spentPaise - t.refundPaise;
}

/** Year part of an ISO date (`2026-05-14` → 2026). */
export function yearOf(isoDate: string): number {
  return parseInt(isoDate.slice(0, 4), 10);
}

/** 1-based month part of an ISO date (`2026-05-14` → 5). */
export function monthOf(isoDate: string): number {
  return parseInt(isoDate.slice(5, 7), 10);
}

/** True when a transaction's date falls inside the given period filter. */
function inPeriod(isoDate: string, filter: PeriodFilter): boolean {
  if (yearOf(isoDate) !== filter.year) return false;
  if (filter.month != null && monthOf(isoDate) !== filter.month) return false;
  return true;
}

/** Like {@link inPeriod} but a null filter means "all time" (matches everything). */
export function matchesPeriod(isoDate: string, filter: PeriodFilter | null): boolean {
  return filter == null || inPeriod(isoDate, filter);
}

/** Roll up totals across every transaction (self-transfers excluded). */
export function totalsFor(txns: AnalyticsTxn[]): PeriodTotals {
  const t = emptyTotals();
  for (const txn of txns) addTxn(t, txn);
  return t;
}

/** Roll up totals for just the transactions inside a period. */
export function totalsForPeriod(txns: AnalyticsTxn[], filter: PeriodFilter): PeriodTotals {
  const t = emptyTotals();
  for (const txn of txns) if (inPeriod(txn.isoDate, filter)) addTxn(t, txn);
  return t;
}

/**
 * The 12 months of a calendar year, in order (Jan…Dec). Months with no transactions come back
 * as zeroed totals so the bar chart always has a full, evenly spaced axis.
 */
export function monthlyForYear(txns: AnalyticsTxn[], year: number): MonthPoint[] {
  const buckets = MONTH_LABELS.map(() => emptyTotals());
  for (const txn of txns) {
    if (yearOf(txn.isoDate) !== year) continue;
    const m = monthOf(txn.isoDate);
    if (m >= 1 && m <= 12) addTxn(buckets[m - 1], txn);
  }
  return buckets.map((totals, i) => ({ month: i + 1, label: MONTH_LABELS[i], totals }));
}

/** Every calendar year that has at least one transaction, most-recent first. */
export function listYears(txns: AnalyticsTxn[]): number[] {
  const years = new Set<number>();
  for (const txn of txns) years.add(yearOf(txn.isoDate));
  return [...years].sort((a, b) => b - a);
}

/** Totals per year (one entry per year present), most-recent first. */
export function yearlyTotals(txns: AnalyticsTxn[]): YearPoint[] {
  const byYear = new Map<number, PeriodTotals>();
  for (const txn of txns) {
    const y = yearOf(txn.isoDate);
    let t = byYear.get(y);
    if (!t) byYear.set(y, (t = emptyTotals()));
    addTxn(t, txn);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, totals]) => ({ year, totals }));
}

/**
 * Gross spend per category within a period, biggest first. Only money out is counted (so the
 * bars sum to the period's `spentPaise`); uncategorized spend comes back as `categoryId: null`.
 */
export function categoryBreakdown(
  txns: AnalyticsTxn[],
  filter: PeriodFilter,
): CategorySpend[] {
  const byCat = new Map<number | null, CategorySpend>();
  for (const txn of txns) {
    if (txn.direction !== 'out') continue;
    if (isPrincipal(txn.transferRole)) continue; // lending principal isn't spend
    if (!inPeriod(txn.isoDate, filter)) continue;
    const key = txn.categoryId ?? null;
    let c = byCat.get(key);
    if (!c) byCat.set(key, (c = { categoryId: key, spentPaise: 0, txnCount: 0 }));
    c.spentPaise += txn.paise;
    c.txnCount += 1;
  }
  return [...byCat.values()].sort((a, b) => b.spentPaise - a.spentPaise);
}

/**
 * Gross spend per sub-category *within one category* for a period, biggest first — the data
 * behind the category drill-down chart. Only money out is counted; transactions filed under the
 * category but with no sub-category come back as `subcategoryId: null`.
 */
export function subcategoryBreakdown(
  txns: AnalyticsTxn[],
  categoryId: number,
  filter: PeriodFilter,
): SubcategorySpend[] {
  const bySub = new Map<number | null, SubcategorySpend>();
  for (const txn of txns) {
    if (txn.direction !== 'out') continue;
    if (isPrincipal(txn.transferRole)) continue; // lending principal isn't spend
    if (txn.categoryId !== categoryId) continue;
    if (!inPeriod(txn.isoDate, filter)) continue;
    const key = txn.subcategoryId ?? null;
    let s = bySub.get(key);
    if (!s) bySub.set(key, (s = { subcategoryId: key, spentPaise: 0, txnCount: 0 }));
    s.spentPaise += txn.paise;
    s.txnCount += 1;
  }
  return [...bySub.values()].sort((a, b) => b.spentPaise - a.spentPaise);
}
