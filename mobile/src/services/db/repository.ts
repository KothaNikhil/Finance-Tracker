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
  loans,
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
import { roleDirection, roleForLoanPart, type LoanKind, type LoanPart } from '@/core/lending/roles';

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

// ---------------------------------------------------------------------------
// Pending file import that must survive an app reload. Some devices (Samsung Knox App Lock)
// re-authenticate and RELOAD the app when it returns from the file picker, wiping in-memory state
// mid-import. We persist the picked file's cache URI so the Import screen can resume on relaunch.
// ---------------------------------------------------------------------------

const PENDING_IMPORT_KEY = 'pending_import';

export interface PendingImport {
  uri: string;
  label: string;
}

export function setPendingImport(uri: string, label: string): void {
  getSqlite().runSync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    PENDING_IMPORT_KEY,
    JSON.stringify({ uri, label }),
  );
}

export function getPendingImport(): PendingImport | null {
  try {
    const row = getSqlite().getFirstSync<{ value: string }>('SELECT value FROM meta WHERE key = ?', PENDING_IMPORT_KEY);
    if (!row?.value) return null;
    const p = JSON.parse(row.value) as Partial<PendingImport>;
    return typeof p.uri === 'string' ? { uri: p.uri, label: p.label ?? 'statement' } : null;
  } catch {
    return null;
  }
}

export function clearPendingImport(): void {
  try {
    getSqlite().runSync('DELETE FROM meta WHERE key = ?', PENDING_IMPORT_KEY);
  } catch {
    // best-effort; a stale marker is cleared on the next successful import
  }
}

/** Mark the local data as changed right now. Call after any user-initiated data mutation. */
export function touchDataUpdatedAt(): void {
  setDataUpdatedAt(new Date().toISOString());
}

/** Run the auto-categorizer over one normalized transaction (shared by save + enrich). */
function categorizeTxn(t: NormalizedTxn, index: CategoryIndex, learned: LearnedRule[]) {
  return categorize(
    {
      kind: t.kind,
      direction: t.direction,
      rawTag: t.rawTag,
      counterpartyName: t.counterpartyName,
      counterpartyVpa: t.counterpartyVpa,
      rawDetails: t.rawDetails,
      remarks: t.remarks,
    },
    index,
    learned,
  );
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
    const guess = categorizeTxn(t, index, learned);

    // Transfers (to your own accounts, or money sent to a person) are always surfaced for review —
    // they're the "money lent?" bucket the user decides on. Applies to every source, incl. Paytm.
    const needsReview = guess.needsReview || t.kind === 'self' || t.kind === 'sent';

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
      needsReview,
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

/** Outcome of reconciling an import's duplicates against already-stored rows. */
export interface ReconcileResult {
  /** Rows whose category/tag/note was filled in from the other source (they agreed or we had none). */
  updated: number;
  /** Rows flagged "Needs review" because our category disagreed with the Paytm tag — user decides. */
  flagged: number;
}

/**
 * Reconcile shared UPI rows across statements, independent of import order. A payment made through
 * Paytm also lands on the bank statement with the same RRN, so whichever is imported first "owns"
 * the stored row and the later one is a duplicate.
 *
 * We never silently let the Paytm tag win over a category we computed ourselves. For each duplicate:
 *  - If a Paytm tag and our category DISAGREE → flag the row "Needs review" (keep our category, show
 *    the tag) and let the user decide. Their pick is learned via {@link setTransactionCategory}.
 *  - If they agree, or the stored row had no category yet → fill in the category/tag/note.
 * This runs in both directions (bank→Paytm and Paytm→bank). Rows the user has already decided on
 * (category manually set OR cleared) are never touched.
 */
export function reconcileDuplicatesFromImport(dupes: NormalizedTxn[]): ReconcileResult {
  if (dupes.length === 0) return { updated: 0, flagged: 0 };

  const db = getDb();
  const index = getCategoryIndex();
  const learned = getLearnedRules();
  let updated = 0;
  let flagged = 0;

  for (const d of dupes) {
    const s = db
      .select({
        id: transactions.id,
        categoryId: transactions.categoryId,
        rawTag: transactions.rawTag,
        remarks: transactions.remarks,
        autoCategorized: transactions.autoCategorized,
        needsReview: transactions.needsReview,
      })
      .from(transactions)
      .where(eq(transactions.dedupeKey, d.dedupeKey))
      .get();
    if (!s) continue;
    // A definite user decision (category set OR cleared) is sacred — never override it.
    if (s.autoCategorized === false && s.needsReview === false) continue;

    const incomingTagged = !!(d.rawTag && d.rawTag.trim() !== '');
    const storedTagged = !!(s.rawTag && s.rawTag.trim() !== '');
    const fillRemarks = s.remarks && s.remarks.trim() !== '' ? s.remarks : d.remarks;

    if (incomingTagged) {
      // Both Paytm (an overlapping re-import) — same tag, nothing to reconcile.
      if (storedTagged) continue;

      // Stored row is an untagged bank row; the incoming Paytm row brings the tag.
      const withTag = categorizeTxn(d, index, learned);
      if (withTag.categoryId == null) {
        // Tag is a transfer / unrecognised — no category to compare; just attach it for context.
        db.update(transactions).set({ rawTag: d.rawTag, remarks: fillRemarks }).where(eq(transactions.id, s.id)).run();
        updated++;
      } else if (s.categoryId != null && s.categoryId !== withTag.categoryId) {
        // Disagreement → keep OUR category, surface the tag, and let the user decide.
        db.update(transactions).set({ rawTag: d.rawTag, remarks: fillRemarks, needsReview: true }).where(eq(transactions.id, s.id)).run();
        flagged++;
      } else {
        // Agreement, or we had no category yet → adopt the tag's category.
        const needsReview = withTag.needsReview || d.kind === 'self' || d.kind === 'sent';
        db.update(transactions)
          .set({
            categoryId: withTag.categoryId,
            subcategoryId: withTag.subcategoryId,
            rawTag: d.rawTag,
            remarks: fillRemarks,
            autoCategorized: true,
            needsReview,
          })
          .where(eq(transactions.id, s.id))
          .run();
        updated++;
      }
      continue;
    }

    // Incoming row has no tag (a bank row). Only meaningful if the STORED row is a Paytm-tagged one
    // whose tag-category could disagree with what the richer bank narration independently implies.
    if (storedTagged && s.categoryId != null) {
      const our = categorizeTxn({ ...d, rawTag: null }, index, learned);
      if (our.categoryId != null && our.categoryId !== s.categoryId) {
        db.update(transactions).set({ needsReview: true }).where(eq(transactions.id, s.id)).run();
        flagged++;
      }
    }
  }

  if (updated > 0 || flagged > 0) touchDataUpdatedAt();
  return { updated, flagged };
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
  learnFromTxn(txnId, categoryId, subcategoryId);
}

// --- Money-lent loans (groupings) ---------------------------------------------

/** Read a loan's kind + person (used to derive a transaction's role when attaching). */
function getLoanMeta(loanId: number): { kind: LoanKind; personId: number } | null {
  const row = getDb().select({ kind: loans.kind, personId: loans.personId }).from(loans).where(eq(loans.id, loanId)).get();
  return row ? { kind: row.kind as LoanKind, personId: row.personId } : null;
}

/** Create a loan (grouping) for a person and return its id. */
export function createLoan(input: { name?: string; personId: number; kind: LoanKind }): number {
  const now = new Date().toISOString();
  const inserted = getDb()
    .insert(loans)
    .values({ name: (input.name ?? '').trim(), personId: input.personId, kind: input.kind, createdAt: now, updatedAt: now })
    .returning({ id: loans.id })
    .all();
  touchDataUpdatedAt();
  return inserted[0].id;
}

/** Update a loan's editable fields (name / person / kind). */
export function updateLoan(loanId: number, patch: { name?: string; personId?: number; kind?: LoanKind }): void {
  const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.personId !== undefined) set.personId = patch.personId;
  if (patch.kind !== undefined) set.kind = patch.kind;
  getDb().update(loans).set(set).where(eq(loans.id, loanId)).run();
  touchDataUpdatedAt();
}

/** Mark a loan closed (collapsed on the Lent tab, out of totals) or reopen it. */
export function setLoanClosed(loanId: number, closed: boolean): void {
  getDb().update(loans).set({ closed, updatedAt: new Date().toISOString() }).where(eq(loans.id, loanId)).run();
  touchDataUpdatedAt();
}

/** Delete a loan — its transactions are detached (kept as ordinary rows), then the loan is removed. */
export function deleteLoan(loanId: number): void {
  const db = getDb();
  db.update(transactions).set({ loanId: null, transferRole: null }).where(eq(transactions.loanId, loanId)).run();
  db.delete(loans).where(eq(loans.id, loanId)).run();
  touchDataUpdatedAt();
}

/**
 * Attach a transaction to a loan as the given part (principal / repayment / interest). Sets the
 * derived transfer role + the loan's person, clears the review flag, and — for a manual entry —
 * syncs `direction` to the part (an imported row keeps its real statement direction).
 */
export function attachTransactionToLoan(txnId: number, loanId: number, part: LoanPart): void {
  const meta = getLoanMeta(loanId);
  if (!meta) return;
  const role = roleForLoanPart(meta.kind, part);
  const db = getDb();
  const patch: Partial<NewTransactionRow> = {
    loanId,
    transferRole: role,
    personId: meta.personId,
    needsReview: false,
  };
  const row = db.select({ source: transactions.source }).from(transactions).where(eq(transactions.id, txnId)).get();
  if (row?.source === 'manual') patch.direction = roleDirection(role);
  db.update(transactions).set(patch).where(eq(transactions.id, txnId)).run();
  touchDataUpdatedAt();
}

/** Detach a transaction from its loan (back to an ordinary, untagged transaction). */
export function detachTransactionFromLoan(txnId: number): void {
  getDb().update(transactions).set({ loanId: null, transferRole: null }).where(eq(transactions.id, txnId)).run();
  touchDataUpdatedAt();
}

/** A hand-entered transaction added directly into a loan (e.g. a cash repayment). */
export interface LoanTxnInput {
  loanId: number;
  part: LoanPart;
  paise: number;
  isoDate: string; // YYYY-MM-DD
  remarks?: string | null;
}

/** Add a manual transaction into a loan. Returns the new row id. */
export function addLoanTransaction(input: LoanTxnInput): number {
  const meta = getLoanMeta(input.loanId);
  if (!meta) throw new Error('Loan not found');
  const role = roleForLoanPart(meta.kind, input.part);
  const now = new Date().toISOString();
  const row: NewTransactionRow = {
    isoDate: input.isoDate,
    time: null,
    paise: input.paise,
    direction: roleDirection(role),
    kind: 'other',
    personId: meta.personId,
    transferRole: role,
    loanId: input.loanId,
    remarks: input.remarks ?? null,
    source: 'manual',
    dedupeKey: `manual:${now}:${Math.random().toString(36).slice(2, 10)}`,
    needsReview: false,
    createdAt: now,
  };
  const inserted = getDb().insert(transactions).values(row).returning({ id: transactions.id }).all();
  touchDataUpdatedAt();
  return inserted[0].id;
}

/** Teach the categorizer from a confirmed row: payee (VPA + merchant) → category, concise note → sub. */
function learnFromTxn(txnId: number, categoryId: number, subcategoryId: number | null): void {
  const row = getDb()
    .select({
      vpa: transactions.counterpartyVpa,
      name: transactions.counterpartyName,
      remarks: transactions.remarks,
    })
    .from(transactions)
    .where(eq(transactions.id, txnId))
    .get();
  if (!row) return;

  const now = new Date().toISOString();
  // Learn by the most specific identifiers we have for this payee (teaches the category).
  upsertRule('vpa', normalizeText(row.vpa), categoryId, subcategoryId, now);
  upsertRule('merchant', normalizeText(row.name), categoryId, subcategoryId, now);

  // Learn from a CONCISE note (1–2 words, e.g. "uthappam", "biriyani") so the same note auto-fills
  // its sub-category next time. Long free-text notes are skipped to avoid noisy rules.
  const note = normalizeText(row.remarks);
  if (note && note.split(' ').length <= 2) {
    upsertRule('note', note, categoryId, subcategoryId, now);
  }
}

/**
 * Accept ONE row's current auto-categorization: clear its review flag, mark it as a deliberate
 * decision (so cross-source reconciliation won't re-flag it), and learn from the confirmed category.
 * For an uncategorized row (e.g. a transfer) it simply stops flagging it for review.
 */
export function acceptTransactionReview(txnId: number): void {
  const db = getDb();
  const row = db
    .select({ categoryId: transactions.categoryId, subcategoryId: transactions.subcategoryId })
    .from(transactions)
    .where(eq(transactions.id, txnId))
    .get();
  if (!row) return;
  db.update(transactions)
    .set({ needsReview: false, autoCategorized: false })
    .where(eq(transactions.id, txnId))
    .run();
  touchDataUpdatedAt();
  if (row.categoryId != null) learnFromTxn(txnId, row.categoryId, row.subcategoryId);
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
  const db = getDb();
  const loanRefs = db.select({ n: sql<number>`count(*)` }).from(loans).where(eq(loans.personId, id)).get()?.n ?? 0;
  // Archive (soft-delete) if the person is still referenced by any transaction OR loan — a hard delete
  // would orphan history or violate the loans→people foreign key.
  if (txnCount(eq(transactions.personId, id)) > 0 || loanRefs > 0) {
    db.update(people).set({ isArchived: true }).where(eq(people.id, id)).run();
    return;
  }
  db.delete(people).where(eq(people.id, id)).run();
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

/** Delete a single transaction (hard delete). Leaves learned rules and lists intact. */
export function deleteTransaction(id: number): void {
  getDb().delete(transactions).where(eq(transactions.id, id)).run();
  touchDataUpdatedAt();
}

/** Remove all transactions + loans ("Delete all data" in Manage). Leaves learned rules and lists intact. */
export function clearAllTransactions(): void {
  const db = getDb();
  db.delete(transactions).run(); // children first
  db.delete(loans).run();
  touchDataUpdatedAt();
}
