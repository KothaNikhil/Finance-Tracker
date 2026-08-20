/**
 * Duplicate detection. Statements overlap all the time (e.g. a "May" export and an
 * "Apr–Jul" export both contain May), so every import must skip transactions we already have.
 *
 * The strongest id wins: the UPI reference number, then the Order ID, then a composite of
 * date + time + amount + counterparty. This mirrors what a human would eyeball as "the same".
 */

import type { NormalizedTxn } from './types';

/** Fields needed to compute a dedupe key (a subset of NormalizedTxn). */
export type DedupeInput = Pick<
  NormalizedTxn,
  | 'sourceRef'
  | 'orderId'
  | 'isoDate'
  | 'time'
  | 'paise'
  | 'direction'
  | 'counterpartyVpa'
  | 'counterpartyName'
  | 'rawDetails'
>;

/** Build the stable key used to tell whether two rows are the same transaction. */
export function buildDedupeKey(txn: DedupeInput): string {
  if (txn.sourceRef && txn.sourceRef.trim() !== '') {
    return `ref:${txn.sourceRef.trim()}`;
  }
  if (txn.orderId && txn.orderId.trim() !== '') {
    return `order:${txn.orderId.trim()}`;
  }
  // No reference number (bank charges/interest/ACH, or a Paytm row without a ref). Fall back to a
  // composite. The full narration is included so two same-day, same-amount rows to the same payee
  // (which banks CAN have, with no time to separate them) aren't wrongly merged into one. Within a
  // single source the narration is byte-identical across re-exports, so this never blocks dedupe.
  const who = (txn.counterpartyVpa || txn.counterpartyName || '').trim().toLowerCase();
  const details = (txn.rawDetails ?? '').trim().toLowerCase();
  return `c:${txn.isoDate}|${txn.time ?? ''}|${txn.paise}|${txn.direction}|${who}|${details}`;
}

export interface PartitionResult {
  /** Transactions not seen before (and not repeated within this batch). */
  unique: NormalizedTxn[];
  /** Transactions skipped because they already exist or repeat within this batch. */
  duplicates: NormalizedTxn[];
}

/**
 * Split an incoming batch into brand-new transactions vs duplicates.
 * `existingKeys` are dedupe keys already stored in the database.
 */
export function partitionDuplicates(
  incoming: NormalizedTxn[],
  existingKeys: ReadonlySet<string> = new Set(),
): PartitionResult {
  const seen = new Set<string>(existingKeys);
  const unique: NormalizedTxn[] = [];
  const duplicates: NormalizedTxn[] = [];

  for (const txn of incoming) {
    if (seen.has(txn.dedupeKey)) {
      duplicates.push(txn);
    } else {
      seen.add(txn.dedupeKey);
      unique.push(txn);
    }
  }

  return { unique, duplicates };
}
