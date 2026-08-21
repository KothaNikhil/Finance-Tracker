/**
 * Opens the on-phone SQLite database, creates tables (idempotent), seeds default lists on a
 * fresh install, and exposes a typed Drizzle client. This is a `services/` file (it uses the
 * native expo-sqlite module), so it lives outside the pure `core/` brain.
 */

import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import * as schema from '@/core/db/schema';
import { SEED_CATEGORIES, SEED_PAYMENT_MODES, SEED_PEOPLE } from '@/core/db/seed';

/** The default/pre-login database (used when there's no signed-in account, e.g. unconfigured dev). */
export const DB_NAME = 'finance.db';

let cached: ExpoSQLiteDatabase<typeof schema> | null = null;
let cachedSqlite: SQLite.SQLiteDatabase | null = null;
let cachedName: string | null = null; // which db file is currently open
let targetName = DB_NAME; // which db file we WANT open (per the active account)
let warmUpPromise: Promise<void> | null = null;

/**
 * A filesystem-safe database filename for an account, or the default when signed out. Each account
 * gets its OWN database file so different accounts on the same device never see each other's data.
 */
function dbNameForAccount(accountKey: string | null): string {
  if (!accountKey) return DB_NAME;
  return `finance-${accountKey.replace(/[^a-zA-Z0-9]/g, '')}.db`;
}

/**
 * Point the database at a specific account's file (pass null for signed-out/default). Only records
 * the target — the actual switch (close old + open new) happens lazily on the next {@link getDb}.
 * Callers MUST remount DB-backed screens after switching accounts (the root layout keys the app on
 * the account id) so live queries re-bind to the new connection.
 */
export function setActiveDbAccount(accountKey: string | null): void {
  targetName = dbNameForAccount(accountKey);
}

/**
 * WEB ONLY (no-op on native). On web, expo-sqlite runs SQLite in a Web Worker, and the *synchronous*
 * API that Drizzle uses (`openDatabaseSync`/`execSync`/…) blocks the main thread on a
 * SharedArrayBuffer busy-loop. That loop times out (a few tens of ms) well before the worker can
 * COLD-load and compile the ~600KB `wa-sqlite.wasm` on the very first `openDatabaseSync`, so that
 * first call throws "Sync operation timeout". Doing one *async* open first (async uses promises, not
 * the busy-loop) forces the worker to compile the wasm up front; every later synchronous call then
 * responds within the loop's window. Call this once, awaited, before anything touches {@link getDb}.
 */
export function warmUpDatabaseAsync(): Promise<void> {
  if (Platform.OS !== 'web') return Promise.resolve();
  if (!warmUpPromise) {
    warmUpPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(targetName);
      await db.closeAsync();
    })();
  }
  return warmUpPromise;
}

/** Get the shared database for the active account, initializing (create tables + seed) on first use. */
export function getDb(): ExpoSQLiteDatabase<typeof schema> {
  if (cached && cachedName === targetName) return cached;

  // Account switched (or first open): drop the previous connection before opening the new file.
  if (cachedSqlite && cachedName !== targetName) {
    try {
      cachedSqlite.closeSync();
    } catch {
      // ignore — worst case the OS reclaims it; we're about to open a different file anyway
    }
    cached = null;
    cachedSqlite = null;
    cachedName = null;
  }

  // enableChangeListener lets Drizzle's useLiveQuery refresh screens automatically.
  const sqlite = SQLite.openDatabaseSync(targetName, { enableChangeListener: true });
  sqlite.execSync('PRAGMA foreign_keys = ON;');
  sqlite.execSync(schema.CREATE_TABLES_SQL);
  migrate(sqlite);

  const db = drizzle(sqlite, { schema });
  seedIfEmpty(db);

  cached = db;
  cachedSqlite = sqlite;
  cachedName = targetName;
  return db;
}

/**
 * The raw expo-sqlite handle behind {@link getDb} — used by backup/restore for a WAL checkpoint
 * and the row-copy restore. Writes through this handle still fire the change listener, so
 * `useLiveQuery` screens refresh after a restore.
 */
export function getSqlite(): SQLite.SQLiteDatabase {
  if (!cachedSqlite) getDb();
  return cachedSqlite!;
}

/**
 * Additive schema migrations for databases created before a column existed. `CREATE_TABLES_SQL` uses
 * `CREATE TABLE IF NOT EXISTS`, so it never alters an existing table — new columns are added here.
 * Each step is guarded (checks `PRAGMA table_info` / uses `IF NOT EXISTS`), so this is idempotent and
 * safe to run on every open. Fresh installs already have the column via `CREATE_TABLES_SQL`.
 */
function migrate(sqlite: SQLite.SQLiteDatabase): void {
  const txnCols = sqlite.getAllSync<{ name: string }>('PRAGMA table_info(transactions);');
  // Money-lent / interest tracker: the transfer_role annotation column.
  if (!txnCols.some((c) => c.name === 'transfer_role')) {
    sqlite.execSync('ALTER TABLE transactions ADD COLUMN transfer_role TEXT;');
  }
  // Link a transaction to the loan (grouping) it's attached to.
  if (!txnCols.some((c) => c.name === 'loan_id')) {
    sqlite.execSync('ALTER TABLE transactions ADD COLUMN loan_id INTEGER;');
  }
  // Index created here (not in CREATE_TABLES_SQL) so it never references a column an ALTER above
  // just added; IF NOT EXISTS keeps it idempotent for fresh installs too.
  sqlite.execSync('CREATE INDEX IF NOT EXISTS idx_transactions_loan ON transactions(loan_id);');
}

/** Insert the starter categories/sub-categories/payment modes/people if the DB is empty. */
function seedIfEmpty(db: ExpoSQLiteDatabase<typeof schema>): void {
  const already = db.select({ id: schema.categories.id }).from(schema.categories).limit(1).all();
  if (already.length > 0) return;

  SEED_CATEGORIES.forEach((cat, ci) => {
    const inserted = db
      .insert(schema.categories)
      .values({ name: cat.name, emoji: cat.emoji, sortOrder: ci })
      .returning({ id: schema.categories.id })
      .all();
    const categoryId = inserted[0].id;

    cat.subcategories.forEach((name, si) => {
      db.insert(schema.subcategories).values({ categoryId, name, sortOrder: si }).run();
    });
  });

  SEED_PAYMENT_MODES.forEach((name, i) => {
    db.insert(schema.paymentModes).values({ name, sortOrder: i }).run();
  });
  SEED_PEOPLE.forEach((name, i) => {
    db.insert(schema.people).values({ name, sortOrder: i }).run();
  });
}
