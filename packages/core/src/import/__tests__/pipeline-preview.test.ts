import { buildCategoryIndex } from '../../categorize';
import type { LearnedRule } from '../../categorize/types';
import { dryRunImportPreview } from '../pipeline';
import type { NormalizedTxn } from '../types';

const INDEX = buildCategoryIndex(
  [
    { id: 1, name: 'Groceries', emoji: '🛒' },
    { id: 2, name: 'Food & Dining', emoji: '🍽️' },
  ],
  [{ id: 11, categoryId: 1, name: 'Market' }],
);

function txn(overrides: Partial<NormalizedTxn>): NormalizedTxn {
  return {
    isoDate: '2026-08-03',
    time: '12:00:00',
    paise: 45000,
    direction: 'out',
    kind: 'paid',
    counterpartyName: 'Unknown shop',
    counterpartyVpa: null,
    accountName: 'Axis Bank',
    rawDetails: 'Paid to Unknown shop',
    rawTag: null,
    remarks: null,
    sourceRef: null,
    orderId: null,
    source: 'bank',
    ledgerSide: 'debit',
    dedupeKey: 'test:1',
    ...overrides,
  };
}

describe('dryRunImportPreview', () => {
  it('uses current learned categorization and resolves an honest display label without mutation', () => {
    const learned: LearnedRule[] = [
      {
        matcherType: 'merchant',
        matcherKey: 'corner store',
        categoryId: 1,
        subcategoryId: 11,
      },
    ];
    const input = {
      newTxns: [
        txn({
          counterpartyName: 'Corner Store',
          rawDetails: 'Paid to Corner Store',
          dedupeKey: 'test:corner',
        }),
      ],
    };
    const before = JSON.parse(JSON.stringify(input)) as typeof input;

    const result = dryRunImportPreview(input, INDEX, learned);

    expect(input).toEqual(before);
    expect(result.reviewCount).toBe(0);
    expect(result.rows[0]).toMatchObject({
      categoryId: 1,
      subcategoryId: 11,
      categoryLabel: '🛒 Groceries · Market',
      needsReview: false,
      via: 'learned',
    });
    expect(result.rows[0].txn).toBe(input.newTxns[0]);
  });

  it('matches save semantics by forcing self/sent rows into review', () => {
    const input = {
      newTxns: [
        txn({
          direction: 'self',
          kind: 'self',
          rawTag: '#💵 Self Transfer',
          dedupeKey: 'test:self',
        }),
        txn({
          kind: 'sent',
          rawTag: '#💵 Money Transfer',
          dedupeKey: 'test:sent',
        }),
        txn({
          direction: 'in',
          kind: 'received',
          rawDetails: 'Received from Employer',
          dedupeKey: 'test:income',
        }),
      ],
    };

    const result = dryRunImportPreview(input, INDEX);

    expect(result.reviewCount).toBe(2);
    expect(result.rows.map((row) => row.needsReview)).toEqual([true, true, false]);
  });

  it('keeps unmatched paid rows explicitly pending review', () => {
    const result = dryRunImportPreview(
      { newTxns: [txn({ dedupeKey: 'test:unknown' })] },
      INDEX,
    );

    expect(result.reviewCount).toBe(1);
    expect(result.rows[0]).toMatchObject({
      categoryId: null,
      categoryLabel: null,
      needsReview: true,
    });
  });
});
