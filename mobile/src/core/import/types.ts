/**
 * Contracts for the import pipeline. The pipeline is built to be **pluggable**: each money
 * source (Paytm now; PhonePe, GPay, bank, credit-card later) provides one `SourceAdapter`,
 * and the rest of the pipeline (dedupe, categorize, preview, commit) stays the same.
 *
 * Only types live here — the Paytm adapter and pipeline logic arrive in Step 3.
 */

import type { Direction } from '../domain/money';

/** Where a transaction came from. */
export type TxnSource = 'paytm' | 'manual' | 'phonepe' | 'gpay' | 'bank' | 'cc';

/**
 * A coarse hint about what the transaction is, read from the statement wording
 * (e.g. Paytm's "Paid to…", "Transferred to Self…", "Gold Coin Redemption").
 * Step 4 (auto-categorization) uses this together with tags and merchant names.
 */
export type TxnKind =
  | 'paid' // Paid to a merchant/person
  | 'sent' // Money sent to a person
  | 'received' // Received from a person
  | 'self' // Transferred between the user's own accounts
  | 'billpay' // Credit-card bill payment
  | 'recharge' // FASTag / mobile / utility recharge
  | 'gold' // Paytm gold buy/redeem
  | 'refund' // Refund/cashback in
  | 'other';

/** A raw row straight out of a statement sheet — everything is still text. */
export interface RawRow {
  /** Column header → cell text, exactly as read from the file. */
  cells: Record<string, string>;
  /** 1-based row number in the sheet, for error messages. */
  rowNumber: number;
}

/** A cleaned-up, typed transaction, before dedupe/categorize/save. */
export interface NormalizedTxn {
  isoDate: string; // YYYY-MM-DD
  time: string | null; // HH:MM:SS
  paise: number; // positive magnitude
  direction: Direction; // in | out | self
  kind: TxnKind; // hint read from the statement wording
  counterpartyName: string | null; // shop/person
  counterpartyVpa: string | null; // UPI id, " on <App>" suffix stripped
  accountName: string | null; // funding source, e.g. "Axis Bank - 15"
  rawDetails: string; // original "Transaction Details" text, kept for categorization
  rawTag: string | null; // e.g. "#🥘 Food" (kept as-is for categorization)
  remarks: string | null;
  sourceRef: string | null; // UPI Ref No.
  orderId: string | null; // Paytm Order ID
  source: TxnSource;
  /** Stable key used to detect duplicates across imports. */
  dedupeKey: string;
}

/** Minimal shape of a parsed worksheet the adapter works with. */
export interface SheetLike {
  name: string;
  /** Header row values, in order. */
  headers: string[];
  /** Data rows (header excluded). */
  rows: RawRow[];
}

/** One per money source. Adding a new source = adding one of these. */
export interface SourceAdapter {
  readonly source: TxnSource;
  /** True if this adapter recognizes the workbook (e.g. sees the expected sheet/headers). */
  detect(sheetNames: string[]): boolean;
  /** Pick the sheet that holds the transactions. */
  selectSheet(sheets: SheetLike[]): SheetLike;
  /** Turn one raw row into a normalized transaction. Throws on an unparseable row. */
  normalize(row: RawRow): NormalizedTxn;
}
