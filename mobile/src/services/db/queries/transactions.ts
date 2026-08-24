/**
 * Server-side transaction queries: the filtered list (paged by a growing LIMIT), the filtered
 * count, and a one-shot filtered read for the Excel export. All three filter through the SAME
 * {@link buildTxnConditions}, so the list, the count, and the export can never drift apart.
 *
 * The list/count functions return an UNEXECUTED Drizzle builder over `transactions` so a hook can
 * hand it to `useLiveQuery` (which stays live because the entity is the `transactions` table).
 */

import { desc, eq, sql } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';

import type { TxnFilter } from '@/core/analytics';
import * as schema from '@/core/db/schema';
import { imports, transactions } from '@/core/db/schema';
import { buildTxnConditions } from './filter-sql';

type DB = ExpoSQLiteDatabase<typeof schema>;

/** Newest first, then by id so same-day rows have a stable order (matches the current screens). */
const NEWEST_FIRST = [desc(transactions.isoDate), desc(transactions.id)] as const;

/** The filtered transaction list, capped at `limit` rows (grow the limit to page in more). Live. */
export function txnListQuery(db: DB, filter: TxnFilter, limit: number) {
  return db
    .select()
    .from(transactions)
    .where(buildTxnConditions(filter))
    .orderBy(...NEWEST_FIRST)
    .limit(limit);
}

/**
 * A single transaction by id (0 or 1 rows). Live — re-reads whenever that row is edited, so a
 * globally-mounted detail sheet reflects category/loan changes without the caller holding the row.
 * Pass a non-existent id (e.g. -1) to intentionally match nothing.
 */
export function txnByIdQuery(db: DB, id: number) {
  return db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
}

/** How many transactions match the filter (one row `{ n }`). Live. */
export function txnCountQuery(db: DB, filter: TxnFilter) {
  return db
    .select({ n: sql<number>`count(*)` })
    .from(transactions)
    .where(buildTxnConditions(filter));
}

/** The most recent import batch (0 or 1 rows). Live on the `imports` table — refreshes on revert. */
export function lastImportQuery(db: DB) {
  return db.select().from(imports).orderBy(desc(imports.id)).limit(1);
}

/** One-shot read of every row matching the filter (for the Excel export — NOT live). */
export function selectFilteredTxns(db: DB, filter: TxnFilter) {
  return db
    .select()
    .from(transactions)
    .where(buildTxnConditions(filter))
    .orderBy(...NEWEST_FIRST)
    .all();
}
