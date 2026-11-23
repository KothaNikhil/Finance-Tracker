import { resolve } from 'node:path';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@finance-tracker/core/db/schema';
import { configureDatabaseProvider } from '@finance-tracker/core/db/runtime';
import type { FinanceDatabase } from '@finance-tracker/core/db/runtime';
import { migrateSchema } from '@finance-tracker/core/db/migrations';
import { revertImport, saveImportBatch, setTransactionPerson } from '@finance-tracker/core/db/repository';
import { seedDatabase } from '@finance-tracker/core/db/seed-database';
import { imports, loanAllocations, loans, people, transactions } from '@finance-tracker/core/db/schema';

let raw: SqlJsDatabase;
let db: FinanceDatabase;

beforeEach(async () => {
  const SQL = await initSqlJs({
    locateFile: (file) => resolve(process.cwd(), '..', 'node_modules', 'sql.js', 'dist', file),
    useOldExtensionFunctions: false,
  });
  raw = new SQL.Database();
  migrateSchema({
    execute: (sql) => raw.run(sql),
    all: <T>(sql: string) => {
      const [result] = raw.exec(sql);
      if (!result) return [];
      return result.values.map((values) => Object.fromEntries(
        result.columns.map((column, index) => [column, values[index]]),
      )) as T[];
    },
  });
  db = drizzle(raw, { schema });
  const metadata = new Map<string, string>();
  configureDatabaseProvider(() => ({
    db,
    getMeta: (key) => metadata.get(key) ?? null,
    setMeta: (key, value) => { metadata.set(key, value); },
    deleteMeta: (key) => { metadata.delete(key); },
  }));
  seedDatabase(db);
});

afterEach(() => raw.close());

function transaction(dedupeKey: string) {
  return {
    isoDate: '2026-01-02',
    time: null,
    paise: 12500,
    direction: 'out' as const,
    kind: 'paid' as const,
    counterpartyName: 'Sample shop',
    counterpartyVpa: null,
    accountName: null,
    rawDetails: 'Sample purchase',
    rawTag: null,
    remarks: null,
    sourceRef: null,
    orderId: null,
    source: 'paytm' as const,
    dedupeKey,
  };
}

describe('grouped import batches', () => {
  it('saves per-file records together and reverts all batch transactions', () => {
    expect(saveImportBatch([
      { sourceLabel: 'bank.xlsx', txns: [transaction('bank-1')] },
      {
        sourceLabel: 'card.pdf',
        txns: [transaction('card-1')],
        cardMeta: { cardLast4: '1234', statementMonth: '2026-01', totalDuePaise: 12500 },
      },
      { sourceLabel: 'duplicate.xlsx', txns: [transaction('bank-1')] },
    ])).toBe(2);

    const savedImports = db.select().from(imports).all();
    expect(savedImports).toHaveLength(2);
    expect(savedImports[0].batchKey).toBeTruthy();
    expect(savedImports[1].batchKey).toBe(savedImports[0].batchKey);
    expect(savedImports[1]).toMatchObject({
      sourceLabel: 'card.pdf',
      cardLast4: '1234',
      statementMonth: '2026-01',
      totalDuePaise: 12500,
    });

    expect(revertImport(savedImports[0].id)).toBe(2);
    expect(db.select().from(imports).all()).toEqual([]);
    expect(db.select().from(transactions).all()).toEqual([]);
  });

  it('prevents changing the person on a split loan transaction', () => {
    const personId = db.select({ id: people.id }).from(people).limit(1).get()!.id;
    saveImportBatch([{ sourceLabel: 'bank.xlsx', txns: [transaction('loan-split')] }]);
    const txnId = db.select({ id: transactions.id }).from(transactions).get()!.id;
    const loanId = db.insert(loans).values({
      personId,
      kind: 'lent',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning({ id: loans.id }).all()[0].id;
    db.insert(loanAllocations).values({
      txnId,
      loanId,
      part: 'principal',
      paise: 12500,
      createdAt: new Date().toISOString(),
    }).run();

    expect(() => setTransactionPerson(txnId, personId)).toThrow('managed by its loan');
  });
});
