/**
 * Karur Vysya Bank (KVB) CASA statement adapter (`.xlsx` export).
 *
 * Layout: an ~11-row metadata preamble, then a table:
 *   Transaction Date (DD-MMM-YYYY HH:MM:SS) | Value Date | Particulars | Ref.No. | Debit | Credit | Running Balance
 * The RRN lives in its own `Ref.No.` column for UPI rows; the narration is dash-delimited, e.g.
 *   UPI-DR-<rrn>-<name>      UPI-CR-<rrn>-<name>      IMPS-<rrn>-<name>
 * The first data row is a `B/F` (brought-forward opening balance) line we skip.
 */

import { parseTextMonthDateTime } from '../../domain/date';
import { parseBankAmount } from '../../domain/money';
import { buildDedupeKey } from '../dedupe';
import type { LedgerSide, NormalizedTxn, RawRow, SheetLike, SourceAdapter, TxnKind } from '../types';
import { field, findHeaderIndex, HOLDER_CELL, isRefNumber, keyedRowsBelow, looksLikeSelf } from './bank-common';

const HEADER_TOKENS = ['transaction date', 'value date', 'particulars'];
const ACCOUNT_NAME = 'Karur Vysya Bank';
const DATE_RE = /^\d{1,2}-[a-z]{3}-\d{4}/i;

/** Holder name from the "Customer ID / Name" preamble line (value is "<id> / <name>"). */
function holderName(matrix: string[][], headerIdx: number): string {
  for (let i = 0; i < headerIdx; i++) {
    const row = matrix[i];
    if (!row.some((c) => c.toLowerCase().includes('name'))) continue;
    const value = row.slice(1).find((c) => c.trim() !== '') ?? '';
    const slash = value.lastIndexOf('/');
    return (slash >= 0 ? value.slice(slash + 1) : value).trim();
  }
  return '';
}

/** Extract RRN + name from a dash-delimited KVB narration (`UPI-DR-<rrn>-<name>`, `IMPS-<rrn>-<name>`). */
function parseNarration(particulars: string): { name: string | null; ref: string | null } {
  const parts = particulars.split('-').map((s) => s.trim());
  const head = (parts[0] ?? '').toUpperCase();
  if (head === 'UPI') {
    // parts[1] is the DR/CR indicator (we use the Debit/Credit columns instead), parts[2] the RRN.
    return { ref: isRefNumber(parts[2]) ? parts[2] : null, name: parts.slice(3).join('-').trim() || null };
  }
  if (head === 'IMPS' || head === 'NEFT' || head === 'RTGS') {
    return { ref: isRefNumber(parts[1]) ? parts[1] : null, name: parts.slice(2).join('-').trim() || null };
  }
  return { ref: null, name: particulars.trim() || null };
}

function build(row: RawRow, opts: { salvage: boolean }): NormalizedTxn {
  const cells = row.cells;
  const { isoDate, time } = parseTextMonthDateTime(field(cells, 'transaction date'));

  const amount = (text: string): number => {
    if (!/\d/.test(text)) return 0;
    try {
      return parseBankAmount(text);
    } catch (e) {
      if (opts.salvage) return 0; // salvaged rows keep going with a 0 amount rather than being dropped
      throw e;
    }
  };
  const debitText = field(cells, 'debit');
  const creditText = field(cells, 'credit');
  const drPaise = amount(debitText);
  const crPaise = amount(creditText);

  const isDebit = drPaise > 0 || (drPaise === 0 && crPaise === 0);
  const paise = isDebit ? drPaise : crPaise;
  const ledgerSide: LedgerSide = isDebit ? 'debit' : 'credit';

  const particulars = field(cells, 'particulars');
  const parsed = opts.salvage ? { name: particulars || null, ref: null } : parseNarration(particulars);
  const refCol = field(cells, 'ref');
  const ref = isRefNumber(refCol) ? refCol : parsed.ref;

  const isSelf = looksLikeSelf(parsed.name, cells[HOLDER_CELL]);
  const direction = isSelf ? 'self' : isDebit ? 'out' : 'in';
  // KVB narration doesn't distinguish merchant (P2M) from person (P2A), so out-rows that aren't a
  // known keyword fall to 'other' (which flags for review) — no false "paid" confidence.
  const kind: TxnKind = isSelf ? 'self' : direction === 'in' ? 'received' : 'other';

  const base = {
    isoDate,
    time,
    paise,
    direction: direction as NormalizedTxn['direction'],
    kind,
    counterpartyName: parsed.name,
    counterpartyVpa: null,
    accountName: ACCOUNT_NAME,
    rawDetails: particulars,
    rawTag: null,
    remarks: null,
    sourceRef: ref,
    orderId: null,
    source: 'bank' as const,
    ledgerSide,
  };
  return { ...base, dedupeKey: buildDedupeKey(base) };
}

export const kvbAdapter: SourceAdapter = {
  source: 'bank',

  detect(sheets: SheetLike[]): boolean {
    return sheets.some((s) => findHeaderIndex(s.matrix, HEADER_TOKENS) !== -1);
  },

  selectSheet(sheets: SheetLike[]): SheetLike {
    const sheet = sheets.find((s) => findHeaderIndex(s.matrix, HEADER_TOKENS) !== -1);
    if (!sheet) throw new Error('KVB import: could not find the statement header row');
    return sheet;
  },

  rows(sheet: SheetLike): RawRow[] {
    const headerIdx = findHeaderIndex(sheet.matrix, HEADER_TOKENS);
    const holder = holderName(sheet.matrix, headerIdx);
    // A data row has a DD-MMM-YYYY date AND a numeric amount — this skips the B/F opening row
    // (dated, but with "-" in both Debit and Credit) and any trailing notes.
    return keyedRowsBelow(
      sheet.matrix,
      headerIdx,
      (cells) =>
        DATE_RE.test(field(cells, 'transaction date')) &&
        (/\d/.test(field(cells, 'debit')) || /\d/.test(field(cells, 'credit'))),
      { [HOLDER_CELL]: holder },
    );
  },

  normalize(row: RawRow): NormalizedTxn {
    return build(row, { salvage: false });
  },

  salvage(row: RawRow): NormalizedTxn | null {
    if (!DATE_RE.test(field(row.cells, 'transaction date'))) return null;
    try {
      return build(row, { salvage: true });
    } catch {
      return null;
    }
  },
};
