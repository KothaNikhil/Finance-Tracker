import {
  categoryBreakdown,
  listYears,
  monthlyForYear,
  MONTH_LABELS,
  monthOf,
  subcategoryBreakdown,
  totalsFor,
  totalsForPeriod,
  yearlyTotals,
  yearOf,
} from '../analytics';
import type { AnalyticsTxn } from '../types';

/** Compact helper to build a test transaction; sensible defaults, override what matters. */
function txn(over: Partial<AnalyticsTxn> & Pick<AnalyticsTxn, 'isoDate' | 'paise' | 'direction'>): AnalyticsTxn {
  return {
    isRefund: false,
    categoryId: null,
    subcategoryId: null,
    counterpartyName: null,
    counterpartyVpa: null,
    accountName: null,
    personId: null,
    ...over,
  };
}

// A small realistic set spanning two years, with spend, income, refunds and self-transfers.
const SAMPLE: AnalyticsTxn[] = [
  // May 2026
  txn({ isoDate: '2026-05-02', paise: 45000, direction: 'out', categoryId: 1 }), // ₹450 food
  txn({ isoDate: '2026-05-10', paise: 38000, direction: 'out', categoryId: 2 }), // ₹380 groceries
  txn({ isoDate: '2026-05-15', paise: 12000, direction: 'out', categoryId: 1 }), // ₹120 food
  txn({ isoDate: '2026-05-20', paise: 500000, direction: 'in' }),                // ₹5000 income
  txn({ isoDate: '2026-05-22', paise: 5000, direction: 'in', isRefund: true, categoryId: 9 }), // ₹50 refund
  txn({ isoDate: '2026-05-25', paise: 2700000, direction: 'self' }),             // ₹27000 self-transfer (excluded)
  txn({ isoDate: '2026-05-28', paise: 9000, direction: 'out' }),                 // ₹90 uncategorized spend
  // Aug 2026
  txn({ isoDate: '2026-08-03', paise: 60000, direction: 'out', categoryId: 2 }), // ₹600 groceries
  // Dec 2025 (previous year)
  txn({ isoDate: '2025-12-31', paise: 100000, direction: 'out', categoryId: 1 }), // ₹1000 food
];

describe('date part helpers', () => {
  it('reads year and month from an ISO date', () => {
    expect(yearOf('2026-05-14')).toBe(2026);
    expect(monthOf('2026-05-14')).toBe(5);
    expect(monthOf('2026-01-01')).toBe(1);
  });
});

describe('totalsFor', () => {
  it('excludes self-transfers from every total', () => {
    const t = totalsFor(SAMPLE);
    // spent = 450 + 380 + 120 + 90 (May) + 600 (Aug) + 1000 (Dec) = 2640
    expect(t.spentPaise).toBe(264000);
    // the ₹27000 self-transfer must not appear anywhere
    expect(t.receivedPaise).toBe(500000); // only the ₹5000 income, NOT the refund
    expect(t.refundPaise).toBe(5000);
    // self-transfer excluded → not in spent/received/refund and not counted
    expect(t.txnCount).toBe(8); // 9 txns minus the 1 self-transfer
  });

  it('nets refunds out of spend and never treats them as income', () => {
    const t = totalsFor(SAMPLE);
    expect(t.netSpentPaise).toBe(t.spentPaise - t.refundPaise);
    expect(t.netSpentPaise).toBe(264000 - 5000);
    // refund is money-in but must be excluded from receivedPaise
    expect(t.receivedPaise).toBe(500000);
  });

  it('is all zeros for an empty list', () => {
    const t = totalsFor([]);
    expect(t).toEqual({ spentPaise: 0, receivedPaise: 0, refundPaise: 0, netSpentPaise: 0, txnCount: 0 });
  });

  it('allows net spent to go negative when refunds exceed spend', () => {
    const t = totalsFor([
      txn({ isoDate: '2026-05-01', paise: 1000, direction: 'out' }),
      txn({ isoDate: '2026-05-02', paise: 5000, direction: 'in', isRefund: true }),
    ]);
    expect(t.netSpentPaise).toBe(-4000);
  });
});

describe('totalsForPeriod', () => {
  it('filters to a single month', () => {
    const may = totalsForPeriod(SAMPLE, { year: 2026, month: 5 });
    expect(may.spentPaise).toBe(45000 + 38000 + 12000 + 9000);
    expect(may.receivedPaise).toBe(500000);
    expect(may.refundPaise).toBe(5000);
  });

  it('filters to a whole year', () => {
    const y2026 = totalsForPeriod(SAMPLE, { year: 2026 });
    expect(y2026.spentPaise).toBe(45000 + 38000 + 12000 + 9000 + 60000);
    const y2025 = totalsForPeriod(SAMPLE, { year: 2025 });
    expect(y2025.spentPaise).toBe(100000);
  });
});

describe('monthlyForYear', () => {
  it('always returns 12 ordered months, zero-filled where empty', () => {
    const months = monthlyForYear(SAMPLE, 2026);
    expect(months).toHaveLength(12);
    expect(months.map((m) => m.label)).toEqual([...MONTH_LABELS]);
    // May (index 4) has spend; net = 450+380+120+90 - 50 refund
    expect(months[4].totals.netSpentPaise).toBe(45000 + 38000 + 12000 + 9000 - 5000);
    // Aug (index 7)
    expect(months[7].totals.spentPaise).toBe(60000);
    // January has nothing
    expect(months[0].totals).toEqual({
      spentPaise: 0, receivedPaise: 0, refundPaise: 0, netSpentPaise: 0, txnCount: 0,
    });
  });

  it('does not leak another year into the months', () => {
    const months = monthlyForYear(SAMPLE, 2025);
    expect(months[11].totals.spentPaise).toBe(100000); // Dec 2025
    expect(months[4].totals.spentPaise).toBe(0); // no May 2025
  });
});

describe('listYears', () => {
  it('lists years present, most recent first', () => {
    expect(listYears(SAMPLE)).toEqual([2026, 2025]);
    expect(listYears([])).toEqual([]);
  });
});

describe('yearlyTotals', () => {
  it('gives one entry per year, most recent first, self-transfers excluded', () => {
    const years = yearlyTotals(SAMPLE);
    expect(years.map((y) => y.year)).toEqual([2026, 2025]);
    expect(years[0].totals.spentPaise).toBe(45000 + 38000 + 12000 + 9000 + 60000);
    expect(years[1].totals.spentPaise).toBe(100000);
  });
});

describe('categoryBreakdown', () => {
  it('sums money-out per category for a period, biggest first', () => {
    const may = categoryBreakdown(SAMPLE, { year: 2026, month: 5 });
    // cat 1 (food): 450 + 120 = 570; cat 2 (groceries): 380; null (uncat): 90
    expect(may).toEqual([
      { categoryId: 1, spentPaise: 57000, txnCount: 2 },
      { categoryId: 2, spentPaise: 38000, txnCount: 1 },
      { categoryId: null, spentPaise: 9000, txnCount: 1 },
    ]);
  });

  it('counts only money out — income and refunds are not spend', () => {
    const may = categoryBreakdown(SAMPLE, { year: 2026, month: 5 });
    const sumOfBars = may.reduce((s, c) => s + c.spentPaise, 0);
    expect(sumOfBars).toBe(totalsForPeriod(SAMPLE, { year: 2026, month: 5 }).spentPaise);
    // the refund (category 9) must not appear as a spend bar
    expect(may.find((c) => c.categoryId === 9)).toBeUndefined();
  });

  it('never includes self-transfers', () => {
    const all = categoryBreakdown(SAMPLE, { year: 2026 });
    const sumOfBars = all.reduce((s, c) => s + c.spentPaise, 0);
    expect(sumOfBars).toBe(totalsForPeriod(SAMPLE, { year: 2026 }).spentPaise);
  });
});

describe('subcategoryBreakdown', () => {
  // Category 1 with two sub-categories (10, 11) plus one txn with no sub-category.
  const CAT: AnalyticsTxn[] = [
    txn({ isoDate: '2026-05-01', paise: 30000, direction: 'out', categoryId: 1, subcategoryId: 10 }),
    txn({ isoDate: '2026-05-05', paise: 20000, direction: 'out', categoryId: 1, subcategoryId: 10 }),
    txn({ isoDate: '2026-05-08', paise: 15000, direction: 'out', categoryId: 1, subcategoryId: 11 }),
    txn({ isoDate: '2026-05-09', paise: 5000, direction: 'out', categoryId: 1 }), // no sub-category
    txn({ isoDate: '2026-05-10', paise: 99999, direction: 'out', categoryId: 2, subcategoryId: 20 }), // other category
    txn({ isoDate: '2026-05-11', paise: 88888, direction: 'in', categoryId: 1, subcategoryId: 10 }), // money in, not spend
    txn({ isoDate: '2026-04-30', paise: 12345, direction: 'out', categoryId: 1, subcategoryId: 10 }), // other month
  ];

  it('splits one category into its sub-categories for a period, biggest first', () => {
    const rows = subcategoryBreakdown(CAT, 1, { year: 2026, month: 5 });
    expect(rows).toEqual([
      { subcategoryId: 10, spentPaise: 50000, txnCount: 2 },
      { subcategoryId: 11, spentPaise: 15000, txnCount: 1 },
      { subcategoryId: null, spentPaise: 5000, txnCount: 1 }, // no sub-category bucket
    ]);
  });

  it('bars sum to that category’s spend in the same period', () => {
    const rows = subcategoryBreakdown(CAT, 1, { year: 2026, month: 5 });
    const sum = rows.reduce((s, r) => s + r.spentPaise, 0);
    const catSpend = categoryBreakdown(CAT, { year: 2026, month: 5 }).find((c) => c.categoryId === 1);
    expect(sum).toBe(catSpend?.spentPaise);
  });

  it('ignores other categories, money in, and other periods', () => {
    const rows = subcategoryBreakdown(CAT, 1, { year: 2026, month: 5 });
    // category 2, the money-in row, and the April row must all be excluded
    expect(rows.reduce((s, r) => s + r.spentPaise, 0)).toBe(50000 + 15000 + 5000);
  });
});
