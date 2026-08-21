/**
 * Money-lent tracker queries. All return UNEXECUTED Drizzle builders so a hook can hand them to
 * `useLiveQuery` (live because the entities are the `loans` / `transactions` tables). The per-loan
 * roll-up (`loanBalanceFromTxns`) happens in the hook.
 */

import { and, desc, isNotNull, isNull } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';

import type { TxnFilter } from '@/core/analytics';
import * as schema from '@/core/db/schema';
import { loans, transactions as t } from '@/core/db/schema';
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
