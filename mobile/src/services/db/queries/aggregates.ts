/**
 * SQL-backed spend aggregates — the scale replacement for iterating the whole table in JS. Each
 * function returns an UNEXECUTED Drizzle builder over `transactions` so hooks can pass it to
 * `useLiveQuery` (stays live: the entity is the `transactions` table) and one-shot callers can
 * `.get()`/`.all()`.
 *
 * The two money rules are encoded ONCE here as reusable `sql` fragments and mirror the pure
 * `core/analytics` functions (the tested spec) exactly:
 *  - self-transfers (`direction = 'self'`) never contribute to any total or count, and
 *  - refunds (`direction = 'in'` AND `is_refund = 1`) are tallied separately, never as income.
 * `netSpentPaise = spentPaise − refundPaise` is computed in JS by the caller (keeps the SQL flat).
 */

import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';

import type { MonthKey, TxnFilter } from '@/core/analytics';
import * as schema from '@/core/db/schema';
import { transactions as t } from '@/core/db/schema';
import { buildTxnConditions } from './filter-sql';

type DB = ExpoSQLiteDatabase<typeof schema>;

// --- Money-rule fragments (single source of truth for the SQL side) ---------
const SPENT = sql<number>`coalesce(sum(case when ${t.direction} = 'out' then ${t.paise} else 0 end), 0)`;
const RECEIVED = sql<number>`coalesce(sum(case when ${t.direction} = 'in' and ${t.isRefund} = 0 then ${t.paise} else 0 end), 0)`;
const REFUND = sql<number>`coalesce(sum(case when ${t.direction} = 'in' and ${t.isRefund} = 1 then ${t.paise} else 0 end), 0)`;
// self excluded — only 'out'/'in' rows are counted, matching addTxn in analytics.ts
const CNT = sql<number>`coalesce(sum(case when ${t.direction} in ('out', 'in') then 1 else 0 end), 0)`;

/** Gross money-out for a "spend" grouping, and how many rows. */
const OUT_SPENT = sql<number>`coalesce(sum(${t.paise}), 0)`;
const OUT_CNT = sql<number>`count(*)`;

// Grouping keys mirror the pure functions' fallbacks exactly.
const MERCHANT_KEY = sql<string>`coalesce(nullif(trim(${t.counterpartyName}), ''), nullif(trim(${t.counterpartyVpa}), ''), '(unknown)')`;
const ACCOUNT_KEY = sql<string>`coalesce(nullif(trim(${t.accountName}), ''), '(unknown)')`;

// Year/month extracted from the fixed-width 'YYYY-MM-DD' iso_date.
const YEAR_INT = sql<number>`cast(substr(${t.isoDate}, 1, 4) as integer)`;
const MONTH_INT = sql<number>`cast(substr(${t.isoDate}, 6, 2) as integer)`;

/**
 * A one-row summary for the filtered set: canonical Spent/Received (self excluded, refunds NOT
 * counted as income), plus the "needs review" count and the total row count. Used for the Import
 * screen (scoped to this session via a `since` filter) and elsewhere. Live.
 */
export function summaryQuery(db: DB, filter: TxnFilter) {
  return db
    .select({
      spentPaise: SPENT,
      receivedPaise: RECEIVED,
      reviewCount: sql<number>`coalesce(sum(case when ${t.needsReview} = 1 then 1 else 0 end), 0)`,
      savedCount: sql<number>`count(*)`,
    })
    .from(t)
    .where(buildTxnConditions(filter));
}

/** The four period totals in one row. Honours every filter dimension. Live. */
export function periodTotalsQuery(db: DB, filter: TxnFilter) {
  return db
    .select({ spentPaise: SPENT, receivedPaise: RECEIVED, refundPaise: REFUND, txnCount: CNT })
    .from(t)
    .where(buildTxnConditions(filter));
}

/** Per-month totals for one calendar year (only months present come back; JS zero-fills to 12). Live. */
export function monthlyForYearQuery(db: DB, year: number) {
  const cond = buildTxnConditions({ from: { year, month: 1 }, to: { year, month: 12 } });
  return db
    .select({ month: MONTH_INT, spentPaise: SPENT, receivedPaise: RECEIVED, refundPaise: REFUND, txnCount: CNT })
    .from(t)
    .where(cond)
    .groupBy(MONTH_INT);
}

/** Totals per year (one row per year present), most-recent first. Live. */
export function yearlyTotalsQuery(db: DB) {
  return db
    .select({ year: YEAR_INT, spentPaise: SPENT, receivedPaise: RECEIVED, refundPaise: REFUND, txnCount: CNT })
    .from(t)
    .groupBy(YEAR_INT)
    .orderBy(desc(YEAR_INT));
}

/** Gross money-out per category within the filter (uncategorized → categoryId null). Live. */
export function categoryBreakdownQuery(db: DB, filter: TxnFilter) {
  return db
    .select({ categoryId: t.categoryId, spentPaise: OUT_SPENT, txnCount: OUT_CNT })
    .from(t)
    .where(and(buildTxnConditions(filter), eq(t.direction, 'out')))
    .groupBy(t.categoryId)
    .orderBy(desc(OUT_SPENT));
}

/** Gross money-out per sub-category within one category (no sub-category → subcategoryId null). Live. */
export function subcategoryBreakdownQuery(db: DB, categoryId: number, filter: TxnFilter) {
  return db
    .select({ subcategoryId: t.subcategoryId, spentPaise: OUT_SPENT, txnCount: OUT_CNT })
    .from(t)
    .where(and(buildTxnConditions(filter), eq(t.direction, 'out'), eq(t.categoryId, categoryId)))
    .groupBy(t.subcategoryId)
    .orderBy(desc(OUT_SPENT));
}

/** Spend per merchant (name, falling back to VPA, then '(unknown)'), biggest first. Live. */
export function merchantSpendQuery(db: DB, filter: TxnFilter) {
  return db
    .select({ key: MERCHANT_KEY, spentPaise: OUT_SPENT, txnCount: OUT_CNT })
    .from(t)
    .where(and(buildTxnConditions(filter), eq(t.direction, 'out')))
    .groupBy(MERCHANT_KEY)
    .orderBy(desc(OUT_SPENT));
}

/** Spend per funding account, biggest first. Live. */
export function accountSpendQuery(db: DB, filter: TxnFilter) {
  return db
    .select({ key: ACCOUNT_KEY, spentPaise: OUT_SPENT, txnCount: OUT_CNT })
    .from(t)
    .where(and(buildTxnConditions(filter), eq(t.direction, 'out')))
    .groupBy(ACCOUNT_KEY)
    .orderBy(desc(OUT_SPENT));
}

/** Spend per "For" person (unassigned → personId null), biggest first. Live. */
export function personSpendQuery(db: DB, filter: TxnFilter) {
  return db
    .select({ personId: t.personId, spentPaise: OUT_SPENT, txnCount: OUT_CNT })
    .from(t)
    .where(and(buildTxnConditions(filter), eq(t.direction, 'out')))
    .groupBy(t.personId)
    .orderBy(desc(OUT_SPENT));
}

/** Total cashback/refunds (money in flagged is_refund) and how many, within the filter. Live. */
export function cashbackQuery(db: DB, filter: TxnFilter) {
  return db
    .select({ totalPaise: OUT_SPENT, count: OUT_CNT })
    .from(t)
    .where(and(buildTxnConditions(filter), eq(t.direction, 'in'), eq(t.isRefund, true)));
}

/** Distinct calendar years present in the filtered set, most-recent first. Live. */
export function distinctYearsQuery(db: DB, filter: TxnFilter = {}) {
  return db.selectDistinct({ year: YEAR_INT }).from(t).where(buildTxnConditions(filter)).orderBy(desc(YEAR_INT));
}

/** Distinct 'YYYY-MM' months present in the filtered set, most-recent first. Live. */
export function distinctMonthsQuery(db: DB, filter: TxnFilter = {}) {
  const ym = sql<string>`substr(${t.isoDate}, 1, 7)`;
  return db.selectDistinct({ ym }).from(t).where(buildTxnConditions(filter)).orderBy(desc(ym));
}

/** Distinct non-null funding account names in the filtered set, alphabetical. Live. */
export function distinctAccountsQuery(db: DB, filter: TxnFilter = {}) {
  return db
    .selectDistinct({ accountName: t.accountName })
    .from(t)
    .where(and(buildTxnConditions(filter), isNotNull(t.accountName)))
    .orderBy(t.accountName);
}

/** Convert a `MonthKey` string 'YYYY-MM' pair — helper re-exported for the months dimension. */
export function ymToMonthKey(ym: string): MonthKey {
  return { year: parseInt(ym.slice(0, 4), 10), month: parseInt(ym.slice(5, 7), 10) };
}
