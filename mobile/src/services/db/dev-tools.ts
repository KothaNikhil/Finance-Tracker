/**
 * DEV-ONLY tooling for scale + correctness verification. Every caller is behind `__DEV__`, so this
 * is compiled out of release builds. Two helpers:
 *  - {@link seedRandomTransactions} bulk-inserts synthetic rows so you can feel the app at 10k–50k.
 *  - {@link runAnalyticsParityCheck} cross-checks the new SQL aggregates against the trusted pure
 *    `core/analytics` functions (loading the whole table once — acceptable only because it's dev).
 */

import { totalsFor, type AnalyticsTxn, type TxnFilter } from '@/core/analytics';
import { categories, transactions, type NewTransactionRow } from '@/core/db/schema';
import { getDb, getSqlite } from '@/services/db/database';
import { periodTotalsQuery } from '@/services/db/queries/aggregates';
import { selectFilteredTxns } from '@/services/db/queries/transactions';

const ACCOUNTS = ['Axis Bank - 15', 'HDFC - 88', 'ICICI - 04', 'SBI - 21'];
const MERCHANTS = ['Zomato', 'Swiggy', 'Zepto', 'Amazon', 'Flipkart', 'BigBasket', 'Uber', 'Ola', 'Netflix', 'Jio'];
const DIRECTIONS = ['out', 'out', 'out', 'out', 'in', 'self'] as const; // weighted toward spend

/** A cheap deterministic-enough pseudo pick. */
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Insert `n` synthetic transactions spread across several years/months/categories/accounts, in
 * batches (SQLite caps bound variables per statement). Returns how many were inserted.
 */
export function seedRandomTransactions(n = 20000): number {
  const db = getDb();
  const catIds = db.select({ id: categories.id }).from(categories).all().map((c) => c.id);
  const now = new Date().toISOString();
  const stamp = Date.now();

  const rows: NewTransactionRow[] = [];
  for (let i = 0; i < n; i++) {
    const year = 2021 + (i % 5);
    const month = 1 + (i % 12);
    const day = 1 + (i % 28);
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const direction = pick(DIRECTIONS);
    const isRefund = direction === 'in' && i % 7 === 0;
    const merchant = pick(MERCHANTS);
    rows.push({
      isoDate: iso,
      time: '12:00:00',
      paise: (10 + Math.floor(Math.random() * 5000)) * 100,
      direction,
      kind: direction === 'in' ? 'received' : direction === 'self' ? 'self' : 'paid',
      categoryId: direction === 'out' ? pick(catIds) ?? null : null,
      counterpartyName: merchant,
      counterpartyVpa: `${merchant.toLowerCase()}@ptys`,
      accountName: pick(ACCOUNTS),
      rawDetails: `Paid to ${merchant}`,
      isRefund,
      source: 'manual',
      dedupeKey: `dev-${stamp}-${i}`,
      autoCategorized: false,
      needsReview: i % 11 === 0,
      createdAt: now,
    });
  }

  // ONE transaction for the whole batch: a single commit/fsync instead of one per chunk (which is
  // pathologically slow on the emulator's storage), and a single change-notification so the Home
  // live queries refresh once — not once per chunk.
  const CHUNK = 500;
  getSqlite().withTransactionSync(() => {
    for (let i = 0; i < rows.length; i += CHUNK) {
      db.insert(transactions).values(rows.slice(i, i + CHUNK)).run();
    }
  });
  return rows.length;
}

export interface ParityResult {
  ok: boolean;
  pure: { spentPaise: number; receivedPaise: number; refundPaise: number; txnCount: number };
  sql: { spentPaise: number; receivedPaise: number; refundPaise: number; txnCount: number };
}

/**
 * Compare the SQL period-totals aggregate against the trusted pure `totalsFor` for the same filter.
 * Loads all matching rows once (dev-only) to run the JS spec. `ok === false` means the SQL math and
 * the pure spec disagree — a real bug to fix.
 */
export function runAnalyticsParityCheck(filter: TxnFilter = {}): ParityResult {
  const db = getDb();
  const rows = selectFilteredTxns(db, filter) as unknown as AnalyticsTxn[];
  const pureT = totalsFor(rows);
  const sqlRow = periodTotalsQuery(db, filter).get();

  const pure = {
    spentPaise: pureT.spentPaise,
    receivedPaise: pureT.receivedPaise,
    refundPaise: pureT.refundPaise,
    txnCount: pureT.txnCount,
  };
  const sql = {
    spentPaise: sqlRow?.spentPaise ?? 0,
    receivedPaise: sqlRow?.receivedPaise ?? 0,
    refundPaise: sqlRow?.refundPaise ?? 0,
    txnCount: sqlRow?.txnCount ?? 0,
  };
  const ok =
    pure.spentPaise === sql.spentPaise &&
    pure.receivedPaise === sql.receivedPaise &&
    pure.refundPaise === sql.refundPaise &&
    pure.txnCount === sql.txnCount;

  return { ok, pure, sql };
}
