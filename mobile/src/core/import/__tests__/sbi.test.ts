import { sbiAdapter } from '../adapters/sbi';
import { runImport } from '../pipeline';
import type { SheetLike } from '../types';

/** Build an SBI-shaped sheet: an A1 holder/email cell, a preamble, the header, then data rows. */
function sbiSheet(dataRows: string[][]): SheetLike {
  const matrix = [
    ['Mr. KOTHA  NIKHIL\r\nkothanikhil@gmail.com', 'State Bank of India'],
    ['Date of Statement  :  20-08-2026', 'Branch Code  :  923'],
    ['Statement From  :  01-07-2026  to  31-07-2026', ''],
    ['Date', 'Details', 'Ref No/Cheque No', 'Debit', 'Credit', 'Balance'],
    ...dataRows,
  ];
  return { name: 'sheet', headers: [], rows: [], matrix };
}

const D = (date: string, details: string, debit: string, credit: string, bal = '0'): string[] => [
  date,
  details,
  '',
  debit,
  credit,
  bal,
];

function importSbi(dataRows: string[][]) {
  return runImport([sbiSheet(dataRows)], [sbiAdapter]);
}

// The two real rows from the sample July statement (₹26,624 DIRECT DR out, ₹27,000 UPI credit in).
const DIRECT_DR = ' DIRECT DR   0042247970612 OF Mr.\r\n  KOTHA  NIKHIL AT 00923 TADPATRI';
const DEP_TFR_UPI =
  ' DEP TFR    UPI/CR/618411469877/KOTHA NI/UTIB/7\r\n 259131616/Car   0097736162097 AT 00923 TADPATRI';

describe('sbiAdapter', () => {
  it('detects the statement and skips the preamble/header, keeping only dated rows', () => {
    const p = importSbi([
      D('03/07/2026', DIRECT_DR, '26624.00', '', '10821.77'),
      D('03/07/2026', DEP_TFR_UPI, '', '27000.00', '37821.77'),
      D('', '', '', '', ''), // blank line before the summary — must be dropped
      ['Statement Summary : 01-07-2026 To 31-07-2026', '', '', '', '', ''],
    ]);
    expect(p.source).toBe('bank');
    expect(p.parsed).toHaveLength(2);
    expect(p.errors).toHaveLength(0);
  });

  it('parses a UPI credit: date, amount, side, RRN + counterparty + note from the narration', () => {
    const [t] = importSbi([D('03/07/2026', DEP_TFR_UPI, '', '27000.00', '37821.77')]).parsed;
    expect(t).toMatchObject({
      isoDate: '2026-07-03',
      paise: 2700000,
      ledgerSide: 'credit',
      sourceRef: '618411469877',
      counterpartyName: 'KOTHA NI',
      remarks: 'Car', // branch tag + account digits stripped off
      accountName: 'State Bank of India',
    });
  });

  it('marks a UPI transfer to the account holder as a self-transfer (excluded from spend)', () => {
    // "KOTHA NI" (truncated) is a prefix of the holder "KOTHA NIKHIL" → self.
    const [t] = importSbi([D('03/07/2026', DEP_TFR_UPI, '', '27000.00', '37821.77')]).parsed;
    expect(t.direction).toBe('self');
    expect(t.kind).toBe('self');
  });

  it('GUARD: does NOT treat a DIRECT DR that merely names the holder as a self-transfer', () => {
    const [t] = importSbi([D('03/07/2026', DIRECT_DR, '26624.00', '', '10821.77')]).parsed;
    expect(t.direction).toBe('out'); // a real debit — counted as spend, not netted out
    expect(t.kind).toBe('other'); // no P2M/P2A hint → flagged for review, never a false "paid"
    expect(t.counterpartyName).toBeNull(); // holder name is NOT captured as a counterparty
    expect(t.sourceRef).toBeNull(); // the mandate number is not a UPI RRN
  });

  it('shares the RRN dedupe key with the Axis leg of the same transfer', () => {
    const [t] = importSbi([D('03/07/2026', DEP_TFR_UPI, '', '27000.00', '37821.77')]).parsed;
    // Same RRN → same key → the Axis debit and this SBI credit collapse to one transaction.
    expect(t.dedupeKey).toBe('ref:618411469877');
  });

  it('tallies total debit and total credit for reconciliation', () => {
    const p = importSbi([
      D('03/07/2026', DIRECT_DR, '26624.00', '', '10821.77'),
      D('03/07/2026', DEP_TFR_UPI, '', '27000.00', '37821.77'),
    ]);
    expect(p.totalDebitPaise).toBe(2662400);
    expect(p.totalCreditPaise).toBe(2700000);
  });
});
