/**
 * Builds the yearly-workbook model: one sheet per month that has transactions (a chronological
 * log with per-month totals), preceded by a Summary sheet of monthly totals. Pure — no Excel
 * library, no React Native — so the structure and the money maths are unit-tested directly.
 *
 * Money rules match the rest of the app: self-transfers are shown in the log as "Transfer" but
 * excluded from the spent/received/net totals; refunds are money-in that reduces net spend.
 */

import type { CellModel, ColumnModel, ExportTxn, SheetModel, WorkbookModel } from './types';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const text = (value: string | number): CellModel => ({ value, kind: 'text' });
const money = (paise: number): CellModel => ({ value: paise / 100, kind: 'money' });

/** Columns of a monthly transaction-log sheet. */
const LOG_COLUMNS: ColumnModel[] = [
  { header: 'Date', width: 12 },
  { header: 'Time', width: 10 },
  { header: 'Details', width: 30 },
  { header: 'Category', width: 18 },
  { header: 'Sub-category', width: 16 },
  { header: 'Payment mode', width: 14 },
  { header: 'For', width: 12 },
  { header: 'Type', width: 12 },
  { header: 'Amount (₹)', width: 14 },
  { header: 'Refund', width: 8 },
  { header: 'Account', width: 18 },
  { header: 'Remarks', width: 26 },
  { header: 'Ref', width: 18 },
];
// Column indices used when placing the per-month total rows.
const TYPE_COL = 7;
const AMOUNT_COL = 8;

const SUMMARY_COLUMNS: ColumnModel[] = [
  { header: 'Month', width: 12 },
  { header: 'Spent (₹)', width: 14 },
  { header: 'Received (₹)', width: 14 },
  { header: 'Refunds (₹)', width: 14 },
  { header: 'Net spent (₹)', width: 14 },
  { header: 'Transactions', width: 13 },
];

interface Totals {
  spent: number;
  received: number;
  refunds: number;
  count: number;
}

function emptyTotals(): Totals {
  return { spent: 0, received: 0, refunds: 0, count: 0 };
}

/** Fold a transaction into a totals accumulator (self-transfers contribute nothing). */
function addTotals(t: Totals, txn: ExportTxn): void {
  if (txn.direction === 'out') {
    t.spent += txn.paise;
    t.count += 1;
  } else if (txn.direction === 'in') {
    if (txn.isRefund) t.refunds += txn.paise;
    else t.received += txn.paise;
    t.count += 1;
  }
}

/** Human label for a transaction's direction/kind, shown in the "Type" column. */
function typeLabel(txn: ExportTxn): string {
  if (txn.direction === 'self') return 'Transfer';
  if (txn.direction === 'in') return txn.isRefund ? 'Refund' : 'Received';
  return 'Spent';
}

function logRow(txn: ExportTxn): CellModel[] {
  return [
    text(txn.isoDate),
    text(txn.time),
    text(txn.counterparty),
    text(txn.categoryName),
    text(txn.subcategoryName),
    text(txn.paymentMode),
    text(txn.person),
    text(typeLabel(txn)),
    money(txn.paise),
    text(txn.isRefund ? 'Yes' : ''),
    text(txn.account),
    text(txn.remarks),
    text(txn.ref),
  ];
}

/** A full-width total row with the label under "Type" and the amount under "Amount (₹)". */
function totalRow(label: string, paise: number): CellModel[] {
  const cells = LOG_COLUMNS.map(() => text(''));
  cells[TYPE_COL] = text(label);
  cells[AMOUNT_COL] = money(paise);
  return cells;
}

/** Chronological sort (by date, then time) for a month's transactions. */
function byDateTime(a: ExportTxn, b: ExportTxn): number {
  if (a.isoDate !== b.isoDate) return a.isoDate < b.isoDate ? -1 : 1;
  return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
}

/** A (year, month) bucket of transactions. `ord` = year*12 + monthIndex, for chronological sorting. */
interface MonthBucket {
  year: number;
  month: number; // 1-based
  ord: number;
  txns: ExportTxn[];
}

/** Group the (already-filtered) transactions into chronological (year, month) buckets. */
function bucketByMonth(txns: ExportTxn[]): MonthBucket[] {
  const byKey = new Map<number, MonthBucket>();
  for (const t of txns) {
    const year = parseInt(t.isoDate.slice(0, 4), 10);
    const month = parseInt(t.isoDate.slice(5, 7), 10);
    if (!(month >= 1 && month <= 12)) continue;
    const ord = year * 12 + (month - 1);
    let b = byKey.get(ord);
    if (!b) byKey.set(ord, (b = { year, month, ord, txns: [] }));
    b.txns.push(t);
  }
  return [...byKey.values()].sort((a, b) => a.ord - b.ord);
}

/**
 * Build a workbook from an already-filtered set of transactions: a Summary sheet of per-month
 * totals followed by one log sheet per month that has data (chronological). Months that span more
 * than one calendar year get the year appended to their sheet/summary label so names stay unique;
 * a single-year set keeps the plain month names. An empty set still yields a Summary sheet.
 */
export function buildFilteredWorkbook(txns: ExportTxn[], fileName: string): WorkbookModel {
  const buckets = bucketByMonth(txns);
  const multiYear = new Set(buckets.map((b) => b.year)).size > 1;
  const label = (b: MonthBucket): string =>
    multiYear ? `${MONTH_NAMES[b.month - 1]} ${b.year}` : MONTH_NAMES[b.month - 1];

  const summaryRows: CellModel[][] = [];
  const grand = emptyTotals();
  const monthSheets: SheetModel[] = [];

  for (const b of buckets) {
    b.txns.sort(byDateTime);

    const totals = emptyTotals();
    for (const t of b.txns) addTotals(totals, t);
    const net = totals.spent - totals.refunds;

    summaryRows.push([
      text(label(b)),
      money(totals.spent),
      money(totals.received),
      money(totals.refunds),
      money(net),
      text(totals.count),
    ]);

    grand.spent += totals.spent;
    grand.received += totals.received;
    grand.refunds += totals.refunds;
    grand.count += totals.count;

    // The month log sheet: transactions + a spacer + total rows.
    const rows: CellModel[][] = b.txns.map(logRow);
    rows.push([text('')]);
    rows.push(totalRow('Spent (₹)', totals.spent));
    rows.push(totalRow('Received (₹)', totals.received));
    rows.push(totalRow('Refunds (₹)', totals.refunds));
    rows.push(totalRow('Net spent (₹)', net));

    monthSheets.push({ name: label(b), columns: LOG_COLUMNS, rows });
  }

  // Grand-total row closes the Summary sheet.
  summaryRows.push([
    text('Total'),
    money(grand.spent),
    money(grand.received),
    money(grand.refunds),
    money(grand.spent - grand.refunds),
    text(grand.count),
  ]);

  const summarySheet: SheetModel = { name: 'Summary', columns: SUMMARY_COLUMNS, rows: summaryRows };
  return { fileName, sheets: [summarySheet, ...monthSheets] };
}

/**
 * Build the workbook for one calendar year (kept for the year-scoped path/tests). Filters to the
 * year, then delegates to {@link buildFilteredWorkbook} — a single year keeps plain month names.
 */
export function buildYearlyWorkbook(txns: ExportTxn[], year: number): WorkbookModel {
  const yearStr = String(year).padStart(4, '0');
  const inYear = txns.filter((t) => t.isoDate.slice(0, 4) === yearStr);
  return buildFilteredWorkbook(inYear, `Finance-Tracker-${yearStr}.xlsx`);
}
