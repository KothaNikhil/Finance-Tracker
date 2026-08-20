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

/** Which column of a bank ledger a row hit — used only for the import debit/credit tally. */
export type LedgerSide = 'debit' | 'credit' | null;

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
  sourceRef: string | null; // UPI Ref No. / bank UTR
  orderId: string | null; // Paytm Order ID
  source: TxnSource;
  /**
   * The statement's own debit/credit side for this row (banks: the DR/CR column; Paytm: derived
   * from direction, with unsigned self-transfers = null). Import-time only — NOT persisted; used
   * to tally total debit/credit against the statement. `undefined` on sources that don't track it.
   */
  ledgerSide?: LedgerSide;
  /** Stable key used to detect duplicates across imports. */
  dedupeKey: string;
}

/** Minimal shape of a parsed worksheet the adapter works with. */
export interface SheetLike {
  name: string;
  /** Header row values (row 1), in order. */
  headers: string[];
  /** Data rows keyed by the row-1 header (header excluded). */
  rows: RawRow[];
  /**
   * The full sheet as raw array-of-arrays, INCLUDING any preamble rows above the header. Bank
   * statements carry a metadata block before the real header, so those adapters find their own
   * header row in here rather than trusting row 1.
   */
  matrix: string[][];
}

/** One per money source. Adding a new source = adding one of these. */
export interface SourceAdapter {
  readonly source: TxnSource;
  /** True if this adapter recognizes the workbook (by sheet names and/or a header signature). */
  detect(sheets: SheetLike[]): boolean;
  /** Pick the sheet that holds the transactions. */
  selectSheet(sheets: SheetLike[]): SheetLike;
  /**
   * Optional: produce the data rows to normalize. Defaults to the sheet's row-1-keyed `rows`.
   * Adapters whose header isn't row 1 (a preamble above it) override this to locate the header
   * in `sheet.matrix` and build header-keyed rows from there.
   */
  rows?(sheet: SheetLike): RawRow[];
  /** Turn one raw row into a normalized transaction. Throws on an unparseable row. */
  normalize(row: RawRow): NormalizedTxn;
  /**
   * Optional last-resort: when {@link normalize} throws, build a best-effort transaction so the
   * row is NEVER silently dropped (it lands as uncategorized / needs-review). Return `null` if the
   * row clearly isn't a transaction (a legend/footer line), so the pipeline records a real error.
   */
  salvage?(row: RawRow): NormalizedTxn | null;
}
