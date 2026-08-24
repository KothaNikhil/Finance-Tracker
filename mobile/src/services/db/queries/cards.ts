/**
 * Credit-card bill-payment linking queries (Phase B). A credit-card statement is recorded as an
 * `imports` batch carrying the card's last-4, statement month and Total Payment Due; a bank
 * bill-payment transaction links to the statement it settled via `transactions.linked_import_id`.
 *
 * All return UNEXECUTED Drizzle builders so hooks can hand them to `useLiveQuery` (live on the
 * `imports` / `transactions` tables) and one-shot callers can `.get()`/`.all()`.
 */

import { and, desc, eq, isNotNull, isNull, ne, or } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';

import * as schema from '@/core/db/schema';
import { imports, transactions as t } from '@/core/db/schema';

type DB = ExpoSQLiteDatabase<typeof schema>;

/** Every imported credit-card statement (has card metadata), newest first. For the manual picker. */
export function cardStatementsQuery(db: DB) {
  return db.select().from(imports).where(isNotNull(imports.cardLast4)).orderBy(desc(imports.id));
}

/** Card statements whose Total Payment Due equals `paise` — auto-suggest matches for a bank payment. */
export function matchingCardStatementsQuery(db: DB, paise: number) {
  return db
    .select()
    .from(imports)
    .where(and(isNotNull(imports.cardLast4), eq(imports.totalDuePaise, paise)))
    .orderBy(desc(imports.id));
}

/** One card statement (import batch) by id. */
export function cardStatementByIdQuery(db: DB, importId: number) {
  return db.select().from(imports).where(eq(imports.id, importId)).limit(1);
}

/**
 * A statement's itemised activity that makes up its Total Payment Due — the card spends (Debit) AND
 * the refunds / cashbacks (Credit), newest first. Excludes the payment-received leg
 * (`cc_payment_received`), which settles the previous balance rather than being part of this bill.
 * Net of these rows (spends − refunds) equals the Total Payment Due when the prior bill was cleared.
 */
export function cardStatementItemsQuery(db: DB, importId: number) {
  return db
    .select()
    .from(t)
    .where(and(eq(t.importId, importId), or(isNull(t.transferRole), ne(t.transferRole, 'cc_payment_received'))))
    .orderBy(desc(t.isoDate), desc(t.id));
}
