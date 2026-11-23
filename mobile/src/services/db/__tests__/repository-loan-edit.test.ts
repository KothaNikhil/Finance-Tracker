import { loanBalanceFromTxns } from '@/core/lending/roles';

import {
  deleteLoanTransaction,
  getEditableLoanTransaction,
  updateLoan,
  updateLoanTransaction,
} from '../repository';

const mockGetDb = jest.fn();
const mockGetSqlite = jest.fn();

jest.mock('@/core/db/runtime', () => ({
  getDb: () => mockGetDb(),
  setMeta: (...args: unknown[]) => mockGetSqlite().runSync(...args),
}));

/**
 * The repository builds drizzle chains rather than running SQL here, so results are queued in call
 * order and every `update().set()` patch is captured. Assertions are on the patches applied.
 */
function databaseFor(options: { gets?: unknown[]; alls?: unknown[][] } = {}) {
  const gets = [...(options.gets ?? [])];
  const alls = [...(options.alls ?? [])];

  const selectChain = {
    from: jest.fn(),
    where: jest.fn(),
    get: jest.fn(() => gets.shift()),
    all: jest.fn(() => alls.shift() ?? []),
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);

  const updatePatches: Record<string, unknown>[] = [];
  const updateRun = jest.fn();
  const updateWhere = jest.fn(() => ({ run: updateRun }));
  const updateSet = jest.fn((patch: Record<string, unknown>) => {
    updatePatches.push(patch);
    return { where: updateWhere };
  });
  const deleteRun = jest.fn();
  const deleteWhere = jest.fn(() => ({ run: deleteRun }));

  const db = {
    select: jest.fn(() => selectChain),
    update: jest.fn(() => ({ set: updateSet })),
    delete: jest.fn(() => ({ where: deleteWhere })),
  };
  mockGetDb.mockReturnValue(db);
  mockGetSqlite.mockReturnValue({ runSync: jest.fn() });

  return { db, updatePatches, deleteRun, updateRun };
}

beforeEach(() => {
  mockGetDb.mockReset();
  mockGetSqlite.mockReset();
});

describe('updateLoan keeps attached transactions consistent', () => {
  it('re-derives roles when the direction flips, and follows direction only on hand-entered rows', () => {
    const { updatePatches } = databaseFor({
      gets: [{ kind: 'lent', personId: 7 }],
      alls: [
        [
          { id: 1, transferRole: 'lent', source: 'manual' },
          { id: 2, transferRole: 'repaid_to_me', source: 'axis' },
          { id: 3, transferRole: 'interest_received', source: 'manual' },
        ],
        [],
      ],
    });

    updateLoan(4, { kind: 'borrowed' });

    const [loanPatch, manualPrincipal, imported, manualInterest] = updatePatches;
    expect(loanPatch.kind).toBe('borrowed');

    expect(manualPrincipal.transferRole).toBe('borrowed');
    expect(manualPrincipal.direction).toBe('in');

    expect(imported.transferRole).toBe('repaid_by_me');
    expect(imported).not.toHaveProperty('direction');

    expect(manualInterest.transferRole).toBe('interest_paid');
    expect(manualInterest.direction).toBe('out');
  });

  it('moves attached transactions to the new person', () => {
    const { updatePatches } = databaseFor({
      gets: [{ kind: 'lent', personId: 7 }],
      alls: [[{ id: 1, transferRole: 'lent', source: 'manual' }], []],
    });

    updateLoan(4, { personId: 9 });

    expect(updatePatches[1]).toEqual({ personId: 9 });
  });

  it('leaves transactions untouched when only the name changes', () => {
    const { updatePatches } = databaseFor({ gets: [{ kind: 'lent', personId: 7 }] });

    updateLoan(4, { name: '  Wedding  ' });

    expect(updatePatches).toHaveLength(1);
    expect(updatePatches[0].name).toBe('Wedding');
  });
});

describe('editing a hand-entered loan entry', () => {
  it('reads back a manual entry and refuses an imported one', () => {
    databaseFor({
      gets: [
        {
          loanId: 4,
          transferRole: 'repaid_to_me',
          paise: 50_000,
          isoDate: '2026-08-01',
          remarks: 'Cash',
          source: 'manual',
        },
      ],
    });
    expect(getEditableLoanTransaction(11)).toEqual({
      loanId: 4,
      part: 'repayment',
      paise: 50_000,
      isoDate: '2026-08-01',
      remarks: 'Cash',
    });

    databaseFor({
      gets: [
        {
          loanId: 4,
          transferRole: 'repaid_to_me',
          paise: 50_000,
          isoDate: '2026-08-01',
          remarks: null,
          source: 'axis',
        },
      ],
    });
    expect(getEditableLoanTransaction(12)).toBeNull();
  });

  it('applies amount, date, note and part, deriving the role from the loan', () => {
    const { updatePatches } = databaseFor({
      gets: [
        { loanId: 4, transferRole: 'lent', source: 'manual' },
        { kind: 'lent', personId: 7 },
      ],
    });

    updateLoanTransaction(11, {
      paise: 75_000,
      isoDate: '2026-09-01',
      remarks: 'Corrected',
      part: 'interest',
    });

    expect(updatePatches[0]).toEqual({
      paise: 75_000,
      isoDate: '2026-09-01',
      remarks: 'Corrected',
      transferRole: 'interest_received',
      direction: 'in',
    });
  });

  it('refuses to rewrite an imported row', () => {
    databaseFor({ gets: [{ loanId: 4, transferRole: 'repaid_to_me', source: 'axis' }] });

    expect(() => updateLoanTransaction(12, { paise: 1 })).toThrow(
      'Only a manually added entry can be edited.',
    );
  });

  it('keeps amount and date validation on edit, not just on creation', () => {
    databaseFor({
      gets: [
        { loanId: 4, transferRole: 'lent', source: 'manual' },
        { kind: 'lent', personId: 7 },
      ],
    });
    expect(() => updateLoanTransaction(11, { paise: 0 })).toThrow(
      'Amount must be a positive integer in paise.',
    );

    databaseFor({
      gets: [
        { loanId: 4, transferRole: 'lent', source: 'manual' },
        { kind: 'lent', personId: 7 },
      ],
    });
    expect(() => updateLoanTransaction(11, { paise: 10.5 })).toThrow(
      'Amount must be a positive integer in paise.',
    );

    databaseFor({
      gets: [
        { loanId: 4, transferRole: 'lent', source: 'manual' },
        { kind: 'lent', personId: 7 },
      ],
    });
    expect(() => updateLoanTransaction(11, { isoDate: '01/09/2026' })).toThrow(
      'Date must be an ISO YYYY-MM-DD string.',
    );
  });

  it('deletes a manual entry but never an imported one', () => {
    const manual = databaseFor({ gets: [{ source: 'manual', loanId: 4 }] });
    deleteLoanTransaction(11);
    expect(manual.deleteRun).toHaveBeenCalled();

    databaseFor({ gets: [{ source: 'axis', loanId: 4 }] });
    expect(() => deleteLoanTransaction(12)).toThrow(
      'Only a manually added entry can be deleted here.',
    );
  });
});

describe('balances recompute from the edited rows', () => {
  it('moves an amount between principal and interest when the part changes', () => {
    const before = loanBalanceFromTxns([
      { transferRole: 'lent', paise: 100_000 },
      { transferRole: 'repaid_to_me', paise: 40_000 },
    ]);
    expect(before).toEqual({
      principalPaise: 100_000,
      repaidPaise: 40_000,
      outstandingPaise: 60_000,
      interestPaise: 0,
    });

    const afterPartChange = loanBalanceFromTxns([
      { transferRole: 'lent', paise: 100_000 },
      { transferRole: 'interest_received', paise: 40_000 },
    ]);
    expect(afterPartChange).toEqual({
      principalPaise: 100_000,
      repaidPaise: 0,
      outstandingPaise: 100_000,
      interestPaise: 40_000,
    });

    const afterAmountChange = loanBalanceFromTxns([
      { transferRole: 'lent', paise: 100_000 },
      { transferRole: 'repaid_to_me', paise: 75_000 },
    ]);
    expect(afterAmountChange.outstandingPaise).toBe(25_000);
  });

  it('keeps each part intact when a loan flips direction', () => {
    const lent = loanBalanceFromTxns([
      { transferRole: 'lent', paise: 100_000 },
      { transferRole: 'repaid_to_me', paise: 40_000 },
      { transferRole: 'interest_received', paise: 5_000 },
    ]);
    const borrowed = loanBalanceFromTxns([
      { transferRole: 'borrowed', paise: 100_000 },
      { transferRole: 'repaid_by_me', paise: 40_000 },
      { transferRole: 'interest_paid', paise: 5_000 },
    ]);

    expect(borrowed).toEqual(lent);
  });
});
