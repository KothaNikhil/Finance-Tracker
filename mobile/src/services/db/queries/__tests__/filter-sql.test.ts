import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';

import type { TxnFilter } from '@/core/analytics';
import { buildTxnConditions } from '../filter-sql';

const dialect = new SQLiteSyncDialect();

/** Compile a filter to its `{ sql, params }`; `null` when the filter constrains nothing. */
function compile(f: TxnFilter): { sql: string; params: unknown[] } | null {
  const cond = buildTxnConditions(f);
  if (!cond) return null;
  const q = dialect.sqlToQuery(cond);
  return { sql: q.sql, params: q.params };
}

describe('buildTxnConditions', () => {
  it('returns undefined for an empty filter (no WHERE)', () => {
    expect(buildTxnConditions({})).toBeUndefined();
    expect(buildTxnConditions({ search: '   ' })).toBeUndefined(); // blank search is not a constraint
  });

  it('maps a month range to inclusive YYYY-MM-01 / YYYY-MM-31 date-string bounds', () => {
    const q = compile({ from: { year: 2026, month: 1 }, to: { year: 2026, month: 12 } })!;
    expect(q.sql).toContain('>=');
    expect(q.sql).toContain('<=');
    expect(q.params).toEqual(['2026-01-01', '2026-12-31']);
  });

  it('categoryId: value → equality, null → IS NULL, undefined → omitted', () => {
    const val = compile({ categoryId: 3 })!;
    expect(val.sql).toContain('"category_id"');
    expect(val.sql).toContain('=');
    expect(val.params).toEqual([3]);

    const nul = compile({ categoryId: null })!;
    expect(nul.sql.toLowerCase()).toContain('is null');
    expect(nul.params).toEqual([]);

    expect(buildTxnConditions({})).toBeUndefined(); // undefined category → omitted
  });

  it('applies the same null/value rule to subcategory and person', () => {
    expect(compile({ subcategoryId: null })!.sql.toLowerCase()).toContain('is null');
    expect(compile({ subcategoryId: 7 })!.params).toEqual([7]);
    expect(compile({ personId: null })!.sql.toLowerCase()).toContain('is null');
    expect(compile({ personId: 2 })!.params).toEqual([2]);
  });

  it('account and direction are plain equality', () => {
    expect(compile({ account: 'Axis Bank - 15' })!.params).toEqual(['Axis Bank - 15']);
    expect(compile({ direction: 'out' })!.params).toEqual(['out']);
  });

  it('search → LIKE ... ESCAPE across all text columns, OR-grouped, wildcards escaped', () => {
    const q = compile({ search: 'zomato' })!;
    const lower = q.sql.toLowerCase();
    // name, raw details, vpa, remarks, tag
    expect((lower.match(/like/g) ?? []).length).toBe(5);
    expect((lower.match(/escape/g) ?? []).length).toBe(5);
    expect(lower).toContain(' or ');
    expect(q.params).toEqual(['%zomato%', '%zomato%', '%zomato%', '%zomato%', '%zomato%']);
  });

  it('escapes LIKE wildcards in the search term', () => {
    const q = compile({ search: '50%_off\\' })!;
    // %, _, and the backslash itself are each prefixed with the escape char '\'
    expect(q.params[0]).toBe('%50\\%\\_off\\\\%');
  });

  it('ANDs multiple constraints together', () => {
    const q = compile({ categoryId: 3, direction: 'out', from: { year: 2026, month: 5 } })!;
    expect(q.sql.toLowerCase()).toContain(' and ');
    expect(q.params).toEqual(['2026-05-01', 3, 'out']);
  });
});
