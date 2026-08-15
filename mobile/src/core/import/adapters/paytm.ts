/**
 * Paytm UPI statement adapter.
 *
 * Turns one raw row from the "Passbook Payment History" sheet into a NormalizedTxn.
 * Header matching is tolerant (substring, case-insensitive) so tiny header wording changes
 * across Paytm exports don't break the import.
 */

import { parsePaytmAmount } from '../../domain/money';
import { parsePaytmDate } from '../../domain/date';
import { buildDedupeKey } from '../dedupe';
import type { NormalizedTxn, RawRow, SheetLike, SourceAdapter, TxnKind } from '../types';

const TXN_SHEET = 'Passbook Payment History';

/** App names Paytm appends to a counterparty VPA, e.g. "name@bank on PhonePe". */
const APP_SUFFIX = /\s+on\s+(Paytm|PhonePe|Google Pay)\s*$/i;

/** Read a cell by the first header that contains any of the given substrings. */
function field(cells: Record<string, string>, ...substrings: string[]): string {
  const keys = Object.keys(cells);
  for (const sub of substrings) {
    const lower = sub.toLowerCase();
    const key = keys.find((k) => k.toLowerCase().includes(lower));
    if (key) return (cells[key] ?? '').trim();
  }
  return '';
}

function orNull(value: string): string | null {
  const v = value.trim();
  return v === '' ? null : v;
}

/** Detect the transaction "kind" and pull out the counterparty from the details wording. */
function parseDetails(details: string): { kind: TxnKind; counterpartyName: string | null } {
  const d = details.trim();
  const rules: { re: RegExp; kind: TxnKind }[] = [
    { re: /^Paid to\s+/i, kind: 'paid' },
    { re: /^Money sent to\s+/i, kind: 'sent' },
    { re: /^Received from\s+/i, kind: 'received' },
    { re: /^Transferred to Self,?\s*/i, kind: 'self' },
    { re: /^Bill Payment of\s+/i, kind: 'billpay' },
    { re: /^Recharge of\s+/i, kind: 'recharge' },
    { re: /^Refund from\s+/i, kind: 'refund' },
  ];
  for (const { re, kind } of rules) {
    if (re.test(d)) {
      const rest = d.replace(re, '').trim();
      return { kind, counterpartyName: rest === '' ? null : rest };
    }
  }
  if (/gold coin/i.test(d)) return { kind: 'gold', counterpartyName: null };
  return { kind: 'other', counterpartyName: d === '' ? null : d };
}

/** Strip the trailing " on <App>" from a counterparty VPA. */
function cleanVpa(raw: string): string | null {
  const v = raw.replace(APP_SUFFIX, '').trim();
  return v === '' ? null : v;
}

export const paytmAdapter: SourceAdapter = {
  source: 'paytm',

  detect(sheetNames: string[]): boolean {
    return sheetNames.some((n) => n.trim().toLowerCase() === TXN_SHEET.toLowerCase());
  },

  selectSheet(sheets: SheetLike[]): SheetLike {
    const sheet = sheets.find((s) => s.name.trim().toLowerCase() === TXN_SHEET.toLowerCase());
    if (!sheet) {
      throw new Error(`Paytm import: could not find the "${TXN_SHEET}" sheet`);
    }
    return sheet;
  },

  normalize(row: RawRow): NormalizedTxn {
    const cells = row.cells;

    const dateText = field(cells, 'date');
    const timeText = field(cells, 'time');
    const amountText = field(cells, 'amount');
    const details = field(cells, 'transaction details');
    const vpaText = field(cells, 'upi id', 'a/c no', 'other transaction');
    const accountText = field(cells, 'your account', 'account');
    const refText = field(cells, 'upi ref', 'ref no');
    const orderText = field(cells, 'order id', 'order');
    const remarksText = field(cells, 'remark');
    const tagText = field(cells, 'tag');

    if (amountText === '') {
      throw new Error(`Row ${row.rowNumber}: missing amount`);
    }

    const { isoDate, time } = parsePaytmDate(dateText, timeText);
    const { paise, direction } = parsePaytmAmount(amountText);
    const { kind, counterpartyName } = parseDetails(details);

    const base = {
      isoDate,
      time,
      paise,
      direction,
      kind,
      counterpartyName,
      counterpartyVpa: cleanVpa(vpaText),
      accountName: orNull(accountText),
      rawDetails: details,
      rawTag: orNull(tagText),
      remarks: orNull(remarksText),
      sourceRef: orNull(refText),
      orderId: orNull(orderText),
      source: 'paytm' as const,
    };

    return { ...base, dedupeKey: buildDedupeKey(base) };
  },
};
