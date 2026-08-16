import { buildYearlyWorkbook } from '../build-workbook';
import type { ExportTxn } from '../types';

function txn(over: Partial<ExportTxn> & Pick<ExportTxn, 'isoDate' | 'paise' | 'direction'>): ExportTxn {
  return {
    time: '',
    isRefund: false,
    counterparty: '',
    categoryName: '',
    subcategoryName: '',
    paymentMode: '',
    person: '',
    account: '',
    remarks: '',
    ref: '',
    ...over,
  };
}

const SAMPLE: ExportTxn[] = [
  txn({ isoDate: '2026-05-02', time: '10:00:00', paise: 45000, direction: 'out', counterparty: 'Zomato', categoryName: 'Food & Dining' }),
  txn({ isoDate: '2026-05-01', time: '09:00:00', paise: 38000, direction: 'out', counterparty: 'Zepto' }),
  txn({ isoDate: '2026-05-10', paise: 500000, direction: 'in', counterparty: 'Boss' }),
  txn({ isoDate: '2026-05-12', paise: 5000, direction: 'in', isRefund: true, counterparty: 'Paytm' }),
  txn({ isoDate: '2026-05-15', paise: 2700000, direction: 'self', counterparty: 'Self' }),
  txn({ isoDate: '2026-08-03', paise: 60000, direction: 'out', counterparty: 'Amazon' }),
  txn({ isoDate: '2025-12-31', paise: 99999, direction: 'out', counterparty: 'Other year' }), // filtered out
];

describe('buildYearlyWorkbook', () => {
  const wb = buildYearlyWorkbook(SAMPLE, 2026);

  it('names the file by year and leads with a Summary sheet', () => {
    expect(wb.fileName).toBe('Finance-Tracker-2026.xlsx');
    expect(wb.sheets[0].name).toBe('Summary');
  });

  it('creates a sheet only for months that have transactions, in order', () => {
    expect(wb.sheets.map((s) => s.name)).toEqual(['Summary', 'May', 'August']);
  });

  it('excludes other years entirely', () => {
    // "Other year" is a 2025 row; no December sheet, and its ₹999.99 is absent.
    expect(wb.sheets.some((s) => s.name === 'December')).toBe(false);
  });

  it('sorts a month log chronologically by date then time', () => {
    const may = wb.sheets.find((s) => s.name === 'May')!;
    // Zepto (May 1) should come before Zomato (May 2). Details is column index 2.
    expect(may.rows[0][2].value).toBe('Zepto');
    expect(may.rows[1][2].value).toBe('Zomato');
  });

  it('labels a self-transfer as a Transfer in the log but leaves it out of totals', () => {
    const may = wb.sheets.find((s) => s.name === 'May')!;
    const typeCells = may.rows.map((r) => r[7]?.value);
    expect(typeCells).toContain('Transfer'); // the self row is present in the log

    // Summary row for May: [Month, Spent, Received, Refunds, Net, Count]
    const maySummary = wb.sheets[0].rows.find((r) => r[0].value === 'May')!;
    expect(maySummary[1].value).toBe((45000 + 38000) / 100); // spent, no self-transfer
    expect(maySummary[2].value).toBe(500000 / 100); // received (income only)
    expect(maySummary[3].value).toBe(5000 / 100); // refunds
    expect(maySummary[4].value).toBe((45000 + 38000 - 5000) / 100); // net = spent - refunds
    expect(maySummary[5].value).toBe(4); // 4 counted (out+out+in+refund); self excluded
  });

  it('money cells carry a rupee number and the money kind', () => {
    const maySummary = wb.sheets[0].rows.find((r) => r[0].value === 'May')!;
    expect(maySummary[1].kind).toBe('money');
    expect(maySummary[0].kind).toBe('text');
  });

  it('ends the Summary with a grand total across all months', () => {
    const total = wb.sheets[0].rows.find((r) => r[0].value === 'Total')!;
    expect(total[1].value).toBe((45000 + 38000 + 60000) / 100); // May spend + August spend
    expect(total[5].value).toBe(5); // 4 in May + 1 in August
  });

  it('still returns a Summary sheet for an empty year', () => {
    const empty = buildYearlyWorkbook([], 2030);
    expect(empty.sheets.map((s) => s.name)).toEqual(['Summary']);
    const total = empty.sheets[0].rows.find((r) => r[0].value === 'Total')!;
    expect(total[1].value).toBe(0);
  });
});
