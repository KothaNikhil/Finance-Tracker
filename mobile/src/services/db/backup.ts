/**
 * Database-level backup and restore (Step 8, local part).
 *
 *  - Backup: serialize the live database to bytes (a standalone SQLite file).
 *  - Restore: deserialize a backup into a throwaway in-memory database, then copy every row into
 *    the live database. Copying *through the live connection* (rather than swapping the file under
 *    it) means the change listener fires and `useLiveQuery` screens refresh with no app restart.
 */

import { deserializeDatabaseAsync } from 'expo-sqlite';

import { BACKUP_TABLES, hasRequiredTables } from '@/core/backup';
import { getSqlite } from './database';
import { setDataUpdatedAt } from './repository';

/** Serialize the whole database to bytes after a WAL checkpoint (a valid, standalone .db file). */
export function serializeDatabase(): Uint8Array {
  const db = getSqlite();
  db.execSync('PRAGMA wal_checkpoint(TRUNCATE);'); // fold the WAL into the main file first
  return db.serializeSync();
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Replace ALL data in the live database with the contents of a backup. Validates that the backup
 * has our tables before touching anything, then wipes and re-inserts inside a transaction.
 */
export async function restoreFromBytes(bytes: Uint8Array): Promise<void> {
  const src = await deserializeDatabaseAsync(bytes);
  try {
    const tables = src
      .getAllSync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
      .map((r) => r.name);
    if (!hasRequiredTables(tables)) {
      throw new Error('This file isn’t a Finance Tracker backup.');
    }

    // Copy every backup table PRESENT in the source (a newer table like `loans` may be absent from an
    // older backup — that's fine, it just stays empty). Pull all rows first so a read error can't
    // leave us half-wiped.
    const present = BACKUP_TABLES.filter((t) => tables.includes(t));
    const snapshot = new Map<string, any[]>();
    for (const t of present) {
      snapshot.set(t, src.getAllSync<any>(`SELECT * FROM "${t}"`));
    }

    const live = getSqlite();
    // The live schema's columns per table — a backup may carry extra columns this build's schema has
    // since dropped (older dev builds added columns we later removed); inserting those would throw, so
    // we copy only the intersection.
    const liveCols = new Map<string, Set<string>>();
    for (const t of present) {
      const info = live.getAllSync<{ name: string }>(`PRAGMA table_info("${t}")`);
      liveCols.set(t, new Set(info.map((c) => c.name)));
    }

    // FK checks off around the bulk copy (can't toggle inside a transaction).
    live.execSync('PRAGMA foreign_keys = OFF;');
    try {
      live.withTransactionSync(() => {
        // Wipe children-first (all backup tables), refill parents-first (only those in the source).
        for (const t of [...BACKUP_TABLES].reverse()) live.runSync(`DELETE FROM "${t}"`);
        for (const t of present) {
          const allowed = liveCols.get(t)!;
          for (const row of snapshot.get(t)!) {
            const cols = Object.keys(row).filter((c) => allowed.has(c));
            if (cols.length === 0) continue;
            const colList = cols.map((c) => `"${c}"`).join(', ');
            const placeholders = cols.map(() => '?').join(', ');
            live.runSync(
              `INSERT INTO "${t}" (${colList}) VALUES (${placeholders})`,
              ...cols.map((c) => row[c] as any),
            );
          }
        }
      });
    } finally {
      live.execSync('PRAGMA foreign_keys = ON;');
    }
    // The live data now matches the backup; mark it fresh so a just-restored device isn't seen as
    // "older than Drive" and restored again on the next sign-in.
    setDataUpdatedAt(new Date().toISOString());
  } finally {
    src.closeSync();
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */
