import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/sqlite-proxy';

import * as schema from '@/core/db/schema';
import { CREATE_TABLES_SQL } from '@/core/db/schema';
import {
  cashbackQuery,
  categoryBreakdownQuery,
  periodTotalsQuery,
} from '../aggregates';

type AggregateDb = Parameters<typeof periodTotalsQuery>[0];

function execute<Row>(
  sqlite: DatabaseSync,
  query: { toSQL: () => { sql: string; params: unknown[] } },
): Row {
  const compiled = query.toSQL();
  const statement = sqlite.prepare(compiled.sql);
  statement.setReturnArrays(true);
  return statement.get(...(compiled.params as SQLInputValue[])) as Row;
}

describe('split-aware SQL aggregates', () => {
  it('excludes only principal slices and keeps interest plus unallocated remainders', () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      sqlite.exec(CREATE_TABLES_SQL);
      sqlite.exec(`
        insert into people (id, name) values (1, 'Person');
        insert into loans (id, name, person_id, kind, created_at, updated_at)
        values (1, 'Loan', 1, 'lent', '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z');
      `);
      const insertTxn = sqlite.prepare(`
        insert into transactions (
          id, iso_date, paise, direction, kind, transfer_role, raw_details,
          is_refund, source, dedupe_key, created_at
        ) values (?, '2026-08-31', ?, ?, 'other', ?, '', ?, 'axis', ?, '2026-08-31T00:00:00.000Z')
      `);
      insertTxn.run(1, 10_000, 'out', null, 0, 'ordinary-spend');
      insertTxn.run(2, 50_000, 'out', 'lent', 0, 'direct-principal');
      insertTxn.run(3, 10_000, 'in', 'repaid_to_me', 0, 'split-in');
      insertTxn.run(4, 10_000, 'out', 'lent', 0, 'split-out');
      insertTxn.run(5, 30_000, 'in', 'cc_payment_received', 1, 'card-leg');
      insertTxn.run(6, 500, 'in', null, 1, 'ordinary-refund');

      const now = '2026-08-31T00:00:00.000Z';
      const insertAllocation = sqlite.prepare(`
        insert into loan_allocations (txn_id, loan_id, part, paise, created_at)
        values (?, 1, ?, ?, ?)
      `);
      insertAllocation.run(3, 'repayment', 6_000, now);
      insertAllocation.run(3, 'interest', 1_000, now);
      insertAllocation.run(4, 'principal', 6_000, now);
      insertAllocation.run(4, 'interest', 1_000, now);

      const proxy = drizzle(async () => ({ rows: [] }), { schema }) as unknown as AggregateDb;
      const totals = execute<[number, number, number, number]>(
        sqlite,
        periodTotalsQuery(proxy, {}),
      );
      const category = execute<[null, number, number]>(
        sqlite,
        categoryBreakdownQuery(proxy, {}),
      );
      const cashback = execute<[number, number]>(
        sqlite,
        cashbackQuery(proxy, {}),
      );

      expect(totals).toEqual([14_000, 4_000, 500, 4]);
      expect(category).toEqual([null, 14_000, 2]);
      expect(cashback).toEqual([500, 1]);
    } finally {
      sqlite.close();
    }
  });
});
