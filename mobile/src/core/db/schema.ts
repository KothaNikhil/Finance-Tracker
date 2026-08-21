/**
 * Database schema (Drizzle ORM, SQLite).
 *
 * This describes the on-phone database. It's plain schema definition (no React Native), so
 * the same schema can back a future web build. The reference tables (categories, etc.) are
 * all user-editable; `is_archived` is a soft-delete so history and backups never lose rows.
 */

import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  emoji: text('emoji'),
  sortOrder: integer('sort_order').notNull().default(0),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
});

/** Sub-categories are NESTED: each one belongs under exactly one category. */
export const subcategories = sqliteTable('subcategories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  categoryId: integer('category_id')
    .notNull()
    .references(() => categories.id),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
});

export const paymentModes = sqliteTable('payment_modes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
});

/** The configurable "For" (who it's for) list — also the counterparty list for the lending ledger. */
export const people = sqliteTable('people', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
});

/**
 * A money-lent "loan" — a named grouping (a deal with one person) that transactions attach to. It is
 * NOT a transaction: one loan can span several principal / repayment / interest transactions. `kind`
 * is the loan's direction ('lent' = they owe me, 'borrowed' = I owe them).
 */
export const loans = sqliteTable('loans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().default(''),
  personId: integer('person_id')
    .notNull()
    .references(() => people.id),
  kind: text('kind').notNull(), // 'lent' | 'borrowed'
  closed: integer('closed', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  isoDate: text('iso_date').notNull(), // YYYY-MM-DD
  time: text('time'), // HH:MM:SS or null
  paise: integer('paise').notNull(), // positive magnitude, in paise
  direction: text('direction').notNull(), // 'in' | 'out' | 'self'
  kind: text('kind').notNull(), // paid | received | self | gold | refund | ...
  categoryId: integer('category_id').references(() => categories.id),
  subcategoryId: integer('subcategory_id').references(() => subcategories.id),
  paymentModeId: integer('payment_mode_id').references(() => paymentModes.id),
  personId: integer('person_id').references(() => people.id),
  counterpartyName: text('counterparty_name'),
  counterpartyVpa: text('counterparty_vpa'),
  accountName: text('account_name'),
  // Money-lent / interest tracker: this transaction's PART in a loan (lent / repaid_to_me /
  // interest_received / …), or null when it isn't part of a loan.
  transferRole: text('transfer_role'),
  // Money-lent tracker: the loan this transaction is attached to, or null when unattached.
  loanId: integer('loan_id'),
  rawDetails: text('raw_details').notNull().default(''),
  rawTag: text('raw_tag'),
  remarks: text('remarks'),
  isRefund: integer('is_refund', { mode: 'boolean' }).notNull().default(false),
  source: text('source').notNull(), // paytm | manual | ...
  sourceRef: text('source_ref'), // UPI Ref No.
  orderId: text('order_id'),
  dedupeKey: text('dedupe_key').notNull().unique(),
  autoCategorized: integer('auto_categorized', { mode: 'boolean' }).notNull().default(false),
  needsReview: integer('needs_review', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(), // ISO timestamp
});

/**
 * Rules the auto-categorizer learns from the user's edits. When the user re-files a
 * transaction, we remember "this counterparty (or tag) → this category" so future imports of
 * the same payee are categorized automatically. `matcherKey` is stored normalized.
 */
export const categoryRules = sqliteTable(
  'category_rules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    matcherType: text('matcher_type').notNull(), // 'vpa' | 'merchant' | 'tag'
    matcherKey: text('matcher_key').notNull(), // normalized
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id),
    subcategoryId: integer('subcategory_id').references(() => subcategories.id),
    hitCount: integer('hit_count').notNull().default(1),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    // One rule per (matcher type, key); re-learning updates the existing row.
    byMatcher: uniqueIndex('idx_category_rules_matcher').on(t.matcherType, t.matcherKey),
  }),
);

export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransactionRow = typeof transactions.$inferInsert;
export type LoanRow = typeof loans.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type SubcategoryRow = typeof subcategories.$inferSelect;
export type CategoryRuleRow = typeof categoryRules.$inferSelect;

/**
 * Raw SQL to create the tables. We run this at startup (idempotent) instead of wiring up
 * Drizzle-kit migration bundling, which keeps the Expo setup simple for v1. Keep this in
 * sync with the table definitions above. (A real migration system can replace it later.)
 */
export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  emoji TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS subcategories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payment_modes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  person_id INTEGER NOT NULL REFERENCES people(id),
  kind TEXT NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iso_date TEXT NOT NULL,
  time TEXT,
  paise INTEGER NOT NULL,
  direction TEXT NOT NULL,
  kind TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  subcategory_id INTEGER REFERENCES subcategories(id),
  payment_mode_id INTEGER REFERENCES payment_modes(id),
  person_id INTEGER REFERENCES people(id),
  counterparty_name TEXT,
  counterparty_vpa TEXT,
  account_name TEXT,
  transfer_role TEXT,
  loan_id INTEGER,
  raw_details TEXT NOT NULL DEFAULT '',
  raw_tag TEXT,
  remarks TEXT,
  is_refund INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  source_ref TEXT,
  order_id TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  auto_categorized INTEGER NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(iso_date);
-- Scale (tier 2): back the server-side filters + SQL aggregates.
-- category filter + category breakdown + deep-linked "category in year" list (ordered by date)
CREATE INDEX IF NOT EXISTS idx_transactions_category_date  ON transactions(category_id, iso_date);
-- money-rule aggregates: equality on direction + range on date (totals / breakdowns)
CREATE INDEX IF NOT EXISTS idx_transactions_direction_date ON transactions(direction, iso_date);
CREATE INDEX IF NOT EXISTS idx_transactions_person         ON transactions(person_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account        ON transactions(account_name);
CREATE INDEX IF NOT EXISTS idx_transactions_subcategory    ON transactions(subcategory_id);
-- Home review count — partial index over the small "needs review" subset only
CREATE INDEX IF NOT EXISTS idx_transactions_needs_review   ON transactions(needs_review) WHERE needs_review = 1;
CREATE TABLE IF NOT EXISTS category_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matcher_type TEXT NOT NULL,
  matcher_key TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  subcategory_id INTEGER REFERENCES subcategories(id),
  hit_count INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_category_rules_matcher ON category_rules(matcher_type, matcher_key);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

/**
 * Local key/value scratchpad — NOT user data. Holds one row, `data_updated_at` (ISO timestamp of
 * the last real data change on THIS device), used to decide whether a newer Drive backup should be
 * auto-restored on sign-in. Deliberately left out of the backup/restore row-copy (see
 * `core/backup` REQUIRED_TABLES) so it stays a per-device marker.
 */
export const DATA_UPDATED_AT_KEY = 'data_updated_at';
