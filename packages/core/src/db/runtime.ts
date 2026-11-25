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
  // Always the guarded handle, so a write started before view only began still can't slip through
  // a cached reference. The check happens at call time.
  return guarded(getRuntime().db);
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

// ---------------------------------------------------------------------------
// View only
//
// While another device holds the edit lock (or the website is offline), this device must not change
// any data. Every data write in the apps goes through `getDb()`, so instead of guarding each
// repository function, `getDb()` hands out a guarded handle whose write entry points (`insert`,
// `update`, `delete`, `transaction`, `run`) throw {@link ReadOnlyError}. Reads are untouched.
// Restoring Drive's copy over the local database uses the raw driver, so pulls still work.
// ---------------------------------------------------------------------------

export class ReadOnlyError extends Error {
  constructor(message = 'View only. Take over to edit.') {
    super(message);
    this.name = 'ReadOnlyError';
  }
}

/** True for a {@link ReadOnlyError}, including one that crossed a bundle boundary. */
export function isReadOnlyError(error: unknown): error is ReadOnlyError {
  return error instanceof ReadOnlyError || (error instanceof Error && error.name === 'ReadOnlyError');
}

const WRITE_METHODS = new Set<PropertyKey>(['insert', 'update', 'delete', 'transaction', 'run']);
let readOnly = false;
const readOnlyListeners = new Set<() => void>();
const guardedHandles = new WeakMap<object, FinanceDatabase>();

/** Turn view only on or off. Listeners (UI hooks) are told when it changes. */
export function setReadOnly(next: boolean): void {
  if (readOnly === next) return;
  readOnly = next;
  readOnlyListeners.forEach((listener) => listener());
}

export function isReadOnly(): boolean {
  return readOnly;
}

/** Subscribe to view-only changes (fits `useSyncExternalStore`). */
export function subscribeReadOnly(listener: () => void): () => void {
  readOnlyListeners.add(listener);
  return () => readOnlyListeners.delete(listener);
}

/** Throw {@link ReadOnlyError} while in view only. For writes that don't go through `getDb()`. */
export function assertWritable(): void {
  if (readOnly) throw new ReadOnlyError();
}

function guarded(db: FinanceDatabase): FinanceDatabase {
  let handle = guardedHandles.get(db);
  if (!handle) {
    handle = new Proxy(db, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown;
        if (typeof value !== 'function') return value;
        if (WRITE_METHODS.has(property)) {
          return (...args: unknown[]) => {
            assertWritable();
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return (value as (...a: unknown[]) => unknown).bind(target);
      },
    });
    guardedHandles.set(db, handle);
  }
  return handle;
}
