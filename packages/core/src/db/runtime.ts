import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import * as schema from './schema';

export type FinanceDatabase = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export interface DatabaseRuntime {
  db: FinanceDatabase;
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
  deleteMeta(key: string): void;
}

type DatabaseProvider = () => DatabaseRuntime;

let databaseProvider: DatabaseProvider | null = null;

export function configureDatabaseProvider(provider: DatabaseProvider): void {
  databaseProvider = provider;
}

function getRuntime(): DatabaseRuntime {
  if (!databaseProvider) {
    throw new Error('Database provider has not been configured.');
  }
  return databaseProvider();
}

export function getDb(): FinanceDatabase {
  return getRuntime().db;
}

export function getMeta(key: string): string | null {
  return getRuntime().getMeta(key);
}

export function setMeta(key: string, value: string): void {
  getRuntime().setMeta(key, value);
}

export function deleteMeta(key: string): void {
  getRuntime().deleteMeta(key);
}
