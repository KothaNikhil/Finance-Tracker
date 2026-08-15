/**
 * Transaction database operations. Turns normalized import results into stored rows and
 * reads them back, running auto-categorization (Step 4) at save time and learning from the
 * user's edits. Keeps SQL/Drizzle details in one place so screens stay simple.
 */

import { eq, sql } from 'drizzle-orm';

import { getDb } from './database';
import {
  categories,
  categoryRules,
  paymentModes,
  people,
  subcategories,
  transactions,
  type NewTransactionRow,
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
  return inserted[0].id;
}

/** Remove all transactions (used by the "Clear" action while testing). Leaves learned rules. */
export function clearAllTransactions(): void {
  getDb().delete(transactions).run();
}
