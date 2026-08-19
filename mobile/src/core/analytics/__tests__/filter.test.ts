import { filterTxns, isEmptyFilter, matchesFilter, monthKeyOf, type FilterableTxn } from '../filter';

function t(over: Partial<FilterableTxn> & Pick<FilterableTxn, 'isoDate'>): FilterableTxn {
  return {
    direction: 'out',
    categoryId: null,
    subcategoryId: null,
    accountName: null,
    personId: null,
    rawDetails: null,
    counterpartyVpa: null,
    counterpartyName: null,
    remarks: null,
    rawTag: null,
    needsReview: false,
    ...over,
  };
}

describe('monthKeyOf', () => {
  it('reads the year and 1-based month from an ISO date', () => {
    expect(monthKeyOf('2026-05-14')).toEqual({ year: 2026, month: 5 });
  });
});

describe('matchesFilter', () => {
  const txn = t({ isoDate: '2026-05-14', direction: 'out', categoryId: 3, subcategoryId: 7, accountName: 'Axis Bank - 15', personId: 2 });

  it('empty filter matches everything', () => {
    expect(matchesFilter(txn, {})).toBe(true);
  });

  it('applies an inclusive month range', () => {
    expect(matchesFilter(txn, { from: { year: 2026, month: 5 }, to: { year: 2026, month: 5 } })).toBe(true);
    expect(matchesFilter(txn, { from: { year: 2026, month: 6 } })).toBe(false); // before range
    expect(matchesFilter(txn, { to: { year: 2026, month: 4 } })).toBe(false); // after range
    expect(matchesFilter(txn, { from: { year: 2025, month: 12 }, to: { year: 2026, month: 8 } })).toBe(true); // spans years
  });

  it('matches category / sub-category (null = the empty bucket)', () => {
    expect(matchesFilter(txn, { categoryId: 3 })).toBe(true);
    expect(matchesFilter(txn, { categoryId: 4 })).toBe(false);
    expect(matchesFilter(txn, { subcategoryId: 7 })).toBe(true);
    expect(matchesFilter(t({ isoDate: '2026-05-01', categoryId: null }), { categoryId: null })).toBe(true);
    expect(matchesFilter(txn, { categoryId: null })).toBe(false); // txn IS categorized
  });

  it('matches account, person and direction', () => {
    expect(matchesFilter(txn, { account: 'Axis Bank - 15' })).toBe(true);
    expect(matchesFilter(txn, { account: 'KVB' })).toBe(false);
    expect(matchesFilter(txn, { personId: 2 })).toBe(true);
    expect(matchesFilter(t({ isoDate: '2026-05-01', personId: null }), { personId: null })).toBe(true);
    expect(matchesFilter(txn, { direction: 'out' })).toBe(true);
    expect(matchesFilter(txn, { direction: 'in' })).toBe(false);
  });

  it('matches needsReview', () => {
    const review = t({ isoDate: '2026-05-01', needsReview: true });
    expect(matchesFilter(review, { needsReview: true })).toBe(true);
    expect(matchesFilter(txn, { needsReview: true })).toBe(false); // txn is not flagged
    expect(matchesFilter(review, {})).toBe(true); // undefined = no constraint
  });

  it('ANDs multiple constraints together', () => {
    expect(matchesFilter(txn, { categoryId: 3, account: 'Axis Bank - 15', direction: 'out' })).toBe(true);
    expect(matchesFilter(txn, { categoryId: 3, account: 'KVB' })).toBe(false);
  });

  it('free-text search matches name / raw details / VPA, case-insensitively', () => {
    const zomato = t({
      isoDate: '2026-05-14',
      counterpartyName: 'Zomato Limited',
      rawDetails: 'Paid to Zomato Limited',
      counterpartyVpa: 'zomato@ptys',
    });
    expect(matchesFilter(zomato, { search: 'zomato' })).toBe(true); // name
    expect(matchesFilter(zomato, { search: 'ZOMATO' })).toBe(true); // case-insensitive
    expect(matchesFilter(zomato, { search: 'paid to' })).toBe(true); // raw details
    expect(matchesFilter(zomato, { search: '@ptys' })).toBe(true); // vpa
    expect(matchesFilter(t({ isoDate: '2026-05-14', remarks: 'Team lunch' }), { search: 'lunch' })).toBe(true); // note
    expect(matchesFilter(t({ isoDate: '2026-05-14', rawTag: '#Food' }), { search: 'food' })).toBe(true); // tag
    expect(matchesFilter(zomato, { search: 'swiggy' })).toBe(false); // no match
    expect(matchesFilter(zomato, { search: '   ' })).toBe(true); // blank = no constraint
    // ANDs with other constraints
    expect(matchesFilter(zomato, { search: 'zomato', direction: 'in' })).toBe(false);
  });

  it('search tolerates null text fields', () => {
    const bare = t({ isoDate: '2026-05-14' }); // name/raw/vpa all null
    expect(matchesFilter(bare, { search: 'anything' })).toBe(false);
    expect(matchesFilter(bare, { search: '' })).toBe(true);
  });
});

describe('filterTxns', () => {
  const txns = [
    t({ isoDate: '2026-05-01', categoryId: 1 }),
    t({ isoDate: '2026-06-01', categoryId: 2 }),
    t({ isoDate: '2026-05-20', categoryId: 1 }),
  ];
  it('keeps only matching rows, preserving order', () => {
    const out = filterTxns(txns, { categoryId: 1 });
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.isoDate)).toEqual(['2026-05-01', '2026-05-20']);
  });
});

describe('isEmptyFilter', () => {
  it('is true only when nothing is constrained', () => {
    expect(isEmptyFilter({})).toBe(true);
    expect(isEmptyFilter({ categoryId: null })).toBe(false);
    expect(isEmptyFilter({ from: { year: 2026, month: 1 } })).toBe(false);
    expect(isEmptyFilter({ search: '  ' })).toBe(true); // blank search is not a constraint
    expect(isEmptyFilter({ search: 'zomato' })).toBe(false);
  });
});
