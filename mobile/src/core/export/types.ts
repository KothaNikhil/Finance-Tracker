/**
 * Contracts for the Excel export (Step 7).
 *
 * The export is split so the interesting part stays pure and testable: `build-workbook` turns
 * transactions into a **library-agnostic** `WorkbookModel` (sheets → columns → typed cells) with
 * no Excel library and no React Native imports. A thin writer in `services/` turns that model
 * into an `.xlsx` file. This mirrors the app's core/services split and lets us unit-test the
 * sheet structure and totals without touching SheetJS or the filesystem.
 */

import type { Direction } from '../domain/money';

/** A cell is either plain text/number or a money amount (which the writer formats as ₹). */
export type CellKind = 'text' | 'money';

export interface CellModel {
  /** For `money` cells this is a **rupee** number (paise ÷ 100); the writer applies the ₹ format. */
  value: string | number;
  kind: CellKind;
}

export interface ColumnModel {
  header: string;
  /** Column width in characters (SheetJS `wch`). */
  width: number;
}

export interface SheetModel {
  /** Worksheet tab name (Excel caps this at 31 chars). */
  name: string;
  columns: ColumnModel[];
  /** Data rows (header excluded); rows may be shorter than `columns` (e.g. total rows). */
  rows: CellModel[][];
}

export interface WorkbookModel {
  fileName: string;
  sheets: SheetModel[];
}

/**
 * One transaction with all display fields already resolved to strings (category/sub-category/
 * payment-mode/person names looked up by the caller). Keeps `build-workbook` free of the
 * reference-data lookups.
 */
export interface ExportTxn {
  isoDate: string; // YYYY-MM-DD
  time: string; // '' when unknown
  paise: number; // positive magnitude
  direction: Direction; // in | out | self
  isRefund: boolean;
  counterparty: string;
  categoryName: string;
  subcategoryName: string;
  paymentMode: string;
  person: string;
  account: string;
  remarks: string;
  ref: string;
}
