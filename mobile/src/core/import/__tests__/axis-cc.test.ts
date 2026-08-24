/**
 * Axis credit-card statement adapter. Fixtures are SYNTHETIC positioned-line sets (fake name/card/
 * merchants) shaped exactly like the real statements the PDF extractor produces — so no PII or real
 * statement is committed. Covers detection, column banding, spend/cashback/payment classification,
 * Indian lakh amounts, wrapped detail lines, and stable card-scoped dedupe keys.
 */

import { axisCcAdapter, readCardStatementMeta } from '../adapters/axis-cc';
import type { NormalizedTxn, PdfPositionedLine, SheetLike } from '../types';

interface LineSpec {
  y: number;
  cells: [number, string][]; // [x, text]
}

function sheetFrom(specs: LineSpec[]): SheetLike {
  const pdfLines: PdfPositionedLine[] = specs.map((l) => ({ y: l.y, spans: l.cells.map(([x, text]) => ({ x, text })) }));
  return { name: 'PDF', headers: [], rows: [], matrix: [], pdfLines };
}

// A realistic Axis Rewards statement (fake data): a spend, a duplicate same-day spend, a cashback
// (details wrapped above the anchor), and a lakh-value BBPS payment (details wrapped above the anchor).
const STATEMENT: LineSpec[] = [
  { y: 782, cells: [[311, 'Axis Rewards Credit Card Monthly Statement']] },
  { y: 704, cells: [[48, 'TADPATRI 515411'], [369, 'Credit Card Number: 5521XXXXXXXX9999']] },
  { y: 612, cells: [[55, 'Selected Statement Month'], [222, 'Credit Limit'], [388, 'Opening Balance']] },
  { y: 596, cells: [[55, 'Jan 2026'], [222, '₹ 2,98,000.00'], [388, '₹ 0.00']] },
  { y: 552, cells: [[52, 'Date'], [152, 'Transaction Details'], [352, 'Amount (INR)'], [452, 'Debit/Credit']] },
  { y: 520, cells: [[152, 'Cashback credit Jan26-']] },
  { y: 512, cells: [[52, "10 Jan '26"], [352, '₹ 15.00'], [452, 'Credit']] },
  { y: 488, cells: [[52, "12 Jan '26"], [152, 'COFFEE HOUSE,PUNE'], [352, '₹ 250.00'], [452, 'Debit']] },
  { y: 464, cells: [[52, "12 Jan '26"], [152, 'COFFEE HOUSE,PUNE'], [352, '₹ 250.00'], [452, 'Debit']] },
  { y: 440, cells: [[152, 'BBPS Payment Received - REF123']] },
  { y: 432, cells: [[52, "05 Jan '26"], [352, '₹ 1,00,000.00'], [452, 'Credit']] },
  { y: 396, cells: [[240, '**End of Transaction Summary**']] },
  { y: 18, cells: [[528, 'Page 1 of 1']] },
];

function parse(specs: LineSpec[]): NormalizedTxn[] {
  const sheet = sheetFrom(specs);
  return axisCcAdapter.rows!(sheet).map((r) => axisCcAdapter.normalize(r));
}

describe('axisCcAdapter.detect', () => {
  it('recognises an Axis credit-card statement', () => {
    expect(axisCcAdapter.detect([sheetFrom(STATEMENT)])).toBe(true);
  });

  it('ignores a non-PDF (xlsx) sheet', () => {
    expect(axisCcAdapter.detect([{ name: 'S', headers: [], rows: [], matrix: [['Date', 'Amount']] }])).toBe(false);
  });

  it('ignores a PDF that is not a card statement', () => {
    const other = sheetFrom([{ y: 700, cells: [[50, 'Some other document']] }]);
    expect(axisCcAdapter.detect([other])).toBe(false);
  });
});

describe('axisCcAdapter.normalize', () => {
  const txns = parse(STATEMENT);

  it('extracts every transaction row', () => {
    expect(txns).toHaveLength(4);
  });

  it('classifies a card spend (Debit) as a real expense', () => {
    const spend = txns.find((t) => t.counterpartyName === 'COFFEE HOUSE');
    expect(spend).toMatchObject({
      isoDate: '2026-01-12',
      direction: 'out',
      kind: 'paid',
      paise: 25000,
      transferRole: null,
      source: 'cc',
      ledgerSide: 'debit',
    });
    expect(spend?.accountName).toBe('Axis Rewards Credit Card ••9999');
  });

  it('classifies cashback (Credit) as a refund, joining the wrapped detail line', () => {
    const cb = txns.find((t) => t.isoDate === '2026-01-10');
    expect(cb).toMatchObject({ direction: 'in', kind: 'refund', paise: 1500, transferRole: null });
    expect(cb?.rawDetails).toContain('Cashback');
  });

  it('classifies the incoming bill-payment leg as cc_payment_received (excluded), handling lakh amounts', () => {
    const pay = txns.find((t) => t.isoDate === '2026-01-05');
    expect(pay).toMatchObject({
      direction: 'in',
      kind: 'billpay',
      transferRole: 'cc_payment_received',
      paise: 10000000, // ₹1,00,000.00
    });
    expect(pay?.rawDetails).toContain('BBPS Payment Received');
  });

  it('itemises spends AND refunds/cashbacks (excluding the payment leg), netting to the bill', () => {
    // Mirrors cardStatementItemsQuery (everything except the cc_payment_received leg) + the sheet's
    // net = spends − refunds. This is what "view card spends" must show so the statement reconciles.
    const items = txns.filter((t) => t.transferRole !== 'cc_payment_received');
    expect(items).toHaveLength(3); // 2 spends + 1 cashback; the BBPS payment-received row is excluded
    expect(items.some((t) => t.kind === 'refund' && t.direction === 'in')).toBe(true); // cashback included
    const net = items.reduce((sum, t) => sum + (t.direction === 'out' ? t.paise : -t.paise), 0);
    expect(net).toBe(25000 + 25000 - 1500); // ₹250 + ₹250 spends − ₹15 cashback
  });

  it('gives same-day, same-amount charges DISTINCT dedupe keys, and re-import is idempotent', () => {
    const spends = txns.filter((t) => t.counterpartyName === 'COFFEE HOUSE');
    expect(spends).toHaveLength(2);
    expect(spends[0].dedupeKey).not.toBe(spends[1].dedupeKey);

    // Re-parsing the same statement yields identical keys (idempotent import).
    const again = parse(STATEMENT).filter((t) => t.counterpartyName === 'COFFEE HOUSE');
    expect(again.map((t) => t.dedupeKey).sort()).toEqual(spends.map((t) => t.dedupeKey).sort());
  });

  it('scopes dedupe keys per card so different cards never collide', () => {
    const otherCard = STATEMENT.map((l) =>
      l.cells.some(([, t]) => t.includes('Credit Card Number'))
        ? { y: l.y, cells: l.cells.map(([x, t]) => [x, t.replace('9999', '1111')] as [number, string]) }
        : l,
    );
    const a = parse(STATEMENT).find((t) => t.counterpartyName === 'COFFEE HOUSE')!;
    const b = parse(otherCard).find((t) => t.counterpartyName === 'COFFEE HOUSE')!;
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
  });
});

describe('readCardStatementMeta', () => {
  const META_LINES: LineSpec[] = [
    { y: 782, cells: [[311, 'Axis Rewards Credit Card Monthly Statement']] },
    { y: 704, cells: [[369, 'Credit Card Number: 5521XXXXXXXX9999']] },
    { y: 659, cells: [[55, 'Total Payment Due'], [222, 'Minimum Payment Due'], [388, 'Payment Due Date']] },
    { y: 642, cells: [[55, '₹ 1,227.00'], [222, '₹ 100.00'], [388, "21 Jun '26"]] },
    { y: 612, cells: [[55, 'Selected Statement Month'], [222, 'Credit Limit'], [388, 'Opening Balance']] },
    { y: 596, cells: [[55, 'Jun 2026'], [222, '₹ 2,98,000.00'], [388, '₹ 1,882.90']] },
  ];

  it('reads card last-4, statement month and Total Payment Due', () => {
    const meta = readCardStatementMeta(sheetFrom(META_LINES).pdfLines!);
    expect(meta).toEqual({ cardLast4: '9999', statementMonth: '2026-06', totalDuePaise: 122700 });
  });

  it('handles a negative (credit) Total Payment Due', () => {
    const lines = META_LINES.map((l) =>
      l.y === 642 ? { y: l.y, cells: [[55, '₹ -84.00'], ...l.cells.slice(1)] as [number, string][] } : l,
    );
    expect(readCardStatementMeta(sheetFrom(lines).pdfLines!).totalDuePaise).toBe(-8400);
  });
});

describe('axisCcAdapter.salvage', () => {
  it('keeps a dated row with an unreadable amount as a 0-paise needs-review txn', () => {
    const sheet = sheetFrom([
      ...STATEMENT.slice(0, 5),
      { y: 488, cells: [[52, "12 Jan '26"], [152, 'WEIRD ROW'], [352, '₹ ??'], [452, 'Debit']] },
      { y: 396, cells: [[240, '**End of Transaction Summary**']] },
    ]);
    const row = axisCcAdapter.rows!(sheet)[0];
    expect(() => axisCcAdapter.normalize(row)).toThrow(); // bad amount → normalize rejects
    const salvaged = axisCcAdapter.salvage!(row);
    expect(salvaged).not.toBeNull();
    expect(salvaged?.paise).toBe(0);
  });
});
