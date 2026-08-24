/**
 * Axis Bank **credit-card** monthly-statement adapter (password-protected PDF, decrypted + text-
 * extracted upstream by {@link ../pdf/decrypt-pdf} + {@link ../pdf/pdf-text}). Covers every Axis card
 * product (Flipkart Visa, Rewards, …) — they share one template, so this keys off the title
 * "Axis … Credit Card Monthly Statement" and the `Transaction Summary` table, not the card.
 *
 * Unlike the bank adapters (which read an xlsx `matrix` via header-keyed cells), this reads the PDF's
 * positioned text lines (`sheet.pdfLines`) and bands them into the four table columns by x-position:
 *   Date (x≈52) · Transaction Details (x≈152) · Amount INR (x≈352) · Debit/Credit (x≈452).
 * A single logical transaction can span several lines — the "anchor" line carries the date + amount +
 * side; wrapped detail lines (no date) are attached to the nearest anchor.
 *
 * Money model (see the money-lent exclusion): a **Debit** is a real card spend (expense); a **Credit**
 * is either cashback (a refund) or the card's own bill **payment received** — the mirror of the bank's
 * bill-payment debit — which is tagged `cc_payment_received` so it's excluded from Spent/Received
 * totals (the bank leg is handled separately). Pure TS, unit-testable in Node.
 */

import type { TransferRole } from '../../lending/roles';
import type { LedgerSide, NormalizedTxn, PdfPositionedLine, RawRow, SheetLike, SourceAdapter, TxnKind } from '../types';
import { buildDedupeKey } from '../dedupe';

const TITLE_RE = /credit card monthly statement/i;
const DATE_RE = /^(\d{1,2})\s+([A-Za-z]{3})\s+'?(\d{2})$/;
const CARD_NUMBER_RE = /Credit Card Number:?\s*[\dXx*]*?(\d{4})\b/;

// Column x-bands (device space from pdf-text; see the layout note above).
const DETAILS_X_MIN = 120;
const AMOUNT_X_MIN = 340;
const DRCR_X_MIN = 445;

type Band = 'date' | 'details' | 'amount' | 'drcr';
function bandOf(x: number): Band {
  if (x < DETAILS_X_MIN) return 'date';
  if (x < AMOUNT_X_MIN) return 'details';
  if (x < DRCR_X_MIN) return 'amount';
  return 'drcr';
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Cells of a line collected per column band (joined when a band has several spans). */
function bandCells(line: PdfPositionedLine): Record<Band, string> {
  const out: Record<Band, string> = { date: '', details: '', amount: '', drcr: '' };
  for (const sp of line.spans) {
    const b = bandOf(sp.x);
    out[b] = out[b] ? `${out[b]} ${sp.text}` : sp.text;
  }
  return out;
}

/** `23 May '26` → `2026-05-23`, or '' when unparseable. */
function parseCardDate(text: string): string {
  const m = DATE_RE.exec(text.trim());
  if (!m) return '';
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return '';
  const day = m[1].padStart(2, '0');
  const year = 2000 + parseInt(m[3], 10);
  return `${year}-${mon}-${day}`;
}

/** `₹ 1,00,001.00` → 10000100 paise. Throws on a non-numeric amount. */
function parseAmountPaise(text: string): number {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (cleaned === '' || !/\d/.test(cleaned)) throw new Error(`Unparseable amount: "${text}"`);
  return Math.round(parseFloat(cleaned) * 100);
}

interface Meta {
  last4: string;
  product: string; // e.g. "Axis Bank Flipkart Visa Credit Card"
  accountName: string; // e.g. "Axis Bank Flipkart Visa Credit Card ••4723"
}

/** Read card product + last-4 from the statement header lines. */
function readMeta(lines: PdfPositionedLine[]): Meta {
  let product = 'Axis Credit Card';
  let last4 = '';
  for (const line of lines) {
    const text = line.spans.map((s) => s.text).join(' ');
    if (product === 'Axis Credit Card' && TITLE_RE.test(text)) {
      product = text.replace(/\s*Monthly Statement.*$/i, '').trim() || product;
    }
    const cn = CARD_NUMBER_RE.exec(text);
    if (cn && !last4) last4 = cn[1];
  }
  const accountName = last4 ? `${product} ••${last4}` : product;
  return { last4, product, accountName };
}

/** Index of the line that looks like the transaction-table header. */
function headerLineIndex(lines: PdfPositionedLine[]): number {
  return lines.findIndex((l) => {
    const text = l.spans.map((s) => s.text.toLowerCase()).join(' ');
    return text.includes('date') && text.includes('transaction details') && text.includes('amount') && text.includes('debit');
  });
}

// Wordings seen for the incoming bill-payment leg on the card: "BBPS Payment Received -", "IB PAYMENT #…".
// Any other credit (cashback / merchant refund / reversal) is treated as a refund (offsets spend).
const PAYMENT_RE = /payment received|bbps|\bIB\s*PAYMENT\b|\bNEFT\b|\bIMPS\b|auto\s*pay|autopay|payment recd|received\s*-/i;

/** Parse the statement's positioned lines into per-transaction raw rows. */
function toRows(lines: PdfPositionedLine[]): RawRow[] {
  const headerIdx = headerLineIndex(lines);
  if (headerIdx === -1) return [];
  let endIdx = lines.findIndex((l, i) => i > headerIdx && /end of transaction summary/i.test(l.spans.map((s) => s.text).join(' ')));
  if (endIdx === -1) endIdx = lines.length;

  const meta = readMeta(lines);
  const region = lines.slice(headerIdx + 1, endIdx);

  // Anchors carry a date in the Date column; other lines are wrapped detail continuations.
  interface Anchor {
    y: number;
    date: string;
    amount: string;
    drcr: string;
    details: string[]; // (y, text) collected then ordered top→bottom
    detailY: number[];
  }
  const anchors: Anchor[] = [];
  const continuations: { y: number; text: string }[] = [];
  for (const line of region) {
    const c = bandCells(line);
    if (DATE_RE.test(c.date.trim())) {
      anchors.push({
        y: line.y,
        date: c.date.trim(),
        amount: c.amount.trim(),
        drcr: c.drcr.trim(),
        details: c.details ? [c.details.trim()] : [],
        detailY: c.details ? [line.y] : [],
      });
    } else if (c.details.trim() !== '') {
      continuations.push({ y: line.y, text: c.details.trim() });
    }
  }
  if (anchors.length === 0) return [];

  // Attach each continuation to the nearest anchor by baseline distance.
  for (const cont of continuations) {
    let best = anchors[0];
    let bestD = Infinity;
    for (const a of anchors) {
      const d = Math.abs(a.y - cont.y);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    best.details.push(cont.text);
    best.detailY.push(cont.y);
  }

  // Build one raw row per anchor. Details ordered top→bottom (descending y = reading order).
  const seq = new Map<string, number>();
  return anchors.map((a, i) => {
    const order = a.details.map((text, idx) => ({ text, y: a.detailY[idx] })).sort((p, q) => q.y - p.y);
    const details = order.map((o) => o.text).join(' ').trim();
    const key = `${a.date}|${a.amount}`;
    const n = (seq.get(key) ?? 0) + 1;
    seq.set(key, n);
    return {
      cells: {
        date: a.date,
        details,
        amount: a.amount,
        drcr: a.drcr,
        last4: meta.last4,
        product: meta.product,
        account: meta.accountName,
        seq: String(n),
      },
      rowNumber: i + 1,
    };
  });
}

function build(row: RawRow, opts: { salvage: boolean }): NormalizedTxn {
  const cells = row.cells;
  const isoDate = parseCardDate(cells.date);
  if (isoDate === '') throw new Error(`Unparseable card date: "${cells.date}"`);

  let paise: number;
  try {
    paise = parseAmountPaise(cells.amount);
  } catch (e) {
    if (opts.salvage) paise = 0;
    else throw e;
  }

  const isCredit = /credit/i.test(cells.drcr);
  const details = cells.details ?? '';
  const ledgerSide: LedgerSide = isCredit ? 'credit' : 'debit';

  let direction: NormalizedTxn['direction'];
  let kind: TxnKind;
  let transferRole: TransferRole | null = null;
  if (!isCredit) {
    // A card charge — a real expense.
    direction = 'out';
    kind = 'paid';
  } else if (PAYMENT_RE.test(details)) {
    // The card's own bill-payment leg (mirror of the bank debit) — excluded from totals.
    direction = 'in';
    kind = 'billpay';
    transferRole = 'cc_payment_received';
  } else {
    // Cashback / merchant refund / reversal — money in that offsets spend, never income.
    direction = 'in';
    kind = 'refund';
  }

  const merchant = details.split(',')[0].trim() || null;
  const base = {
    isoDate,
    time: null,
    paise,
    direction,
    kind,
    counterpartyName: kind === 'paid' ? merchant : null,
    counterpartyVpa: null,
    accountName: cells.account || 'Axis Credit Card',
    rawDetails: details,
    rawTag: null,
    remarks: null,
    // Stable, re-import-safe, card-scoped key: no UPI RRN on card rows, so synthesise one that
    // disambiguates same-day/same-amount charges (seq) and never collides across cards (last4).
    sourceRef: `cc:${cells.last4 || 'x'}:${isoDate}:${paise}:${cells.seq}`,
    orderId: null,
    source: 'cc' as const,
    ledgerSide,
    transferRole,
  };
  return { ...base, dedupeKey: buildDedupeKey(base) };
}

export const axisCcAdapter: SourceAdapter = {
  source: 'cc',

  detect(sheets: SheetLike[]): boolean {
    return sheets.some(
      (s) => !!s.pdfLines && s.pdfLines.some((l) => TITLE_RE.test(l.spans.map((sp) => sp.text).join(' '))) && headerLineIndex(s.pdfLines) !== -1,
    );
  },

  selectSheet(sheets: SheetLike[]): SheetLike {
    const sheet = sheets.find((s) => !!s.pdfLines && headerLineIndex(s.pdfLines) !== -1);
    if (!sheet) throw new Error('Axis credit-card import: could not find the transaction summary');
    return sheet;
  },

  rows(sheet: SheetLike): RawRow[] {
    return toRows(sheet.pdfLines ?? []);
  },

  normalize(row: RawRow): NormalizedTxn {
    return build(row, { salvage: false });
  },

  // A dated row with an odd amount shouldn't be dropped — keep it as a needs-review 0-amount txn.
  salvage(row: RawRow): NormalizedTxn | null {
    if (parseCardDate(row.cells.date) === '') return null;
    try {
      return build(row, { salvage: true });
    } catch {
      return null;
    }
  },
};
