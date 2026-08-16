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

/**
 * Build the workbook for one calendar year. Months with no transactions are omitted (no empty
 * sheets); if the whole year is empty the workbook still has a Summary sheet with just totals.
 */
export function buildYearlyWorkbook(txns: ExportTxn[], year: number): WorkbookModel {
  const yearStr = String(year).padStart(4, '0');
  const inYear = txns.filter((t) => t.isoDate.slice(0, 4) === yearStr);

  const byMonth = new Map<number, ExportTxn[]>();
  for (const t of inYear) {
    const m = parseInt(t.isoDate.slice(5, 7), 10);
    if (m < 1 || m > 12) continue;
    const list = byMonth.get(m);
    if (list) list.push(t);
    else byMonth.set(m, [t]);
  }

  const summaryRows: CellModel[][] = [];
  const grand = emptyTotals();
  const monthSheets: SheetModel[] = [];

  for (let m = 1; m <= 12; m++) {
    const list = byMonth.get(m);
    if (!list) continue;
    list.sort(byDateTime);

    const totals = emptyTotals();
    for (const t of list) addTotals(totals, t);
    const net = totals.spent - totals.refunds;

    // Summary row for this month.
    summaryRows.push([
      text(MONTH_NAMES[m - 1]),
      money(totals.spent),
      money(totals.received),
      money(totals.refunds),
      money(net),
      text(totals.count),
    ]);

    // Accumulate into the grand total.
    grand.spent += totals.spent;
    grand.received += totals.received;
    grand.refunds += totals.refunds;
    grand.count += totals.count;

    // The month log sheet: transactions + a spacer + total rows.
    const rows: CellModel[][] = list.map(logRow);
    rows.push([text('')]);
    rows.push(totalRow('Spent (₹)', totals.spent));
    rows.push(totalRow('Received (₹)', totals.received));
    rows.push(totalRow('Refunds (₹)', totals.refunds));
    rows.push(totalRow('Net spent (₹)', net));

    monthSheets.push({ name: MONTH_NAMES[m - 1], columns: LOG_COLUMNS, rows });
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

  return { fileName: `Finance-Tracker-${yearStr}.xlsx`, sheets: [summarySheet, ...monthSheets] };
}
