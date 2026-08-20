/**
 * Axis Bank account-statement adapter (`.xls`/`.xlsx` export).
 *
 * Layout: a ~15-row metadata preamble, then a table:
 *   SRL NO | Tran Date (DD-MM-YYYY) | CHQNO | PARTICULARS | DR | CR | BAL | SOL
 * One of DR / CR carries the amount; PARTICULARS is a slash-delimited narration such as
 *   UPI/P2M/<rrn>/<merchant>/<note>/<bank>      UPI/P2A/<rrn>/<person>/<note>/<bank>
 *   IMPS/P2A/<rrn>/<name>/<acct>/<bank>          NEFT/<utr>/<name>/<bank>
 *   ACH-DR-… / ACH-CR-… / ECOM PUR/… / CreditCard Payment … / interest & charges
 */

import { parseDashDate } from '../../domain/date';
import { parseBankAmount } from '../../domain/money';
import { buildDedupeKey } from '../dedupe';
import type { LedgerSide, NormalizedTxn, RawRow, SheetLike, SourceAdapter, TxnKind } from '../types';
import { field, findHeaderIndex, HOLDER_CELL, isRefNumber, keyedRowsBelow, looksLikeSelf } from './bank-common';

const HEADER_TOKENS = ['srl no', 'tran date', 'particulars'];
const ACCOUNT_NAME = 'Axis Bank';
const DATE_RE = /^\d{1,2}-\d{1,2}-\d{4}$/;

/** Pull the account-holder name from the "Name :- …" preamble line, for self-transfer detection. */
function holderName(matrix: string[][], headerIdx: number): string {
  for (let i = 0; i < headerIdx; i++) {
    for (const cell of matrix[i]) {
      const m = /^\s*name\s*:-?\s*(.+)$/i.exec(cell.trim());
      if (m) return m[1].trim();
    }
  }
  return '';
}

interface ParsedNarration {
  name: string | null;
  note: string | null;
  ref: string | null;
  mode: string | null; // P2M / P2A when present
}

function parseNarration(particulars: string): ParsedNarration {
  const parts = particulars.split('/').map((s) => s.trim());
  const head = (parts[0] ?? '').toUpperCase();
  if (head === 'UPI' || head === 'IMPS') {
    return {
      mode: (parts[1] ?? '').toUpperCase() || null,
      ref: isRefNumber(parts[2]) ? parts[2] : null,
      name: parts[3] || null,
      note: parts[4] || null,
    };
  }
  if (head === 'NEFT' || head === 'RTGS') {
    return { mode: null, ref: parts[1] || null, name: parts[2] || null, note: null };
  }
  return { mode: null, ref: null, name: particulars.trim() || null, note: null };
}

function build(row: RawRow, opts: { salvage: boolean }): NormalizedTxn {
  const cells = row.cells;
  const isoDate = parseDashDate(field(cells, 'tran date'));

  const amount = (text: string): number => {
    if (!/\d/.test(text)) return 0;
    try {
      return parseBankAmount(text);
    } catch (e) {
      if (opts.salvage) return 0; // salvaged rows keep going with a 0 amount rather than being dropped
      throw e;
    }
  };
  const drText = field(cells, 'dr');
  const crText = field(cells, 'cr');
  const drPaise = amount(drText);
  const crPaise = amount(crText);

  const isDebit = drPaise > 0 || (drPaise === 0 && crPaise === 0); // default a zero row to debit side
  const paise = isDebit ? drPaise : crPaise;
  const ledgerSide: LedgerSide = isDebit ? 'debit' : 'credit';

  const particulars = field(cells, 'particulars');
  const { name, note, ref, mode } = opts.salvage
    ? { name: particulars || null, note: null, ref: null, mode: null }
    : parseNarration(particulars);

  const isSelf = looksLikeSelf(name, cells[HOLDER_CELL]);
  const direction = isSelf ? 'self' : isDebit ? 'out' : 'in';
  const kind: TxnKind = isSelf
    ? 'self'
    : direction === 'in'
      ? 'received'
      : mode === 'P2A'
        ? 'sent'
        : mode === 'P2M'
          ? 'paid'
          : 'other';

  const base = {
    isoDate,
    time: null,
    paise,
    direction: direction as NormalizedTxn['direction'],
    kind,
    counterpartyName: name,
    counterpartyVpa: null,
    accountName: ACCOUNT_NAME,
    rawDetails: particulars,
    rawTag: null,
    remarks: note,
    sourceRef: ref,
    orderId: null,
    source: 'bank' as const,
    ledgerSide,
  };
  return { ...base, dedupeKey: buildDedupeKey(base) };
}

export const axisAdapter: SourceAdapter = {
  source: 'bank',

  detect(sheets: SheetLike[]): boolean {
    return sheets.some((s) => findHeaderIndex(s.matrix, HEADER_TOKENS) !== -1);
  },

  selectSheet(sheets: SheetLike[]): SheetLike {
    const sheet = sheets.find((s) => findHeaderIndex(s.matrix, HEADER_TOKENS) !== -1);
    if (!sheet) throw new Error('Axis import: could not find the statement header row');
    return sheet;
  },

  rows(sheet: SheetLike): RawRow[] {
    const headerIdx = findHeaderIndex(sheet.matrix, HEADER_TOKENS);
    const holder = holderName(sheet.matrix, headerIdx);
    // A real data row has a DD-MM-YYYY transaction date; that filters out the trailing legend.
    return keyedRowsBelow(sheet.matrix, headerIdx, (cells) => DATE_RE.test(field(cells, 'tran date')), {
      [HOLDER_CELL]: holder,
    });
  },

  normalize(row: RawRow): NormalizedTxn {
    return build(row, { salvage: false });
  },

  // Amount/narration quirks shouldn't drop a dated row: keep it as an uncategorized needs-review txn.
  salvage(row: RawRow): NormalizedTxn | null {
    if (!DATE_RE.test(field(row.cells, 'tran date'))) return null; // not a transaction line
    try {
      return build(row, { salvage: true });
    } catch {
      return null;
    }
  },
};
