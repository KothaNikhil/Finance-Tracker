/**
 * Money-lent tracker queries. All return UNEXECUTED Drizzle builders so a hook can hand them to
 * `useLiveQuery` (live because the entities are the `loans` / `transactions` tables). The per-loan
 * roll-up (`loanBalanceFromTxns`) happens in the hook.
 */

import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';

import type { TxnFilter } from '@/core/analytics';
import * as schema from '@/core/db/schema';
import { loanAllocations as la, loans, transactions as t } from '@/core/db/schema';
import { buildTxnConditions } from './filter-sql';

type DB = ExpoSQLiteDatabase<typeof schema>;

/** All loans (groupings), most-recently-updated first. Live. */
export function loansQuery(db: DB) {
  return db.select().from(loans).orderBy(desc(loans.updatedAt), desc(loans.id));
}

/** Every transaction attached to a loan, newest first (grouped by loan in the hook). Live. */
export function loanTxnsQuery(db: DB) {
  return db.select().from(t).where(isNotNull(t.loanId)).orderBy(desc(t.isoDate), desc(t.id));
}

/**
 * Every split allocation, joined to its transaction for display + balance roll-up (a slice of one
 * payment applied to a loan). Live on the `loan_allocations` table — split/unsplit re-writes those
 * rows, which is what changes a loan's balance. Newest transaction first.
 */
export function loanAllocationsQuery(db: DB) {
  return db
    .select({
      id: la.id,
      loanId: la.loanId,
      txnId: la.txnId,
      part: la.part,
      paise: la.paise,
      transferRole: t.transferRole,
      isoDate: t.isoDate,
      counterpartyName: t.counterpartyName,
      remarks: t.remarks,
      direction: t.direction,
      kind: t.kind,
    })
    .from(la)
    .innerJoin(t, eq(la.txnId, t.id))
    .orderBy(desc(t.isoDate), desc(la.id));
}

/** The split allocations for one transaction (used to prefill the split editor). Live. */
export function allocationsForTxnQuery(db: DB, txnId: number) {
  return db.select().from(la).where(eq(la.txnId, txnId)).orderBy(la.id);
}

/**
 * Transactions NOT attached to any loan — candidates for "attach existing", narrowed by the same
 * {@link TxnFilter} the Reports screen uses (amount range, search, direction, …). Live.
 */
export function unattachedTxnsQuery(db: DB, filter: TxnFilter, limit: number) {
  return db
    .select()
    .from(t)
    .where(and(isNull(t.loanId), isNull(t.transferRole), buildTxnConditions(filter)))
    .orderBy(desc(t.isoDate), desc(t.id))
    .limit(limit);
}
