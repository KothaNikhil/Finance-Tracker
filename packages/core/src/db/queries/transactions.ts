/**
 * Server-side transaction queries: the filtered list (paged by a growing LIMIT), the filtered
 * count, and a one-shot filtered read for the Excel export. All three filter through the SAME
 * {@link buildTxnConditions}, so the list, the count, and the export can never drift apart.
 *
 * The list/count functions return an UNEXECUTED Drizzle builder over `transactions` so a hook can
 * hand it to `useLiveQuery` (which stays live because the entity is the `transactions` table).
 */

import { desc, eq, sql } from 'drizzle-orm';
import type { FinanceDatabase } from '../runtime';

import type { TxnFilter } from '../../analytics';
import { imports, transactions } from '../schema';
import { buildTxnConditions } from './filter-sql';

type DB = FinanceDatabase;

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
/**
 * Every statement record in the most recent import batch, newest first. A web import can save several
 * files as one batch, and "revert last import" removes the whole batch, so the summary must cover it.
 */
export function lastImportQuery(db: DB) {
  return db
    .select()
    .from(imports)
    .where(
      sql`${imports.id} = (SELECT MAX(id) FROM imports) OR (${imports.batchKey} IS NOT NULL AND ${imports.batchKey} = (SELECT batch_key FROM imports ORDER BY id DESC LIMIT 1))`,
    )
    .orderBy(desc(imports.id));
}

export interface LastImportSummary {
  /** The newest statement record; revertImport on it removes the whole batch. */
  id: number;
  /** All file names in the batch, joined. */
  sourceLabel: string;
  importedAt: string;
  /** Transactions added by the whole batch. */
  addedCount: number;
  fileCount: number;
}

/** Fold the rows of {@link lastImportQuery} into one summary (null when nothing was imported). */
export function summarizeLastImport(
  rows: readonly { id: number; sourceLabel: string; importedAt: string; addedCount: number }[],
): LastImportSummary | null {
  const newest = rows[0];
  if (!newest) return null;
  const labels = rows.map((row) => row.sourceLabel.trim()).filter(Boolean);
  return {
    id: newest.id,
    sourceLabel: labels.join(', '),
    importedAt: newest.importedAt,
    addedCount: rows.reduce((sum, row) => sum + row.addedCount, 0),
    fileCount: rows.length,
  };
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
