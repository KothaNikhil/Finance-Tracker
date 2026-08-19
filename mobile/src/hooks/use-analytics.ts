/**
 * Live, SQL-backed analytics hooks — the scale replacement for loading the whole table and rolling
 * it up in JS. Each wraps an aggregate builder from `services/db/queries/aggregates` in
 * `useLiveQuery`, so the numbers refresh on any import/edit/delete. Every parameterized hook passes
 * a `deps` array (serialized filter / year) — omitting it would freeze the query on stale params.
 *
 * The returned shapes match the pure `core/analytics` types so the screens' existing rendering
 * (charts, breakdown rows) is unchanged.
 */

import { useMemo } from 'react';

import { useLiveQuery } from '@/hooks/use-live-query';

import {
  MONTH_LABELS,
  type CashbackSummary,
  type CategorySpend,
  type GroupSpend,
  type MonthKey,
  type MonthPoint,
  type PeriodTotals,
  type PersonSpend,
  type SubcategorySpend,
  type TxnFilter,
  type YearPoint,
} from '@/core/analytics';
import { getDb } from '@/services/db/database';
import {
  accountSpendQuery,
  cashbackQuery,
  categoryBreakdownQuery,
  distinctAccountsQuery,
  distinctMonthsQuery,
  distinctYearsQuery,
  homeSummaryQuery,
  merchantSpendQuery,
  monthlyForYearQuery,
  periodTotalsQuery,
  personSpendQuery,
  subcategoryBreakdownQuery,
  yearlyTotalsQuery,
  ymToMonthKey,
} from '@/services/db/queries/aggregates';

const ZERO_TOTALS: PeriodTotals = { spentPaise: 0, receivedPaise: 0, refundPaise: 0, netSpentPaise: 0, txnCount: 0 };

/** Add the derived `netSpentPaise` (spent − refund) to a raw totals row. */
function withNet(r: { spentPaise: number; receivedPaise: number; refundPaise: number; txnCount: number }): PeriodTotals {
  return { ...r, netSpentPaise: r.spentPaise - r.refundPaise };
}

export interface HomeSummary {
  spentPaise: number;
  receivedPaise: number;
  reviewCount: number;
  savedCount: number;
  /** True until the first result lands (so Home doesn't flash zeroes / empty on mount). */
  loading: boolean;
}

/** The Home header summary (canonical Spent/Received + review & saved counts). */
export function useHomeSummary(): HomeSummary {
  const db = getDb();
  const { data, updatedAt } = useLiveQuery(homeSummaryQuery(db), []);
  const row = data?.[0];
  return {
    spentPaise: row?.spentPaise ?? 0,
    receivedPaise: row?.receivedPaise ?? 0,
    reviewCount: row?.reviewCount ?? 0,
    savedCount: row?.savedCount ?? 0,
    loading: updatedAt === undefined,
  };
}

/** Rolled-up totals for the filtered set. */
export function usePeriodTotals(filter: TxnFilter): PeriodTotals {
  const db = getDb();
  const key = JSON.stringify(filter);
  const { data } = useLiveQuery(periodTotalsQuery(db, filter), [key]);
  return useMemo(() => (data?.[0] ? withNet(data[0]) : ZERO_TOTALS), [data]);
}

/** The 12 months of a year, zero-filled so the bar chart always has a full axis. */
export function useMonthly(year: number): MonthPoint[] {
  const db = getDb();
  const { data } = useLiveQuery(monthlyForYearQuery(db, year), [year]);
  return useMemo(() => {
    const byMonth = new Map<number, PeriodTotals>();
    for (const r of data ?? []) byMonth.set(r.month, withNet(r));
    return MONTH_LABELS.map((label, i) => ({ month: i + 1, label, totals: byMonth.get(i + 1) ?? ZERO_TOTALS }));
  }, [data]);
}

/** Totals per year present, most-recent first. */
export function useYearlyTotals(): YearPoint[] {
  const db = getDb();
  const { data } = useLiveQuery(yearlyTotalsQuery(db), []);
  return useMemo(() => (data ?? []).map((r) => ({ year: r.year, totals: withNet(r) })), [data]);
}

/** Gross money-out per category within the filter, biggest first (uncategorized → categoryId null). */
export function useCategoryBreakdown(filter: TxnFilter): CategorySpend[] {
  const db = getDb();
  const key = JSON.stringify(filter);
  const { data } = useLiveQuery(categoryBreakdownQuery(db, filter), [key]);
  return useMemo(
    () => (data ?? []).map((r) => ({ categoryId: r.categoryId ?? null, spentPaise: r.spentPaise, txnCount: r.txnCount })),
    [data],
  );
}

/** Gross money-out per sub-category within one category (empty when no category is open). */
export function useSubcategoryBreakdown(categoryId: number | null, filter: TxnFilter): SubcategorySpend[] {
  const db = getDb();
  const key = JSON.stringify(filter);
  // A stable dummy query when no category is open keeps hook order fixed; we ignore its data.
  const effectiveId = categoryId ?? -1;
  const { data } = useLiveQuery(subcategoryBreakdownQuery(db, effectiveId, filter), [effectiveId, key]);
  return useMemo(() => {
    if (categoryId == null) return [];
    return (data ?? []).map((r) => ({ subcategoryId: r.subcategoryId ?? null, spentPaise: r.spentPaise, txnCount: r.txnCount }));
  }, [data, categoryId]);
}

export interface ReportsBreakdowns {
  merchants: GroupSpend[];
  accounts: GroupSpend[];
  people: PersonSpend[];
  cashback: CashbackSummary;
}

/** The four Reports breakdown cards (merchant / account / person / cashback) for the filtered set. */
export function useReportsBreakdowns(filter: TxnFilter): ReportsBreakdowns {
  const db = getDb();
  const key = JSON.stringify(filter);
  const merchants = useLiveQuery(merchantSpendQuery(db, filter), [key]);
  const accounts = useLiveQuery(accountSpendQuery(db, filter), [key]);
  const people = useLiveQuery(personSpendQuery(db, filter), [key]);
  const cashback = useLiveQuery(cashbackQuery(db, filter), [key]);

  return useMemo(
    () => ({
      merchants: (merchants.data ?? []).map((r) => ({ key: r.key, spentPaise: r.spentPaise, txnCount: r.txnCount })),
      accounts: (accounts.data ?? []).map((r) => ({ key: r.key, spentPaise: r.spentPaise, txnCount: r.txnCount })),
      people: (people.data ?? []).map((r) => ({ personId: r.personId ?? null, spentPaise: r.spentPaise, txnCount: r.txnCount })),
      cashback: { totalPaise: cashback.data?.[0]?.totalPaise ?? 0, count: cashback.data?.[0]?.count ?? 0 },
    }),
    [merchants.data, accounts.data, people.data, cashback.data],
  );
}

export interface Dimensions {
  years: number[];
  months: MonthKey[];
  accounts: string[];
}

/** The available filter dimensions (years / months / accounts), derived server-side. */
export function useDimensions(): Dimensions {
  const db = getDb();
  const years = useLiveQuery(distinctYearsQuery(db), []);
  const months = useLiveQuery(distinctMonthsQuery(db), []);
  const accounts = useLiveQuery(distinctAccountsQuery(db), []);
  return useMemo(
    () => ({
      years: (years.data ?? []).map((r) => r.year),
      months: (months.data ?? []).map((r) => ymToMonthKey(r.ym)),
      accounts: (accounts.data ?? []).map((r) => r.accountName).filter((a): a is string => a != null),
    }),
    [years.data, months.data, accounts.data],
  );
}
