import { drizzle } from 'drizzle-orm/sql-js';
import type { Database } from 'sql.js';

import { migrateSchema } from '@finance-tracker/core/db/migrations';
import { configureDatabaseProvider } from '@finance-tracker/core/db/runtime';
import { seedDatabase } from '@finance-tracker/core/db/seed-database';
import * as schema from '@finance-tracker/core/db/schema';

interface SqlRuntime {
  Database: new (bytes?: Uint8Array) => Database;
}

let sqlPromise: Promise<SqlRuntime> | null = null;
let database: Database | null = null;

function getSql(): Promise<SqlRuntime> {
  if (!sqlPromise) {
    sqlPromise = Promise.all([
      import('sql.js'),
      import('sql.js/dist/sql-wasm.wasm?url'),
    ]).then(([sql, wasm]) => sql.default({
      locateFile: () => wasm.default,
      useOldExtensionFunctions: false,
    }));
  }
  return sqlPromise;
}

function getRows<T>(db: Database, query: string): T[] {
  return db.exec(query).flatMap(({ columns, values }) =>
    values.map((valuesRow) =>
      Object.fromEntries(columns.map((column, index) => [column, valuesRow[index]])) as T,
    ),
  );
}

export async function openDatabase(bytes?: Uint8Array): Promise<Database> {
  const SQL = await getSql();
  database?.close();
  database = bytes ? new SQL.Database(bytes) : new SQL.Database();
  database.run('PRAGMA foreign_keys = ON;');
  migrateSchema({
    execute: (sql) => database?.run(sql),
    all: <T>(sql: string) => getRows<T>(database!, sql),
  });

  const db = drizzle(database, { schema });
  seedDatabase(db);
  configureDatabaseProvider(() => ({
    db,
    getMeta(key) {
      const statement = database!.prepare('SELECT value FROM meta WHERE key = ?');
      try {
        statement.bind([key]);
        return statement.step() ? String(statement.getAsObject().value ?? '') || null : null;
      } finally {
        statement.free();
      }
    },
    setMeta(key, value) {
      database!.run(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value],
      );
      window.dispatchEvent(new Event('finance-db-change'));
    },
    deleteMeta(key) {
      database!.run('DELETE FROM meta WHERE key = ?', [key]);
      window.dispatchEvent(new Event('finance-db-change'));
    },
  }));
  return database;
}

export function exportDatabase(): Uint8Array {
  if (!database) throw new Error('The in-memory database is not open.');
  return database.export();
}

export function closeDatabase(): void {
  database?.close();
  database = null;
}
