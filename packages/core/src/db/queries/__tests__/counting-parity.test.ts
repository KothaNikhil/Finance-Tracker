/**
 * The counting rule has TWO implementations: the `sql` fragments in `aggregates.ts` and the pure
 * `countablePaise` in `core/analytics` (which the Excel export also uses). This suite runs one
 * fixture through real SQLite and through the pure functions and asserts they agree, so the two
 * can never drift.
 *
 * The fixture is the credit-card double-counting scenario end to end: an imported card statement
 * (individual purchases, a merchant refund, the statement's own payment-received leg) plus the bank
 * bill payment that settled it, alongside self-transfers, lending principal, splits and an UNLINKED
 * bill payment.
 */

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/sqlite-proxy';

import {
  accountSpend,
  cashbackTotals,
  categoryBreakdown,
  countablePaise,
  filterTxns,
  merchantSpend,
  monthlyForYear,
  personSpend,
  totalsFor,
  yearlyTotals,
  type AnalyticsTxn,
  type FilterableTxn,
  type TxnFilter,
} from '../../../analytics';
import * as schema from '../../schema';
import { CREATE_TABLES_SQL } from '../../schema';
import type { Direction } from '../../../domain/money';
import { buildFilteredWorkbook, type ExportTxn } from '../../../export';
import { LOAN_PARTS, ROLE_META, type LoanPart, type TransferRole } from '../../../lending/roles';
import {
  accountSpendQuery,
  cashbackQuery,
  categoryBreakdownQuery,
  merchantSpendQuery,
  monthlyForYearQuery,
  periodTotalsQuery,
  personSpendQuery,
  summaryQuery,
  yearlyTotalsQuery,
} from '../aggregates';
import { txnCountQuery, txnListQuery } from '../transactions';

type AggregateDb = Parameters<typeof periodTotalsQuery>[0];

interface Fixture {
  id: number;
  isoDate: string;
  paise: number;
  direction: Direction;
  transferRole?: TransferRole | null;
  isRefund?: boolean;
  categoryId?: number | null;
  personId?: number | null;
  counterpartyName?: string | null;
  accountName?: string | null;
  importId?: number | null;
  linkedImportId?: number | null;
  allocations?: { part: LoanPart | null; paise: number }[];
}

const CARD_IMPORT = 11;
const BANK_IMPORT = 12;
const CARD_ACCOUNT = 'Axis Bank Flipkart Visa Credit Card ••4723';
const BANK_ACCOUNT = 'Axis Bank - 15';

/**
 * June 2026: one card statement whose Total Payment Due (₹3,400) was settled by a linked bank
 * payment. July 2026 holds a bill payment that was never linked to a statement.
 */
const FIXTURE: Fixture[] = [
  // --- Card statement (import 11): the individual line items ---
  { id: 1, isoDate: '2026-06-03', paise: 250_000, direction: 'out', categoryId: 1, counterpartyName: 'Amazon', accountName: CARD_ACCOUNT, importId: CARD_IMPORT },
  { id: 2, isoDate: '2026-06-07', paise: 120_000, direction: 'out', categoryId: 2, counterpartyName: 'Swiggy', accountName: CARD_ACCOUNT, importId: CARD_IMPORT },
  { id: 3, isoDate: '2026-06-12', paise: 30_000, direction: 'in', isRefund: true, categoryId: 9, counterpartyName: 'Amazon', accountName: CARD_ACCOUNT, importId: CARD_IMPORT },
  // The card's own payment-received leg — a transfer, never income.
  { id: 4, isoDate: '2026-06-01', paise: 340_000, direction: 'in', transferRole: 'cc_payment_received', accountName: CARD_ACCOUNT, importId: CARD_IMPORT },

  // --- Bank statement (import 12) ---
  // The bill payment that settled statement 11 — linked, so excluded; the items above are the spend.
  { id: 5, isoDate: '2026-06-15', paise: 340_000, direction: 'out', transferRole: 'cc_payment', categoryId: 8, accountName: BANK_ACCOUNT, importId: BANK_IMPORT, linkedImportId: CARD_IMPORT },
  { id: 6, isoDate: '2026-06-20', paise: 90_000, direction: 'out', categoryId: 3, counterpartyName: 'Landlord', accountName: BANK_ACCOUNT, importId: BANK_IMPORT },
  { id: 7, isoDate: '2026-06-25', paise: 5_000_000, direction: 'in', counterpartyName: 'Employer', accountName: BANK_ACCOUNT, importId: BANK_IMPORT },
  { id: 8, isoDate: '2026-06-26', paise: 2_700_000, direction: 'self', accountName: BANK_ACCOUNT, importId: BANK_IMPORT },

  // --- Lending: principal excluded, interest/gift counted, splits partially counted ---
  { id: 9, isoDate: '2026-06-05', paise: 500_000, direction: 'out', transferRole: 'lent', personId: 1, accountName: BANK_ACCOUNT },
  { id: 10, isoDate: '2026-06-06', paise: 5_000, direction: 'in', transferRole: 'interest_received', personId: 1, accountName: BANK_ACCOUNT },
  { id: 11, isoDate: '2026-06-08', paise: 20_000, direction: 'out', transferRole: 'gift_given', personId: 1, accountName: BANK_ACCOUNT },
  {
    id: 12, isoDate: '2026-06-09', paise: 10_000, direction: 'in', transferRole: 'repaid_to_me', personId: 1, accountName: BANK_ACCOUNT,
    allocations: [{ part: 'repayment', paise: 6_000 }, { part: 'interest', paise: 1_000 }],
  },
  {
    id: 13, isoDate: '2026-06-10', paise: 10_000, direction: 'out', transferRole: 'lent', personId: 1, accountName: BANK_ACCOUNT,
    allocations: [{ part: 'principal', paise: 6_000 }, { part: 'interest', paise: 1_000 }],
  },

  // --- July 2026: a bill payment with no linked statement — its items were never imported ---
  { id: 14, isoDate: '2026-07-15', paise: 400_000, direction: 'out', categoryId: 8, counterpartyName: 'Axis Credit Card', accountName: BANK_ACCOUNT, importId: BANK_IMPORT },
];

const JUNE: TxnFilter = { from: { year: 2026, month: 6 }, to: { year: 2026, month: 6 } };

function analyticsTxn(row: Fixture): AnalyticsTxn {
  return {
    isoDate: row.isoDate,
    paise: row.paise,
    direction: row.direction,
    isRefund: row.isRefund ?? false,
    categoryId: row.categoryId ?? null,
    subcategoryId: null,
    counterpartyName: row.counterpartyName ?? null,
    counterpartyVpa: null,
    accountName: row.accountName ?? null,
    personId: row.personId ?? null,
    transferRole: row.transferRole ?? null,
    loanAllocations: row.allocations,
  };
}

/** The stored-row shape `matchesFilter` needs, plus the id so both sides can be compared. */
function filterableTxn(row: Fixture): FilterableTxn & { id: number } {
  return {
    id: row.id,
    isoDate: row.isoDate,
    paise: row.paise,
    direction: row.direction,
    categoryId: row.categoryId ?? null,
    subcategoryId: null,
    accountName: row.accountName ?? null,
    personId: row.personId ?? null,
    rawDetails: '',
    counterpartyVpa: null,
    counterpartyName: row.counterpartyName ?? null,
    remarks: null,
    note: null,
    rawTag: null,
    needsReview: false,
    isRefund: row.isRefund ?? false,
    createdAt: '2026-06-30T00:00:00.000Z',
  };
}

function inJune(row: Fixture): boolean {
  return row.isoDate.startsWith('2026-06');
}

function seed(fixture: Fixture[] = FIXTURE): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(CREATE_TABLES_SQL);
  sqlite.exec(`
    insert into categories (id, name) values (1, 'Shopping'), (2, 'Food'), (3, 'Rent'), (8, 'Credit Card Payment'), (9, 'CashBack');
    insert into people (id, name) values (1, 'Person');
    insert into loans (id, name, person_id, kind, created_at, updated_at)
    values (1, 'Loan', 1, 'lent', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z');
    insert into imports (id, source_label, imported_at, card_last4, statement_month, total_due_paise)
    values (${CARD_IMPORT}, 'Axis Credit Card', '2026-06-30T00:00:00.000Z', '4723', '2026-06', 340000),
           (${BANK_IMPORT}, 'Axis Bank', '2026-06-30T00:00:00.000Z', null, null, null);
  `);

  const insertTxn = sqlite.prepare(`
    insert into transactions (
      id, iso_date, paise, direction, kind, category_id, person_id, counterparty_name,
      account_name, transfer_role, import_id, linked_import_id, is_refund, source, dedupe_key, created_at
    ) values (?, ?, ?, ?, 'other', ?, ?, ?, ?, ?, ?, ?, ?, 'axis', ?, '2026-06-30T00:00:00.000Z')
  `);
  const insertAllocation = sqlite.prepare(`
    insert into loan_allocations (txn_id, loan_id, part, paise, created_at)
    values (?, 1, ?, ?, '2026-06-30T00:00:00.000Z')
  `);

  for (const row of fixture) {
    insertTxn.run(
      row.id,
      row.isoDate,
      row.paise,
      row.direction,
      row.categoryId ?? null,
      row.personId ?? null,
      row.counterpartyName ?? null,
      row.accountName ?? null,
      row.transferRole ?? null,
      row.importId ?? null,
      row.linkedImportId ?? null,
      row.isRefund ? 1 : 0,
      `fixture-${row.id}`,
    );
    for (const allocation of row.allocations ?? []) {
      insertAllocation.run(row.id, allocation.part, allocation.paise);
    }
  }
  return sqlite;
}

/** Run an unexecuted Drizzle builder against the fixture database. Columns come back positionally. */
function rows<Row extends SQLInputValue[]>(
  sqlite: DatabaseSync,
  query: { toSQL: () => { sql: string; params: unknown[] } },
): Row[] {
  const compiled = query.toSQL();
  const statement = sqlite.prepare(compiled.sql);
  statement.setReturnArrays(true);
  return statement.all(...(compiled.params as SQLInputValue[])) as unknown as Row[];
}

function proxyDb(): AggregateDb {
  return drizzle(async () => ({ rows: [] }), { schema }) as unknown as AggregateDb;
}

/** Compare two spend groupings independently of how each side breaks ties. */
function sortGroups(groups: { key: string; spentPaise: number; txnCount: number }[]) {
  return [...groups].sort((a, b) => b.spentPaise - a.spentPaise || a.key.localeCompare(b.key));
}

describe('credit-card counting: no double counting in either direction', () => {
  let sqlite: DatabaseSync;

  beforeEach(() => {
    sqlite = seed();
  });

  afterEach(() => {
    sqlite.close();
  });

  it('counts the individual card items and excludes the linked bill payment', () => {
    const [totals] = rows<[number, number, number, number]>(sqlite, periodTotalsQuery(proxyDb(), JUNE));
    const [spentPaise, receivedPaise, refundPaise, txnCount] = totals;

    // The card statement's own items are the spend: ₹2,500 + ₹1,200.
    const cardItemSpend = 250_000 + 120_000;
    // Everything else that legitimately spends in June: rent + gift + the split remainder.
    const otherSpend = 90_000 + 20_000 + 4_000;
    expect(spentPaise).toBe(cardItemSpend + otherSpend);
    // The ₹3,400 bill payment is counted ONCE — via the items, never as the bank leg as well.
    expect(spentPaise).not.toBe(cardItemSpend + otherSpend + 340_000);

    // Neither the bank leg nor the card's payment-received leg is income.
    expect(receivedPaise).toBe(5_000_000 + 5_000 + 4_000);
    expect(refundPaise).toBe(30_000);
    expect(txnCount).toBe(9);
  });

  it('keeps an UNLINKED bill payment countable, so unimported card spending is not lost', () => {
    const july: TxnFilter = { from: { year: 2026, month: 7 }, to: { year: 2026, month: 7 } };
    const [totals] = rows<[number, number, number, number]>(sqlite, periodTotalsQuery(proxyDb(), july));
    expect(totals[0]).toBe(400_000);
    expect(totals[3]).toBe(1);
  });

  it('lists every card statement line item in Activity', () => {
    const listed = rows<SQLInputValue[]>(sqlite, txnListQuery(proxyDb(), JUNE, 100)).map((row) => row[0] as number);
    const cardItems = FIXTURE.filter((row) => row.importId === CARD_IMPORT).map((row) => row.id);

    // Purchases, the merchant refund AND the payment-received leg are all real, visible rows: a
    // transaction is excluded from TOTALS by its role, never hidden from the list.
    expect(cardItems).not.toHaveLength(0);
    for (const id of cardItems) expect(listed).toContain(id);
    // The linked bank bill payment stays visible too, so it can be inspected and unlinked.
    expect(listed).toContain(5);

    const [count] = rows<[number]>(sqlite, txnCountQuery(proxyDb(), JUNE));
    expect(count[0]).toBe(FIXTURE.filter(inJune).length);
  });

  it("plots the card items, not the bill payment, in Home's monthly and yearly trends", () => {
    const monthly = rows<[number, number, number, number, number]>(
      sqlite,
      monthlyForYearQuery(proxyDb(), 2026),
    ).map(([month, spentPaise, receivedPaise, refundPaise, txnCount]) => ({
      month,
      spentPaise,
      receivedPaise,
      refundPaise,
      txnCount,
    }));
    const june = monthly.find((m) => m.month === 6)!;
    const july = monthly.find((m) => m.month === 7)!;

    expect(june.spentPaise).toBe(250_000 + 120_000 + 90_000 + 20_000 + 4_000);
    expect(june.spentPaise - june.refundPaise).toBe(454_000); // the net-spent bar height
    expect(july.spentPaise).toBe(400_000); // the unlinked bill payment still plots

    const [yearly] = rows<[number, number, number, number, number]>(sqlite, yearlyTotalsQuery(proxyDb()));
    expect(yearly[1]).toBe(june.spentPaise + july.spentPaise);
  });

  it('attributes card-item spend to the card account, not to the bank account', () => {
    const byAccount = rows<[string, number, number]>(sqlite, accountSpendQuery(proxyDb(), JUNE)).map(
      ([key, spentPaise, txnCount]) => ({ key, spentPaise, txnCount }),
    );
    expect(byAccount).toContainEqual({ key: CARD_ACCOUNT, spentPaise: 370_000, txnCount: 2 });
    // ₹3,400 (the linked bill payment) is not attributed to the bank account.
    expect(byAccount).toContainEqual({ key: BANK_ACCOUNT, spentPaise: 90_000 + 20_000 + 4_000, txnCount: 3 });
  });
});

describe('SQL aggregates and the pure predicate agree on the same fixture', () => {
  let sqlite: DatabaseSync;
  const june = FIXTURE.filter(inJune).map(analyticsTxn);
  const period = { year: 2026, month: 6 };

  beforeEach(() => {
    sqlite = seed();
  });

  afterEach(() => {
    sqlite.close();
  });

  it('period totals match', () => {
    const [sqlTotals] = rows<[number, number, number, number]>(sqlite, periodTotalsQuery(proxyDb(), JUNE));
    const pure = totalsFor(june);
    expect(sqlTotals).toEqual([pure.spentPaise, pure.receivedPaise, pure.refundPaise, pure.txnCount]);
  });

  it('the Activity summary matches', () => {
    const [summary] = rows<[number, number, number, number]>(sqlite, summaryQuery(proxyDb(), JUNE));
    const pure = totalsFor(june);
    expect(summary[0]).toBe(pure.spentPaise);
    expect(summary[1]).toBe(pure.receivedPaise);
    // `savedCount` is every matching row, countable or not — the list length, not a money total.
    expect(summary[3]).toBe(june.length);
  });

  it('the category breakdown matches', () => {
    const sqlRows = rows<[number | null, number, number]>(sqlite, categoryBreakdownQuery(proxyDb(), JUNE)).map(
      ([categoryId, spentPaise, txnCount]) => ({ categoryId, spentPaise, txnCount }),
    );
    expect(sqlRows).toEqual(categoryBreakdown(june, period));
    // The breakdown bars must sum to the period's Spent tile.
    const [totals] = rows<[number, number, number, number]>(sqlite, periodTotalsQuery(proxyDb(), JUNE));
    expect(sqlRows.reduce((sum, r) => sum + r.spentPaise, 0)).toBe(totals[0]);
  });

  it('the merchant, account and person breakdowns match', () => {
    const merchants = rows<[string, number, number]>(sqlite, merchantSpendQuery(proxyDb(), JUNE)).map(
      ([key, spentPaise, txnCount]) => ({ key, spentPaise, txnCount }),
    );
    expect(sortGroups(merchants)).toEqual(sortGroups(merchantSpend(june, period)));

    const accounts = rows<[string, number, number]>(sqlite, accountSpendQuery(proxyDb(), JUNE)).map(
      ([key, spentPaise, txnCount]) => ({ key, spentPaise, txnCount }),
    );
    expect(sortGroups(accounts)).toEqual(sortGroups(accountSpend(june, period)));

    const people = rows<[number | null, number, number]>(sqlite, personSpendQuery(proxyDb(), JUNE)).map(
      ([personId, spentPaise, txnCount]) => ({ personId, spentPaise, txnCount }),
    );
    expect(people).toEqual(personSpend(june, period));
  });

  it("Home's monthly and yearly trend series match", () => {
    const all = FIXTURE.map(analyticsTxn);

    const sqlMonthly = new Map(
      rows<[number, number, number, number, number]>(sqlite, monthlyForYearQuery(proxyDb(), 2026)).map(
        ([month, spentPaise, receivedPaise, refundPaise, txnCount]) => [
          month,
          { spentPaise, receivedPaise, refundPaise, txnCount },
        ],
      ),
    );
    // The SQL returns only months that have rows; the pure function zero-fills all twelve.
    for (const point of monthlyForYear(all, 2026)) {
      const sqlPoint = sqlMonthly.get(point.month) ?? {
        spentPaise: 0,
        receivedPaise: 0,
        refundPaise: 0,
        txnCount: 0,
      };
      expect({ month: point.month, ...sqlPoint }).toEqual({
        month: point.month,
        spentPaise: point.totals.spentPaise,
        receivedPaise: point.totals.receivedPaise,
        refundPaise: point.totals.refundPaise,
        txnCount: point.totals.txnCount,
      });
    }

    const sqlYearly = rows<[number, number, number, number, number]>(sqlite, yearlyTotalsQuery(proxyDb())).map(
      ([year, spentPaise, receivedPaise, refundPaise, txnCount]) => ({
        year,
        spentPaise,
        receivedPaise,
        refundPaise,
        txnCount,
      }),
    );
    expect(sqlYearly).toEqual(
      yearlyTotals(all).map((point) => ({
        year: point.year,
        spentPaise: point.totals.spentPaise,
        receivedPaise: point.totals.receivedPaise,
        refundPaise: point.totals.refundPaise,
        txnCount: point.totals.txnCount,
      })),
    );
  });

  it('the cashback summary matches', () => {
    const [cashback] = rows<[number, number]>(sqlite, cashbackQuery(proxyDb(), JUNE));
    const pure = cashbackTotals(june, period);
    expect(cashback).toEqual([pure.totalPaise, pure.count]);
  });

  it('the row-selection filters agree (buildTxnConditions vs matchesFilter)', () => {
    const filters: TxnFilter[] = [
      {},
      JUNE,
      { direction: 'out' },
      { direction: 'in', isRefund: false },
      { isRefund: true },
      { account: CARD_ACCOUNT },
      { account: BANK_ACCOUNT, direction: 'out' },
      { categoryId: 8 },
      { categoryId: null },
      { personId: 1 },
      { personId: null },
      { minPaise: 100_000, maxPaise: 500_000 },
      { search: 'amazon' },
      { ...JUNE, account: CARD_ACCOUNT, direction: 'out' },
    ];

    for (const filter of filters) {
      const sqlIds = rows<SQLInputValue[]>(sqlite, txnListQuery(proxyDb(), filter, 100))
        .map((row) => row[0] as number)
        .sort((a, b) => a - b);
      const pureIds = filterTxns(FIXTURE.map(filterableTxn), filter)
        .map((row) => row.id)
        .sort((a, b) => a - b);
      expect(sqlIds).toEqual(pureIds);
    }
  });

  it('the Excel workbook totals match the SQL totals', () => {
    const exportTxns: ExportTxn[] = FIXTURE.filter(inJune).map((row) => ({
      isoDate: row.isoDate,
      time: '',
      paise: row.paise,
      countablePaise: countablePaise(analyticsTxn(row)),
      direction: row.direction,
      isRefund: row.isRefund ?? false,
      counterparty: row.counterpartyName ?? '',
      categoryName: '',
      subcategoryName: '',
      paymentMode: '',
      person: '',
      account: row.accountName ?? '',
      remarks: '',
      ref: '',
    }));

    const workbook = buildFilteredWorkbook(exportTxns, 'parity.xlsx');
    const summarySheet = workbook.sheets[0];
    const grandTotal = summarySheet.rows[summarySheet.rows.length - 1];
    const [totals] = rows<[number, number, number, number]>(sqlite, periodTotalsQuery(proxyDb(), JUNE));

    // Money cells are rupees (paise ÷ 100); the export lists every row but totals only countable money.
    expect(grandTotal[1].value).toBe(totals[0] / 100);
    expect(grandTotal[2].value).toBe(totals[1] / 100);
    expect(grandTotal[3].value).toBe(totals[2] / 100);
    expect(grandTotal[4].value).toBe((totals[0] - totals[2]) / 100);
    expect(grandTotal[5].value).toBe(totals[3]);
    // Every row is still listed, including the excluded legs.
    expect(workbook.sheets[1].rows.length).toBe(exportTxns.length + 5);
  });
});

/**
 * Every role × direction × refund combination, each parked in its own calendar month so the
 * aggregates can be read one row at a time. This is what catches the SQL role list drifting from
 * `EXCLUDED_FROM_TOTALS_ROLES` — an aggregate-level comparison could hide compensating errors.
 */
describe('SQL and the pure predicate agree on every role, direction and split shape', () => {
  const ROLES: (TransferRole | null)[] = [null, ...(Object.keys(ROLE_META) as TransferRole[])];
  const SPLITS: (Fixture['allocations'] | undefined)[] = [
    undefined,
    ...LOAN_PARTS.map(({ part }) => [{ part, paise: 4_000 }]),
    [{ part: null, paise: 4_000 }],
    [{ part: 'principal' as LoanPart, paise: 3_000 }, { part: 'interest' as LoanPart, paise: 2_000 }],
    // A slice amount is validated positive on write; a corrupt/negative one must not INCREASE the
    // countable amount on either side.
    [{ part: 'principal' as LoanPart, paise: -1_000 }],
  ];

  const cases: { row: Fixture; label: string }[] = [];
  for (const role of ROLES) {
    for (const direction of ['out', 'in', 'self'] as Direction[]) {
      for (const isRefund of [false, true]) {
        for (const allocations of SPLITS) {
          // Each row gets its own calendar month so the aggregates can be read one row at a time.
          const slot = cases.length;
          const year = 2000 + Math.floor(slot / 12);
          const month = (slot % 12) + 1;
          cases.push({
            row: {
              id: slot + 1,
              isoDate: `${year}-${String(month).padStart(2, '0')}-15`,
              paise: 10_000,
              direction,
              transferRole: role,
              isRefund,
              accountName: BANK_ACCOUNT,
              personId: 1,
              allocations,
            },
            label: `${role ?? 'no role'} · ${direction}${isRefund ? ' · refund' : ''} · ${
              allocations ? allocations.map((a) => `${a.part ?? 'legacy'}(${a.paise})`).join('+') : 'no split'
            }`,
          });
        }
      }
    }
  }

  it(`agrees on all ${cases.length} combinations`, () => {
    const sqlite = seed(cases.map((c) => c.row));
    try {
      const disagreements: string[] = [];
      for (const { row, label } of cases) {
        const month = {
          year: parseInt(row.isoDate.slice(0, 4), 10),
          month: parseInt(row.isoDate.slice(5, 7), 10),
        };
        const [sqlTotals] = rows<[number, number, number, number]>(
          sqlite,
          periodTotalsQuery(proxyDb(), { from: month, to: month }),
        );
        const pure = totalsFor([analyticsTxn(row)]);
        const expected = [pure.spentPaise, pure.receivedPaise, pure.refundPaise, pure.txnCount];
        if (JSON.stringify(sqlTotals) !== JSON.stringify(expected)) {
          disagreements.push(`${label}: sql=${JSON.stringify(sqlTotals)} pure=${JSON.stringify(expected)}`);
        }
      }
      expect(disagreements).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});
