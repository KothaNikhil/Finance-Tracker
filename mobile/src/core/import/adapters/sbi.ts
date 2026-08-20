/**
 * State Bank of India (SBI) account-statement adapter (`.xlsx` export).
 *
 * Layout: a ~16-row metadata preamble (holder name + email in cell A1, branch/account details in
 * column B), then a table:
 *   Date (DD/MM/YYYY) | Details | Ref No/Cheque No | Debit | Credit | Balance
 * The `Details` narration is free text with embedded newlines and a trailing branch tag, e.g.
 *   DEP TFR   UPI/CR/<rrn>/<name>/<bank>/<seq>/<note>  <acct> AT <branch> <place>   (an incoming UPI)
 *   TO TRANSFER-UPI/DR/<rrn>/<name>/...                                              (an outgoing UPI)
 *   DIRECT DR   <mandate> OF Mr. <holder> AT <branch> <place>                        (a mandate debit)
 *   ATM WDL / CHARGES / INT PD / …                                                   (non-transfers)
 * The `Ref No/Cheque No` column is blank for UPI rows — the RRN lives inside the narration.
 *
 * SELF-TRANSFER GUARD: SBI embeds the account holder's own name in NON-transfer lines
 * (`DIRECT DR … OF Mr. <holder>`). Self-detection must therefore run ONLY on genuine transfer
 * narrations (UPI/IMPS/NEFT/RTGS), never on an incidental holder-name mention — otherwise a real
 * debit (e.g. a ₹26,624 mandate) would be wrongly marked self and dropped out of "Spent".
 */

import { parseSlashDate } from '../../domain/date';
import { parseBankAmount } from '../../domain/money';
import { buildDedupeKey } from '../dedupe';
import type { LedgerSide, NormalizedTxn, RawRow, SheetLike, SourceAdapter, TxnKind } from '../types';
import { field, findHeaderIndex, HOLDER_CELL, isRefNumber, keyedRowsBelow, looksLikeSelf } from './bank-common';

const HEADER_TOKENS = ['date', 'details', 'ref no'];
const ACCOUNT_NAME = 'State Bank of India';
const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

/** Collapse the embedded newlines/tabs/runs-of-spaces SBI puts inside a narration cell. */
function cleanNarration(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Holder name for self-transfer detection. SBI writes "Mr. KOTHA NIKHIL\nemail@…" in cell A1;
 * take the first line and drop the salutation so "Mr. KOTHA NIKHIL" → "KOTHA NIKHIL".
 */
function holderName(matrix: string[][]): string {
  const first = matrix[0]?.[0] ?? '';
  const line = first.split(/[\r\n]/)[0] ?? '';
  return line.replace(/^\s*(mr|mrs|ms|dr|m\/s)\.?\s+/i, '').trim();
}

interface ParsedNarration {
  name: string | null;
  note: string | null;
  ref: string | null;
  /** True only for genuine transfer narrations (UPI/IMPS/NEFT/RTGS) — gates self-detection. */
  isTransfer: boolean;
}

const NON_TRANSFER: ParsedNarration = { name: null, note: null, ref: null, isTransfer: false };

/** Trim the trailing "AT <branch> <place>" tag and any long account/sequence digit runs off a note. */
function cleanNote(seg: string | undefined): string | null {
  if (!seg) return null;
  const withoutBranch = seg.replace(/\bAT\s+\d{3,}.*$/i, '').trim();
  const words = withoutBranch.split(' ').filter((w) => !/^\d{5,}$/.test(w));
  const note = words.join(' ').trim();
  return note || null;
}

/** First run of 6–20 digits anywhere in the text — the RRN/UTR when there's no delimited layout. */
function firstRef(text: string): string | null {
  const m = /\b(\d{6,20})\b/.exec(text);
  return m ? m[1] : null;
}

function parseNarration(details: string): ParsedNarration {
  const upper = details.toUpperCase();
  const upiAt = upper.indexOf('UPI/');
  if (upiAt !== -1) {
    // …UPI/<CR|DR>/<rrn>/<name>/<bank>/<ref>/<note>… — side comes from the Debit/Credit column.
    const segs = details.slice(upiAt + 'UPI/'.length).split('/').map((s) => s.trim());
    return {
      ref: isRefNumber(segs[1]) ? segs[1] : null,
      name: segs[2] || null,
      note: cleanNote(segs[5]),
      isTransfer: true,
    };
  }
  // IMPS/NEFT/RTGS: layouts vary and we have no delimited samples yet, so pull only a reference
  // (never a guessed name — a wrong name could trip the self-transfer guard). Name stays null.
  if (/\b(IMPS|NEFT|RTGS)\b/.test(upper)) {
    return { ref: firstRef(details), name: null, note: null, isTransfer: true };
  }
  // DIRECT DR / ATM / CHARGES / INT PD / … — not a transfer. No ref, no name, no self-detection.
  return NON_TRANSFER;
}

function build(row: RawRow, opts: { salvage: boolean }): NormalizedTxn {
  const cells = row.cells;
  const isoDate = parseSlashDate(field(cells, 'date'));

  const amount = (text: string): number => {
    if (!/\d/.test(text)) return 0;
    try {
      return parseBankAmount(text);
    } catch (e) {
      if (opts.salvage) return 0; // salvaged rows keep going with a 0 amount rather than being dropped
      throw e;
    }
  };
  const drPaise = amount(field(cells, 'debit'));
  const crPaise = amount(field(cells, 'credit'));

  const isDebit = drPaise > 0 || (drPaise === 0 && crPaise === 0); // default a zero row to debit side
  const paise = isDebit ? drPaise : crPaise;
  const ledgerSide: LedgerSide = isDebit ? 'debit' : 'credit';

  const details = cleanNarration(field(cells, 'details'));
  const parsed = opts.salvage ? NON_TRANSFER : parseNarration(details);

  // GUARD: self-detection only on genuine transfer lines — never on an incidental "OF Mr. <holder>".
  const isSelf = parsed.isTransfer && looksLikeSelf(parsed.name, cells[HOLDER_CELL]);
  const direction = isSelf ? 'self' : isDebit ? 'out' : 'in';
  // SBI UPI narration doesn't distinguish merchant (P2M) from person (P2A), so out-rows fall to
  // 'other' (which flags for review) rather than claiming a false "paid" confidence — as KVB does.
  const kind: TxnKind = isSelf ? 'self' : direction === 'in' ? 'received' : 'other';

  const base = {
    isoDate,
    time: null,
    paise,
    direction: direction as NormalizedTxn['direction'],
    kind,
    counterpartyName: parsed.name,
    counterpartyVpa: null,
    accountName: ACCOUNT_NAME,
    rawDetails: details,
    rawTag: null,
    remarks: parsed.note,
    sourceRef: parsed.ref,
    orderId: null,
    source: 'bank' as const,
    ledgerSide,
  };
  return { ...base, dedupeKey: buildDedupeKey(base) };
}

export const sbiAdapter: SourceAdapter = {
  source: 'bank',

  detect(sheets: SheetLike[]): boolean {
    return sheets.some((s) => findHeaderIndex(s.matrix, HEADER_TOKENS) !== -1);
  },

  selectSheet(sheets: SheetLike[]): SheetLike {
    const sheet = sheets.find((s) => findHeaderIndex(s.matrix, HEADER_TOKENS) !== -1);
    if (!sheet) throw new Error('SBI import: could not find the statement header row');
    return sheet;
  },

  rows(sheet: SheetLike): RawRow[] {
    const headerIdx = findHeaderIndex(sheet.matrix, HEADER_TOKENS);
    const holder = holderName(sheet.matrix);
    // A real data row has a DD/MM/YYYY date; that stops at the blank line before the summary/footer.
    return keyedRowsBelow(sheet.matrix, headerIdx, (cells) => DATE_RE.test(field(cells, 'date')), {
      [HOLDER_CELL]: holder,
    });
  },

  normalize(row: RawRow): NormalizedTxn {
    return build(row, { salvage: false });
  },

  salvage(row: RawRow): NormalizedTxn | null {
    if (!DATE_RE.test(field(row.cells, 'date'))) return null; // not a transaction line
    try {
      return build(row, { salvage: true });
    } catch {
      return null;
    }
  },
};
