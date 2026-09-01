import type { ImportRow, TransactionRow } from '@/core/db/schema';

export interface CardBillReconciliation {
  statementDuePaise: number | null;
  linkedPaymentPaise: number;
  differencePaise: number | null;
  matched: boolean;
}

export interface CardStatementActivity {
  items: TransactionRow[];
  purchaseCount: number;
  refundCount: number;
  purchasePaise: number;
  refundPaise: number;
  netPaise: number;
}

export function reconcileCardBill(
  statementDuePaise: number | null,
  linkedPaymentPaise: number,
): CardBillReconciliation {
  const differencePaise =
    statementDuePaise == null ? null : linkedPaymentPaise - statementDuePaise;
  return {
    statementDuePaise,
    linkedPaymentPaise,
    differencePaise,
    matched: differencePaise === 0,
  };
}

/**
 * Card purchases and merchant refunds are the statement activity users need to inspect. Either
 * bill-payment leg is a transfer and must not appear as a purchase/refund or enter this net.
 */
export function summarizeCardStatementActivity(items: TransactionRow[]): CardStatementActivity {
  const visibleItems = items.filter(
    (item) => item.transferRole !== 'cc_payment' && item.transferRole !== 'cc_payment_received',
  );
  let purchaseCount = 0;
  let refundCount = 0;
  let purchasePaise = 0;
  let refundPaise = 0;

  for (const item of visibleItems) {
    if (item.direction === 'out') {
      purchaseCount += 1;
      purchasePaise += item.paise;
    } else if (item.direction === 'in') {
      refundCount += 1;
      refundPaise += item.paise;
    }
  }

  return {
    items: visibleItems,
    purchaseCount,
    refundCount,
    purchasePaise,
    refundPaise,
    netPaise: purchasePaise - refundPaise,
  };
}

/** Amount-matched statements first; every remaining statement stays available in the full picker. */
export function partitionCardStatements(
  statements: ImportRow[],
  suggestedIds: number[],
): { suggested: ImportRow[]; others: ImportRow[] } {
  const suggestedSet = new Set(suggestedIds);
  return {
    suggested: statements.filter((statement) => suggestedSet.has(statement.id)),
    others: statements.filter((statement) => !suggestedSet.has(statement.id)),
  };
}
