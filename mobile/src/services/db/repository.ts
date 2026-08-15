/**
 * Transaction database operations. Turns normalized import results into stored rows and
 * reads them back. Keeps SQL/Drizzle details in one place so screens stay simple.
 */

import { getDb } from './database';
import { transactions, type NewTransactionRow } from '@/core/db/schema';
import type { NormalizedTxn } from '@/core/import/types';

/** All dedupe keys already stored — passed to the import pipeline to skip duplicates. */
export function getExistingDedupeKeys(): Set<string> {
  const rows = getDb().select({ k: transactions.dedupeKey }).from(transactions).all();
  return new Set(rows.map((r) => r.k));
}

/** Save new transactions. Relies on the unique dedupe key as a final safety net. */
export function saveTransactions(txns: NormalizedTxn[]): number {
  if (txns.length === 0) return 0;

  const now = new Date().toISOString();
  const rows: NewTransactionRow[] = txns.map((t) => ({
    isoDate: t.isoDate,
    time: t.time,
    paise: t.paise,
    direction: t.direction,
    kind: t.kind,
    counterpartyName: t.counterpartyName,
    counterpartyVpa: t.counterpartyVpa,
    accountName: t.accountName,
    rawDetails: t.rawDetails,
    rawTag: t.rawTag,
    remarks: t.remarks,
    isRefund: t.kind === 'refund',
    source: t.source,
    sourceRef: t.sourceRef,
    orderId: t.orderId,
    dedupeKey: t.dedupeKey,
    createdAt: now,
  }));

  getDb().insert(transactions).values(rows).onConflictDoNothing({ target: transactions.dedupeKey }).run();
  return rows.length;
}

/** Remove all transactions (used by the "Clear" action while testing). */
export function clearAllTransactions(): void {
  getDb().delete(transactions).run();
}
