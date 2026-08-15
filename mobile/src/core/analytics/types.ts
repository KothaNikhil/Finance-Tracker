/**
 * Contracts for the spend dashboards (Step 5).
 *
 * The analytics layer is a set of **pure functions**: given a list of transactions it rolls
 * them up into monthly / yearly / per-category totals. No database or React Native imports, so
 * it runs in a unit test and would run unchanged on a future web build.
 *
 * Two rules run through everything here (the reason this is tested, not eyeballed):
 *  - **Self-transfers are excluded.** Money moved between the user's own accounts
 *    (`direction === 'self'`) is neither spend nor income and never enters a total.
 *  - **Refunds/cashback offset spend.** A refund is money *in* flagged `isRefund`; it is NOT
 *    counted as income, and it reduces the "net spent" figure (spent − refunds).
 */

import type { Direction } from '../domain/money';

/** The minimal shape of a transaction the dashboards need (a subset of the stored row). */
export interface AnalyticsTxn {
  /** Date-only string, `YYYY-MM-DD`. */
  isoDate: string;
  /** Positive magnitude in paise. */
  paise: number;
  /** `in` | `out` | `self`. */
  direction: Direction;
  /** True for a refund/cashback (always money in; offsets spend, never income). */
  isRefund: boolean;
  /** Category the transaction is filed under, or null when uncategorized. */
  categoryId: number | null;
  /** Sub-category within the category, or null when none was set. */
  subcategoryId: number | null;
  /** Counterparty (merchant/person) display name, for the reports grouping. */
  counterpartyName: string | null;
  /** Counterparty UPI id, used as a fallback merchant key when the name is missing. */
  counterpartyVpa: string | null;
  /** Funding account, e.g. `Axis Bank - 15`, for the per-account report. */
  accountName: string | null;
  /** The "For" person this is assigned to, or null when unassigned. */
  personId: number | null;
}

/**
 * Rolled-up money figures for a period (a month, a year, a category, or everything).
 * All values are in paise. Self-transfers never contribute to any of these.
 */
export interface PeriodTotals {
  /** Gross money out (`direction === 'out'`). */
  spentPaise: number;
  /** Real income — money in that is NOT a refund. */
  receivedPaise: number;
  /** Refunds / cashback — money in flagged `isRefund`. */
  refundPaise: number;
  /** What was actually spent: `spentPaise − refundPaise` (can be negative if refunds exceed spend). */
  netSpentPaise: number;
  /** How many transactions were counted (excludes self-transfers). */
  txnCount: number;
}

/** One month of a year, for the monthly bar chart. `month` is 1-based (1 = January). */
export interface MonthPoint {
  month: number;
  /** Short month name, e.g. `Jan`. */
  label: string;
  totals: PeriodTotals;
}

/** One calendar year, for the yearly overview. */
export interface YearPoint {
  year: number;
  totals: PeriodTotals;
}

/** Spend for one category within a period, for the category breakdown. */
export interface CategorySpend {
  /** null = uncategorized spend. */
  categoryId: number | null;
  /** Gross money out filed under this category. */
  spentPaise: number;
  txnCount: number;
}

/** Spend for one sub-category within a category, for the drill-down chart. */
export interface SubcategorySpend {
  /** null = no sub-category set. */
  subcategoryId: number | null;
  /** Gross money out filed under this sub-category. */
  spentPaise: number;
  txnCount: number;
}

/** A period filter: a whole year, or a specific month within a year. */
export interface PeriodFilter {
  year: number;
  /** 1-based month; omit for the whole year. */
  month?: number;
}

// --- Reports (Step 6) -------------------------------------------------------

/** Spend for one named group (a merchant or an account), for the reports. */
export interface GroupSpend {
  /** Display name / group key (e.g. a merchant name or `Axis Bank - 15`). */
  key: string;
  spentPaise: number;
  txnCount: number;
}

/** Spend attributed to one "For" person, for the spend-by-person report. */
export interface PersonSpend {
  /** null = not assigned to anyone. */
  personId: number | null;
  spentPaise: number;
  txnCount: number;
}

/** Cashback / refund summary for a period. */
export interface CashbackSummary {
  totalPaise: number;
  count: number;
}
