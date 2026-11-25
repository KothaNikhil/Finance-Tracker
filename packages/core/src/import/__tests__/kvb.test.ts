import { kvbAdapter } from '../adapters/kvb';
import { runImport } from '../pipeline';
import type { SheetLike } from '../types';

/** Build a KVB-shaped sheet: preamble, header, an opening B/F row, then data rows. */
function kvbSheet(dataRows: string[][]): SheetLike {
  const matrix = [
    ['Customer ID / Name', 'xxxx / K NIKHIL'],
    ['Current Balance', '1,00,000.00'],
    ['Transaction Date', 'Value Date', 'Particulars', 'Ref.No.', 'Debit', 'Credit', 'Running Balance'],
    ['19-FEB-2026', '19-FEB-2026', 'B/F', '-', '-', '-', '2,04,111.54'],
    ...dataRows,
  ];
  return { name: 'CASA Statement - EXCEL Format', headers: [], rows: [], matrix };
}

const D = (
  txnDate: string,
  particulars: string,
  ref: string,
  debit: string,
  credit: string,
  bal = '0',
): string[] => [txnDate, txnDate.slice(0, 11), particulars, ref, debit, credit, bal];

function importKvb(dataRows: string[][]) {
  return runImport([kvbSheet(dataRows)], [kvbAdapter]);
}

describe('kvbAdapter', () => {
  it('detects the statement and skips the preamble, header, and B/F opening row', () => {
    const p = importKvb([
      D('01-MAR-2026 20:08:19', 'UPI-DR-201090710988-ZEPTO MARKET', '201090710988', '54,000.00', '0.00'),
    ]);
    expect(p.source).toBe('bank');
    expect(p.parsed).toHaveLength(1); // B/F excluded
    expect(p.errors).toHaveLength(0);
  });

  it('parses a UPI debit: date+time, amount, side, RRN from the Ref.No column', () => {
    const [t] = importKvb([
      D('06-MAR-2026 18:18:09', 'UPI-DR-201395301225-MANIPAL HOSP', '201395301225', '47,715.74', '0.00'),
    ]).parsed;
    expect(t).toMatchObject({
      isoDate: '2026-03-06',
      time: '18:18:09',
      paise: 4771574,
      direction: 'out',
      ledgerSide: 'debit',
      sourceRef: '201395301225',
      counterpartyName: 'MANIPAL HOSP',
      accountName: 'Karur Vysya Bank',
    });
  });

  it('reads the RRN from the narration when the Ref.No column is empty (IMPS)', () => {
    const [t] = importKvb([
      D('01-MAR-2026 16:36:46', 'IMPS-606038652798-KNIKHIL', '-', '0.00', '1,97,993.00'),
    ]).parsed;
    expect(t.sourceRef).toBe('606038652798');
    expect(t.ledgerSide).toBe('credit');
    // "KNIKHIL" matches the holder "K NIKHIL" → self-transfer.
    expect(t.direction).toBe('self');
  });

  it('tallies total debit and total credit', () => {
    const p = importKvb([
      D('01-MAR-2026 10:00:00', 'UPI-DR-1-A', '1', '54,000.00', '0.00'),
      D('02-MAR-2026 10:00:00', 'UPI-CR-2-B', '2', '0.00', '1,000.00'),
    ]);
    expect(p.totalDebitPaise).toBe(5400000);
    expect(p.totalCreditPaise).toBe(100000);
  });
});
