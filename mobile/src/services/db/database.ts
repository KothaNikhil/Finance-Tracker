/**
 * Opens the on-phone SQLite database, creates tables (idempotent), seeds default lists on a
 * fresh install, and exposes a typed Drizzle client. This is a `services/` file (it uses the
 * native expo-sqlite module), so it lives outside the pure `core/` brain.
 */

import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import * as SQLite from 'expo-sqlite';

import * as schema from '@/core/db/schema';
import { SEED_CATEGORIES, SEED_PAYMENT_MODES, SEED_PEOPLE } from '@/core/db/seed';

export const DB_NAME = 'finance.db';

let cached: ExpoSQLiteDatabase<typeof schema> | null = null;
let cachedSqlite: SQLite.SQLiteDatabase | null = null;

/** Get the shared database, initializing (create tables + seed) on first use. */
export function getDb(): ExpoSQLiteDatabase<typeof schema> {
  if (cached) return cached;

  // enableChangeListener lets Drizzle's useLiveQuery refresh screens automatically.
  const sqlite = SQLite.openDatabaseSync(DB_NAME, { enableChangeListener: true });
  sqlite.execSync('PRAGMA foreign_keys = ON;');
  sqlite.execSync(schema.CREATE_TABLES_SQL);

  const db = drizzle(sqlite, { schema });
  seedIfEmpty(db);

  cached = db;
  cachedSqlite = sqlite;
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
