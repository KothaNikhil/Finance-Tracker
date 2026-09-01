import type { LendingRowSources } from '@/components/lending-row-label';
import { buildFilteredWorkbook } from '@/core/export';

import { exportCounterparty, type ExportCounterpartyTxn } from '../counterparty';

const SHEKHAR_10L = { id: 1, name: 'Shekhar 10l', personName: 'Shekhar' };
const SMR_LOAN = { id: 3, name: '', personName: 'Smr' };

/** A hand-entered "Lent" row: no merchant, and `raw_details` at its NOT NULL DEFAULT ''. */
function lendingTxn(over: Partial<ExportCounterpartyTxn> = {}): ExportCounterpartyTxn {
  return { counterpartyName: null, rawDetails: '', transferRole: 'lent', ...over };
}

function sources(over: Partial<LendingRowSources> = {}): LendingRowSources {
  return { personName: null, loan: null, splitLoans: [], ...over };
}

describe('exportCounterparty', () => {
  it('keeps the merchant an imported row already carries', () => {
    expect(
      exportCounterparty(
        { counterpartyName: 'Zomato', rawDetails: 'UPI/ZOMATO/1234', transferRole: null },
        sources(),
      ),
    ).toBe('Zomato');
  });

  it('falls back to the original statement text when there is no merchant', () => {
    expect(
      exportCounterparty(
        { counterpartyName: null, rawDetails: 'UPI/ZOMATO/1234', transferRole: null },
        sources(),
      ),
    ).toBe('UPI/ZOMATO/1234');
  });

  it('names an in-app lending row by its person and loan instead of leaving the cell empty', () => {
    expect(
      exportCounterparty(lendingTxn(), sources({ personName: 'Shekhar', loan: SHEKHAR_10L })),
    ).toBe('Shekhar · Shekhar 10l');
  });

  it('names a loan with no name of its own by the person alone', () => {
    expect(exportCounterparty(lendingTxn(), sources({ personName: 'Smr', loan: SMR_LOAN }))).toBe('Smr');
  });

  it('summarises a split across two people, whose transaction keeps no person of its own', () => {
    expect(
      exportCounterparty(lendingTxn(), sources({ splitLoans: [SHEKHAR_10L, SMR_LOAN] })),
    ).toBe('Split across 2 loans');
  });

  it('falls back to the role, spelled out without its emoji, when nothing else identifies a lending row', () => {
    expect(exportCounterparty(lendingTxn(), sources())).toBe('Lent');
    expect(exportCounterparty(lendingTxn({ transferRole: 'repaid_to_me' }), sources())).toBe('Repaid to me');
  });

  it('leaves an ordinary row with nothing to name blank, as the other columns already describe it', () => {
    expect(
      exportCounterparty({ counterpartyName: null, rawDetails: '   ', transferRole: null }, sources()),
    ).toBe('');
  });
});

describe('the Details column of the exported workbook', () => {
  it('is never blank for a lending row', () => {
    const counterparty = exportCounterparty(
      lendingTxn(),
      sources({ personName: 'Shekhar', loan: SHEKHAR_10L }),
    );
    const workbook = buildFilteredWorkbook(
      [
        {
          isoDate: '2026-08-31',
          time: '',
          paise: 5_000_000,
          countablePaise: 0,
          direction: 'out',
          isRefund: false,
          counterparty,
          categoryName: '',
          subcategoryName: '',
          paymentMode: '',
          person: 'Shekhar',
          account: '',
          remarks: '',
          ref: '',
        },
      ],
      'Lending.xlsx',
    );

    const august = workbook.sheets.find((sheet) => sheet.name === 'August')!;
    expect(august.rows[0][2].value).toBe('Shekhar · Shekhar 10l');
  });
});
