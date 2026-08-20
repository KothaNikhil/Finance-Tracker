import { paytmAdapter } from '../adapters/paytm';
import { buildDedupeKey, partitionDuplicates } from '../dedupe';
import type { NormalizedTxn, RawRow } from '../types';

// Build a Paytm "Passbook Payment History" row with the real column headers.
function makeRow(over: Partial<Record<string, string>>, rowNumber = 2): RawRow {
  const cells: Record<string, string> = {
    Date: '',
    Time: '',
    'Transaction Details': '',
    'Other Transaction Details (UPI ID or A/c No)': '',
    'Your Account': '',
    Amount: '',
    'UPI Ref No.': '',
    'Order ID': '',
    Remarks: '',
    Tags: '',
    Comment: '',
    ...over,
  };
  return { cells, rowNumber };
}

describe('paytmAdapter.normalize', () => {
  it('reads a debit "Paid to" merchant row and strips the app suffix from the VPA', () => {
    const txn = paytmAdapter.normalize(
      makeRow({
        Date: '29/05/2026',
        Time: '22:32:45',
        'Transaction Details': 'Paid to Sri Babu Raju Ram Fuel Station',
        'Other Transaction Details (UPI ID or A/c No)': 'paytmqr5d660h@ptys on Paytm',
        'Your Account': 'Axis Bank - 15',
        Amount: '-3,000.00',
        'UPI Ref No.': '614924612239',
        Remarks: 'Fuel',
        Tags: '#⛽️ Fuel',
      }),
    );

    expect(txn.isoDate).toBe('2026-05-29');
    expect(txn.time).toBe('22:32:45');
    expect(txn.paise).toBe(300000);
    expect(txn.direction).toBe('out');
    expect(txn.kind).toBe('paid');
    expect(txn.counterpartyName).toBe('Sri Babu Raju Ram Fuel Station');
    expect(txn.counterpartyVpa).toBe('paytmqr5d660h@ptys'); // " on Paytm" removed
    expect(txn.accountName).toBe('Axis Bank - 15');
    expect(txn.rawTag).toBe('#⛽️ Fuel'); // emoji tag preserved as-is
    expect(txn.remarks).toBe('Fuel');
    expect(txn.dedupeKey).toBe('ref:614924612239');
  });

  it('reads a credit "Received from" row as money in', () => {
    const txn = paytmAdapter.normalize(
      makeRow({
        Date: '11/05/2026',
        'Transaction Details': 'Received from Mrs BHAGYALAKSHMI',
        Amount: '+50,000.00',
        'UPI Ref No.': '646309645814',
      }),
    );
    expect(txn.direction).toBe('in');
    expect(txn.kind).toBe('received');
    expect(txn.paise).toBe(5000000);
  });

  it('treats an UNSIGNED "Transferred to Self" row as a self-transfer', () => {
    const txn = paytmAdapter.normalize(
      makeRow({
        Date: '12/05/2026',
        'Transaction Details': 'Transferred to Self, Karur Vysa Bank - 0050',
        Amount: '61,178.00', // no sign
        'UPI Ref No.': '205968472106',
        Remarks: 'Seemantham expenses',
      }),
    );
    expect(txn.direction).toBe('self');
    expect(txn.kind).toBe('self');
    expect(txn.counterpartyName).toBe('Karur Vysa Bank - 0050');
  });

  it('handles a Gold Coin Redemption with no UPI ref (falls back to Order ID for dedupe)', () => {
    const txn = paytmAdapter.normalize(
      makeRow({
        Date: '12/05/2026',
        'Transaction Details': 'Gold Coin Redemption',
        'Your Account': 'Gold Coins',
        Amount: '-49.75',
        'UPI Ref No.': '',
        'Order ID': '27018989106',
        Tags: '#🪙 Investment',
      }),
    );
    expect(txn.kind).toBe('gold');
    expect(txn.direction).toBe('out');
    expect(txn.paise).toBe(4975);
    expect(txn.counterpartyVpa).toBeNull();
    expect(txn.dedupeKey).toBe('order:27018989106'); // no ref → Order ID
  });

  it('reads a "Refund from Paytm" row as an incoming refund', () => {
    const txn = paytmAdapter.normalize(
      makeRow({
        'Transaction Details': 'Refund from Paytm',
        Date: '02/06/2026',
        Amount: '+601.00',
        'UPI Ref No.': '615305968156',
      }),
    );
    expect(txn.kind).toBe('refund');
    expect(txn.direction).toBe('in');
  });

  it('reports a clear error for an unparseable row (bad date)', () => {
    expect(() =>
      paytmAdapter.normalize(makeRow({ Date: '2026-05-12', Amount: '-10.00' }, 7)),
    ).toThrow();
  });
});

describe('detect + selectSheet', () => {
  const sheetsNamed = (...names: string[]) =>
    names.map((name) => ({ name, headers: [], rows: [], matrix: [] }));

  it('recognizes a Paytm workbook by its transaction sheet name', () => {
    expect(paytmAdapter.detect(sheetsNamed('Summary', 'Passbook Payment History'))).toBe(true);
    expect(paytmAdapter.detect(sheetsNamed('Sheet1', 'Sheet2'))).toBe(false);
  });
});

describe('dedupe', () => {
  it('prefers UPI ref, then Order ID, then a composite key', () => {
    const base = {
      isoDate: '2026-05-29',
      time: '22:32:45',
      paise: 300000,
      direction: 'out' as const,
      counterpartyVpa: 'x@ptys',
      counterpartyName: 'Shop',
      rawDetails: 'Paid to Shop',
    };
    expect(buildDedupeKey({ ...base, sourceRef: '111', orderId: '999' })).toBe('ref:111');
    expect(buildDedupeKey({ ...base, sourceRef: '', orderId: '999' })).toBe('order:999');
    expect(buildDedupeKey({ ...base, sourceRef: '', orderId: '' })).toBe(
      'c:2026-05-29|22:32:45|300000|out|x@ptys|paid to shop',
    );
  });

  it('skips duplicates within a batch and against existing keys', () => {
    const mk = (ref: string): NormalizedTxn =>
      paytmAdapter.normalize(
        makeRow({
          Date: '01/05/2026',
          'Transaction Details': 'Paid to Shop',
          Amount: '-10.00',
          'UPI Ref No.': ref,
        }),
      );

    const batch = [mk('A'), mk('B'), mk('A')]; // 'A' appears twice
    const result = partitionDuplicates(batch, new Set(['ref:B']));

    expect(result.unique.map((t) => t.dedupeKey)).toEqual(['ref:A']); // B already existed; second A is dup
    expect(result.duplicates).toHaveLength(2);
  });
});
