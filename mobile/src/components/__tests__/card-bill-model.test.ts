import type { ImportRow, TransactionRow } from '@/core/db/schema';

import {
  partitionCardStatements,
  reconcileCardBill,
  summarizeCardStatementActivity,
} from '../card-bill-model';

const transaction = (
  id: number,
  direction: 'in' | 'out',
  paise: number,
  transferRole: string | null = null,
) =>
  ({
    id,
    direction,
    paise,
    transferRole,
  }) as TransactionRow;

const statement = (id: number) =>
  ({
    id,
    sourceLabel: `Statement ${id}`,
  }) as ImportRow;

describe('card bill state model', () => {
  it('reconciles statement due against the linked bank payment', () => {
    expect(reconcileCardBill(1_842_000, 1_842_000)).toEqual({
      statementDuePaise: 1_842_000,
      linkedPaymentPaise: 1_842_000,
      differencePaise: 0,
      matched: true,
    });
    expect(reconcileCardBill(1_842_000, 1_800_000).differencePaise).toBe(-42_000);
    expect(reconcileCardBill(null, 1_842_000)).toEqual({
      statementDuePaise: null,
      linkedPaymentPaise: 1_842_000,
      differencePaise: null,
      matched: false,
    });
  });

  it('keeps purchases and refunds while excluding both bill-payment legs', () => {
    const result = summarizeCardStatementActivity([
      transaction(1, 'out', 459_900),
      transaction(2, 'out', 92_000),
      transaction(3, 'in', 123_000),
      transaction(4, 'in', 1_842_000, 'cc_payment_received'),
      transaction(5, 'out', 1_842_000, 'cc_payment'),
    ]);

    expect(result.items.map((item) => item.id)).toEqual([1, 2, 3]);
    expect(result.purchaseCount).toBe(2);
    expect(result.refundCount).toBe(1);
    expect(result.purchasePaise).toBe(551_900);
    expect(result.refundPaise).toBe(123_000);
    expect(result.netPaise).toBe(428_900);
  });

  it('promotes amount matches without dropping any other statement', () => {
    const statements = [statement(3), statement(2), statement(1)];
    const result = partitionCardStatements(statements, [2]);

    expect(result.suggested.map((item) => item.id)).toEqual([2]);
    expect(result.others.map((item) => item.id)).toEqual([3, 1]);
    expect([...result.suggested, ...result.others].map((item) => item.id).sort()).toEqual([1, 2, 3]);
  });
});
