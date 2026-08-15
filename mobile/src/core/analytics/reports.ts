/**
 * Report aggregations (Step 6): the same spend data sliced by merchant, funding account, and
 * "For" person, plus a cashback summary. Pure functions over {@link AnalyticsTxn}.
 *
 * These honour the same rules as the dashboards — self-transfers never count as spend, and only
 * money out is counted as spend — but they accept a **nullable** period filter, where `null`
 * means "all time" (the reports screen offers an "All years" option the dashboards don't).
 */

import { matchesPeriod } from './analytics';
import type {
  AnalyticsTxn,
  CashbackSummary,
  GroupSpend,
  PeriodFilter,
  PersonSpend,
} from './types';

/** Group money-out within a period by an arbitrary string key, biggest first. */
function groupSpend(
  txns: AnalyticsTxn[],
  filter: PeriodFilter | null,
  keyOf: (t: AnalyticsTxn) => string,
): GroupSpend[] {
  const byKey = new Map<string, GroupSpend>();
  for (const txn of txns) {
    if (txn.direction !== 'out') continue;
    if (!matchesPeriod(txn.isoDate, filter)) continue;
    const key = keyOf(txn);
    let g = byKey.get(key);
    if (!g) byKey.set(key, (g = { key, spentPaise: 0, txnCount: 0 }));
    g.spentPaise += txn.paise;
    g.txnCount += 1;
  }
  return [...byKey.values()].sort((a, b) => b.spentPaise - a.spentPaise);
}

/** Placeholder label when a transaction has no name/account to group under. */
const UNKNOWN = '(unknown)';

/** Spend per merchant/counterparty (name, falling back to UPI id), biggest first. */
export function merchantSpend(txns: AnalyticsTxn[], filter: PeriodFilter | null): GroupSpend[] {
  return groupSpend(
    txns,
    filter,
    (t) => t.counterpartyName?.trim() || t.counterpartyVpa?.trim() || UNKNOWN,
  );
}

/** Spend per funding account (e.g. `Axis Bank - 15`), biggest first. */
export function accountSpend(txns: AnalyticsTxn[], filter: PeriodFilter | null): GroupSpend[] {
  return groupSpend(txns, filter, (t) => t.accountName?.trim() || UNKNOWN);
}

/** Spend per "For" person, biggest first; unassigned transactions come back as `personId: null`. */
export function personSpend(txns: AnalyticsTxn[], filter: PeriodFilter | null): PersonSpend[] {
  const byPerson = new Map<number | null, PersonSpend>();
  for (const txn of txns) {
    if (txn.direction !== 'out') continue;
    if (!matchesPeriod(txn.isoDate, filter)) continue;
    const key = txn.personId ?? null;
    let p = byPerson.get(key);
    if (!p) byPerson.set(key, (p = { personId: key, spentPaise: 0, txnCount: 0 }));
    p.spentPaise += txn.paise;
    p.txnCount += 1;
  }
  return [...byPerson.values()].sort((a, b) => b.spentPaise - a.spentPaise);
}

/** Total cashback/refunds received in a period (money in flagged `isRefund`) and how many. */
export function cashbackTotals(txns: AnalyticsTxn[], filter: PeriodFilter | null): CashbackSummary {
  let totalPaise = 0;
  let count = 0;
  for (const txn of txns) {
    if (txn.direction !== 'in' || !txn.isRefund) continue;
    if (!matchesPeriod(txn.isoDate, filter)) continue;
    totalPaise += txn.paise;
    count += 1;
  }
  return { totalPaise, count };
}
