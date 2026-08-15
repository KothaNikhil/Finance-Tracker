import { accountSpend, cashbackTotals, merchantSpend, personSpend } from '../reports';
import type { AnalyticsTxn } from '../types';

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

const SAMPLE: AnalyticsTxn[] = [
  txn({ isoDate: '2026-05-01', paise: 45000, direction: 'out', counterpartyName: 'Zomato', accountName: 'Axis - 15', personId: 1 }),
  txn({ isoDate: '2026-05-02', paise: 30000, direction: 'out', counterpartyName: 'Zomato', accountName: 'Axis - 15', personId: 1 }),
  txn({ isoDate: '2026-05-03', paise: 20000, direction: 'out', counterpartyName: 'Zepto', accountName: 'KVB - 22' }),
  txn({ isoDate: '2026-05-04', paise: 10000, direction: 'out', counterpartyVpa: 'shop@ptys' }), // no name → VPA key
  txn({ isoDate: '2026-05-05', paise: 500000, direction: 'in', counterpartyName: 'Boss', accountName: 'Axis - 15' }), // income, not spend
  txn({ isoDate: '2026-05-06', paise: 5000, direction: 'in', isRefund: true, counterpartyName: 'Paytm', accountName: 'Axis - 15' }), // cashback
  txn({ isoDate: '2026-05-07', paise: 999999, direction: 'self', accountName: 'Axis - 15' }), // self-transfer, excluded
  txn({ isoDate: '2025-12-15', paise: 70000, direction: 'out', counterpartyName: 'Zomato', accountName: 'Axis - 15', personId: 1 }), // prior year
];

describe('merchantSpend', () => {
  it('groups money-out by merchant name, biggest first, within a year', () => {
    const rows = merchantSpend(SAMPLE, { year: 2026 });
    expect(rows).toEqual([
      { key: 'Zomato', spentPaise: 75000, txnCount: 2 },
      { key: 'Zepto', spentPaise: 20000, txnCount: 1 },
      { key: 'shop@ptys', spentPaise: 10000, txnCount: 1 }, // fell back to the UPI id
    ]);
  });

  it('all-time (null filter) folds in other years', () => {
    const rows = merchantSpend(SAMPLE, null);
    expect(rows.find((r) => r.key === 'Zomato')).toEqual({ key: 'Zomato', spentPaise: 145000, txnCount: 3 });
  });

  it('excludes income, refunds and self-transfers', () => {
    const rows = merchantSpend(SAMPLE, { year: 2026 });
    expect(rows.find((r) => r.key === 'Boss')).toBeUndefined(); // income
    expect(rows.find((r) => r.key === 'Paytm')).toBeUndefined(); // refund
    const total = rows.reduce((s, r) => s + r.spentPaise, 0);
    expect(total).toBe(45000 + 30000 + 20000 + 10000); // no self-transfer
  });
});

describe('accountSpend', () => {
  it('groups money-out by funding account, biggest first', () => {
    expect(accountSpend(SAMPLE, { year: 2026 })).toEqual([
      { key: 'Axis - 15', spentPaise: 75000, txnCount: 2 },
      { key: 'KVB - 22', spentPaise: 20000, txnCount: 1 },
      { key: '(unknown)', spentPaise: 10000, txnCount: 1 }, // the VPA-only row has no account
    ]);
  });
});

describe('personSpend', () => {
  it('groups money-out by person with a null "not assigned" bucket', () => {
    expect(personSpend(SAMPLE, { year: 2026 })).toEqual([
      { personId: 1, spentPaise: 75000, txnCount: 2 },
      { personId: null, spentPaise: 30000, txnCount: 2 }, // Zepto + VPA-only, both unassigned
    ]);
  });
});

describe('cashbackTotals', () => {
  it('sums only money-in flagged as refund', () => {
    expect(cashbackTotals(SAMPLE, { year: 2026 })).toEqual({ totalPaise: 5000, count: 1 });
  });

  it('is zero when there is no cashback', () => {
    expect(cashbackTotals(SAMPLE, { year: 2025 })).toEqual({ totalPaise: 0, count: 0 });
  });
});
