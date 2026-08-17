/**
 * Transaction database operations. Turns normalized import results into stored rows and
 * reads them back, running auto-categorization (Step 4) at save time and learning from the
 * user's edits. Keeps SQL/Drizzle details in one place so screens stay simple.
 */

import { eq, inArray, sql } from 'drizzle-orm';

import { getDb, getSqlite } from './database';
import {
  categories,
  categoryRules,
  DATA_UPDATED_AT_KEY,
  paymentModes,
  people,
  subcategories,
  transactions,
  type NewTransactionRow,
  type TransactionRow,
} from '@/core/db/schema';
import {
  buildCategoryIndex,
  categorize,
  normalizeText,
  type CategoryIndex,
  type LearnedRule,
  type MatcherType,
} from '@/core/categorize';
import type { NormalizedTxn } from '@/core/import/types';

/** All dedupe keys already stored — passed to the import pipeline to skip duplicates. */
export function getExistingDedupeKeys(): Set<string> {
  const rows = getDb().select({ k: transactions.dedupeKey }).from(transactions).all();
  return new Set(rows.map((r) => r.k));
}

/** Every stored transaction row (one-shot read used by the Excel export). */
export function getAllTransactions(): TransactionRow[] {
  return getDb().select().from(transactions).all();
}

/** Build the category lookup index (categories + nested sub-categories) from the database. */
export function getCategoryIndex(): CategoryIndex {
  const db = getDb();
  const cats = db
    .select({ id: categories.id, name: categories.name, emoji: categories.emoji })
    .from(categories)
    .where(eq(categories.isArchived, false))
    .orderBy(categories.sortOrder)
    .all();
  const subs = db
    .select({ id: subcategories.id, categoryId: subcategories.categoryId, name: subcategories.name })
    .from(subcategories)
    .where(eq(subcategories.isArchived, false))
    .orderBy(subcategories.sortOrder)
    .all();
  return buildCategoryIndex(cats, subs);
}

/** The editable payment-mode and "For" (person) lists, for display and pickers. */
export function getLists(): {
  paymentModes: { id: number; name: string }[];
  people: { id: number; name: string }[];
} {
  const db = getDb();
  return {
    paymentModes: db
      .select({ id: paymentModes.id, name: paymentModes.name })
      .from(paymentModes)
      .where(eq(paymentModes.isArchived, false))
      .orderBy(paymentModes.sortOrder)
      .all(),
    people: db
      .select({ id: people.id, name: people.name })
      .from(people)
      .where(eq(people.isArchived, false))
      .orderBy(people.sortOrder)
      .all(),
  };
}

/** The rules the categorizer learned from past edits. */
export function getLearnedRules(): LearnedRule[] {
  const rows = getDb()
    .select({
      matcherType: categoryRules.matcherType,
      matcherKey: categoryRules.matcherKey,
      categoryId: categoryRules.categoryId,
      subcategoryId: categoryRules.subcategoryId,
    })
    .from(categoryRules)
    .all();
  return rows.map((r) => ({
    matcherType: r.matcherType as MatcherType,
    matcherKey: r.matcherKey,
    categoryId: r.categoryId,
    subcategoryId: r.subcategoryId,
  }));
}

// ---------------------------------------------------------------------------
// `data_updated_at` marker — see schema `meta` table. Bumped by every function below that changes
// real user data (NOT the startup seed), so sign-in can tell whether a Drive backup is newer than
// this device's data. Stored/read via the raw handle to keep it a simple key/value.
// ---------------------------------------------------------------------------

/** The ISO timestamp of the last local data change, or null if nothing has changed yet. */
export function getDataUpdatedAt(): string | null {
  const row = getSqlite().getFirstSync<{ value: string }>(
    'SELECT value FROM meta WHERE key = ?',
    DATA_UPDATED_AT_KEY,
  );
  return row?.value ?? null;
}

/** Set the `data_updated_at` marker to a specific ISO timestamp (used after a restore). */
export function setDataUpdatedAt(iso: string): void {
  getSqlite().runSync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    DATA_UPDATED_AT_KEY,
    iso,
  );
}

/** Mark the local data as changed right now. Call after any user-initiated data mutation. */
export function touchDataUpdatedAt(): void {
  setDataUpdatedAt(new Date().toISOString());
}

/**
 * Save new transactions, auto-categorizing each one first. Relies on the unique dedupe key as
 * a final safety net against double-inserts.
 */
export function saveTransactions(txns: NormalizedTxn[]): number {
  if (txns.length === 0) return 0;

  const index = getCategoryIndex();
  const learned = getLearnedRules();
  const now = new Date().toISOString();

  const rows: NewTransactionRow[] = txns.map((t) => {
    const guess = categorize(
      {
        kind: t.kind,
        direction: t.direction,
        rawTag: t.rawTag,
        counterpartyName: t.counterpartyName,
        counterpartyVpa: t.counterpartyVpa,
        rawDetails: t.rawDetails,
      },
      index,
      learned,
    );

    return {
      isoDate: t.isoDate,
      time: t.time,
      paise: t.paise,
      direction: t.direction,
      kind: t.kind,
      categoryId: guess.categoryId,
      subcategoryId: guess.subcategoryId,
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
      autoCategorized: guess.categoryId != null,
      needsReview: guess.needsReview,
      createdAt: now,
    };
  });

  getDb()
    .insert(transactions)
    .values(rows)
    .onConflictDoNothing({ target: transactions.dedupeKey })
    .run();
  touchDataUpdatedAt();
  return rows.length;
}

/** Upsert a single learned rule (increments hit count when the mapping is reinforced). */
function upsertRule(
  matcherType: MatcherType,
  matcherKey: string,
  categoryId: number,
  subcategoryId: number | null,
  now: string,
): void {
  if (!matcherKey) return;
  getDb()
    .insert(categoryRules)
    .values({ matcherType, matcherKey, categoryId, subcategoryId, updatedAt: now })
    .onConflictDoUpdate({
      target: [categoryRules.matcherType, categoryRules.matcherKey],
      set: {
        categoryId,
        subcategoryId,
        updatedAt: now,
        hitCount: sql`${categoryRules.hitCount} + 1`,
      },
    })
    .run();
}

/**
 * Set a transaction's category from a user edit. Clears the "needs review" flag, marks the row
 * as manually categorized, and (unless `learn` is false) teaches the categorizer so future
 * imports of the same payee land in the same category.
 */
export function setTransactionCategory(
  txnId: number,
  categoryId: number,
  subcategoryId: number | null,
  opts: { learn?: boolean } = {},
): void {
  const db = getDb();
  db.update(transactions)
    .set({ categoryId, subcategoryId, needsReview: false, autoCategorized: false })
    .where(eq(transactions.id, txnId))
    .run();
  touchDataUpdatedAt();

  if (opts.learn === false) return;

  const row = db
    .select({
      vpa: transactions.counterpartyVpa,
      name: transactions.counterpartyName,
    })
    .from(transactions)
    .where(eq(transactions.id, txnId))
    .get();
  if (!row) return;

  const now = new Date().toISOString();
  // Learn by the most specific identifiers we have for this payee.
  upsertRule('vpa', normalizeText(row.vpa), categoryId, subcategoryId, now);
  upsertRule('merchant', normalizeText(row.name), categoryId, subcategoryId, now);
}

/** Accept every auto-categorized guess still awaiting review; returns how many were cleared. */
export function acceptAllReviews(): number {
  const pending = getDb()
    .select({ n: sql<number>`count(*)` })
    .from(transactions)
    .where(eq(transactions.needsReview, true))
    .get();

  getDb().update(transactions).set({ needsReview: false }).where(eq(transactions.needsReview, true)).run();
  touchDataUpdatedAt();
  return pending?.n ?? 0;
}

/**
 * Add a category (or return the id of an existing one with the same name). New categories are
 * appended to the end of the list. Names are matched case-insensitively so we don't create
 * near-duplicates like "Food" and "food".
 */
export function addCategory(name: string, emoji?: string | null): number {
  const db = getDb();
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('Enter a category name');

  const all = db.select().from(categories).all();
  const existing = all.find(
    (c) => !c.isArchived && c.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (existing) return existing.id;

  const inserted = db
    .insert(categories)
    .values({ name: trimmed, emoji: (emoji ?? '').trim() || null, sortOrder: all.length })
    .returning({ id: categories.id })
    .all();
  touchDataUpdatedAt();
  return inserted[0].id;
}

/**
 * Add a sub-category under a category (or return an existing one's id). This is what makes
 * sub-categories "free text with suggestions": the user can type a new one while categorizing
 * and it's remembered under that category for next time.
 */
export function addSubcategory(categoryId: number, name: string): number {
  const db = getDb();
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('Enter a sub-category name');

  const subs = db.select().from(subcategories).where(eq(subcategories.categoryId, categoryId)).all();
  const existing = subs.find(
    (s) => !s.isArchived && s.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (existing) return existing.id;

  const inserted = db
    .insert(subcategories)
    .values({ categoryId, name: trimmed, sortOrder: subs.length })
    .returning({ id: subcategories.id })
    .all();
  touchDataUpdatedAt();
  return inserted[0].id;
}

// ---------------------------------------------------------------------------
// Managing the editable lists (Step 5): rename / delete / reorder.
//
// These four tables (categories, subcategories, payment_modes, people) share the
// same id/name/sort_order/is_archived shape, so the generic helpers below operate on
// whichever Drizzle table is passed in. "Delete" is history-safe: if any transaction still
// references the row we archive it (hide it) instead of dropping it; otherwise we hard-delete.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Count transactions matching a condition — used to decide delete-vs-archive. */
function txnCount(where: any): number {
  return getDb().select({ n: sql<number>`count(*)` }).from(transactions).where(where).get()?.n ?? 0;
}

/** Rename a row in any of the list tables. */
function renameRow(table: any, id: number, name: string): void {
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('Enter a name');
  getDb().update(table).set({ name: trimmed }).where(eq(table.id, id)).run();
  touchDataUpdatedAt();
}

/** Persist a new order for a list from the full sequence of ids (as produced by a drag). */
function applyOrder(table: any, orderedIds: number[]): void {
  const db = getDb();
  orderedIds.forEach((id, pos) => db.update(table).set({ sortOrder: pos }).where(eq(table.id, id)).run());
  touchDataUpdatedAt();
}

/** Add a plain name-only list row (payment mode / person), reusing an existing match. */
function addRow(table: any, name: string): number {
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('Enter a name');
  const db = getDb();
  const all = db.select({ id: table.id, name: table.name, isArchived: table.isArchived }).from(table).all() as {
    id: number;
    name: string;
    isArchived: boolean;
  }[];
  const existing = all.find((r) => !r.isArchived && r.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing.id;
  const inserted = db.insert(table).values({ name: trimmed, sortOrder: all.length }).returning({ id: table.id }).all();
  touchDataUpdatedAt();
  return inserted[0].id;
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// --- Categories ---
export const renameCategory = (id: number, name: string): void => renameRow(categories, id, name);
export const reorderCategories = (orderedIds: number[]): void => applyOrder(categories, orderedIds);

/** Change (or clear) a category's emoji. */
export function setCategoryEmoji(id: number, emoji: string | null): void {
  getDb().update(categories).set({ emoji: (emoji ?? '').trim() || null }).where(eq(categories.id, id)).run();
  touchDataUpdatedAt();
}

/** Delete a category: archive it if it (or its sub-categories) are still used, else hard-delete. */
export function deleteCategory(id: number): void {
  const db = getDb();
  touchDataUpdatedAt();
  const subIds = db.select({ id: subcategories.id }).from(subcategories).where(eq(subcategories.categoryId, id)).all().map((s) => s.id);
  const used =
    txnCount(eq(transactions.categoryId, id)) > 0 ||
    (subIds.length > 0 && txnCount(inArray(transactions.subcategoryId, subIds)) > 0);

  if (used) {
    db.update(categories).set({ isArchived: true }).where(eq(categories.id, id)).run();
    return;
  }
  db.delete(categoryRules).where(eq(categoryRules.categoryId, id)).run();
  db.delete(subcategories).where(eq(subcategories.categoryId, id)).run();
  db.delete(categories).where(eq(categories.id, id)).run();
}

// --- Sub-categories ---
export const renameSubcategory = (id: number, name: string): void => renameRow(subcategories, id, name);
/** `orderedIds` are the sub-categories of a single category, in their new order. */
export const reorderSubcategories = (orderedIds: number[]): void => applyOrder(subcategories, orderedIds);

export function deleteSubcategory(id: number): void {
  const db = getDb();
  touchDataUpdatedAt();
  if (txnCount(eq(transactions.subcategoryId, id)) > 0) {
    db.update(subcategories).set({ isArchived: true }).where(eq(subcategories.id, id)).run();
    return;
  }
  // Keep any learned rule but drop its now-gone sub-category.
  db.update(categoryRules).set({ subcategoryId: null }).where(eq(categoryRules.subcategoryId, id)).run();
  db.delete(subcategories).where(eq(subcategories.id, id)).run();
}

// --- Payment modes ---
export const addPaymentMode = (name: string): number => addRow(paymentModes, name);
export const renamePaymentMode = (id: number, name: string): void => renameRow(paymentModes, id, name);
export const reorderPaymentModes = (orderedIds: number[]): void => applyOrder(paymentModes, orderedIds);
export function deletePaymentMode(id: number): void {
  touchDataUpdatedAt();
  if (txnCount(eq(transactions.paymentModeId, id)) > 0) {
    getDb().update(paymentModes).set({ isArchived: true }).where(eq(paymentModes.id, id)).run();
    return;
  }
  getDb().delete(paymentModes).where(eq(paymentModes.id, id)).run();
}

// --- People ("For") ---
export const addPerson = (name: string): number => addRow(people, name);
export const renamePerson = (id: number, name: string): void => renameRow(people, id, name);
export const reorderPeople = (orderedIds: number[]): void => applyOrder(people, orderedIds);
export function deletePerson(id: number): void {
  touchDataUpdatedAt();
  if (txnCount(eq(transactions.personId, id)) > 0) {
    getDb().update(people).set({ isArchived: true }).where(eq(people.id, id)).run();
    return;
  }
  getDb().delete(people).where(eq(people.id, id)).run();
}

/** Remove a transaction's category (back to uncategorized) and clear its review flag. */
export function clearTransactionCategory(txnId: number): void {
  getDb()
    .update(transactions)
    .set({ categoryId: null, subcategoryId: null, autoCategorized: false, needsReview: false })
    .where(eq(transactions.id, txnId))
    .run();
  touchDataUpdatedAt();
}

/** Remove all transactions ("Delete all data" in Manage). Leaves learned rules and lists intact. */
export function clearAllTransactions(): void {
  getDb().delete(transactions).run();
  touchDataUpdatedAt();
}
