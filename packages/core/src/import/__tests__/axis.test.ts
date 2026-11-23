import { axisAdapter } from '../adapters/axis';
import { runImport } from '../pipeline';
import type { SheetLike } from '../types';

/** Build an Axis-shaped sheet from raw rows (preamble + header + data + legend live in `matrix`). */
function axisSheet(dataRows: string[][]): SheetLike {
  const matrix = [
    ['Name :- KOTHA NIKHIL'],
    ['Statement of Axis Account'],
    ['SRL NO', 'Tran Date', 'CHQNO', 'PARTICULARS', 'DR', 'CR', 'BAL', 'SOL'],
    ...dataRows,
    ['This is a system generated output and requires no signature.'],
  ];
  return { name: 'Account Statement', headers: [], rows: [], matrix };
}

const D = (
  srl: string,
  date: string,
  particulars: string,
  dr: string,
  cr: string,
  bal = '0',
): string[] => [srl, date, '', particulars, dr, cr, bal, '5157'];

function importAxis(dataRows: string[][]) {
  return runImport([axisSheet(dataRows)], [axisAdapter]);
}

describe('axisAdapter', () => {
  it('detects the statement and skips the preamble, header, and legend rows', () => {
    const p = importAxis([
      D('1', '19-02-2026', 'UPI/P2M/605003255506/ZOMATO LTD/Lunch/YES BANK', '200.00', ' '),
    ]);
    expect(p.source).toBe('bank');
    expect(p.parsed).toHaveLength(1); // preamble/header/legend excluded
    expect(p.errors).toHaveLength(0);
  });

  it('parses a UPI merchant debit: amount, side, RRN, merchant, note', () => {
    const [t] = importAxis([
      D('1', '19-02-2026', 'UPI/P2M/605003255506/ZOMATO LTD/Lunch/YES BANK', '1,200.50', ' '),
    ]).parsed;
    expect(t).toMatchObject({
      isoDate: '2026-02-19',
      paise: 120050,
      direction: 'out',
      kind: 'paid',
      ledgerSide: 'debit',
      counterpartyName: 'ZOMATO LTD',
      remarks: 'Lunch',
      sourceRef: '605003255506',
      accountName: 'Axis Bank',
      source: 'bank',
    });
  });

  it('classifies a P2A UPI debit as a person-send (kind "sent")', () => {
    const [t] = importAxis([
      D('1', '20-02-2026', 'UPI/P2A/605154041828/A PRATHAP MOULI/Chapati/ICICI Bank', '30.00', ' '),
    ]).parsed;
    expect(t.kind).toBe('sent');
    expect(t.direction).toBe('out');
  });

  it('parses a NEFT credit as money-in', () => {
    const [t] = importAxis([
      D('1', '27-02-2026', 'NEFT/CITIN26628830480/TEKTRONIX INDIA/CITI BANK', ' ', '1,97,993.00'),
    ]).parsed;
    expect(t).toMatchObject({ direction: 'in', kind: 'received', ledgerSide: 'credit', paise: 19799300 });
    expect(t.counterpartyName).toBe('TEKTRONIX INDIA');
  });

  it('detects a transfer to the account holder as a self-transfer', () => {
    const [t] = importAxis([
      D('1', '01-03-2026', 'IMPS/P2A/606038652798/KOTHA NIKHIL/X50/KARURVYSYABANKLTD/', '1000.00', ' '),
    ]).parsed;
    expect(t.direction).toBe('self');
    expect(t.kind).toBe('self');
  });

  it('tallies total debit and total credit for reconciliation', () => {
    const p = importAxis([
      D('1', '19-02-2026', 'UPI/P2M/1/A/x/B', '200.00', ' '),
      D('2', '19-02-2026', 'UPI/P2M/2/C/y/B', '50.00', ' '),
      D('3', '27-02-2026', 'NEFT/3/EMP/B', ' ', '1000.00'),
    ]);
    expect(p.totalDebitPaise).toBe(25000);
    expect(p.totalCreditPaise).toBe(100000);
  });

  it('salvages a row with a malformed amount rather than dropping it', () => {
    const p = importAxis([D('1', '19-02-2026', 'UPI/P2M/9/Odd/x/B', '1.2.3', ' ')]);
    expect(p.errors).toHaveLength(0);
    expect(p.salvaged).toHaveLength(1);
    expect(p.parsed).toHaveLength(1); // kept, not lost
  });
});
