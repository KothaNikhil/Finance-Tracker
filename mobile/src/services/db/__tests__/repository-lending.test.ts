import {
  attachTransactionToLoan,
  splitTransactionAcrossLoans,
} from '../repository';

const mockGetDb = jest.fn();
const mockGetSqlite = jest.fn();

jest.mock('../database', () => ({
  getDb: () => mockGetDb(),
  getSqlite: () => mockGetSqlite(),
}));

interface SourceRow {
  source: string;
  direction: string;
  paise: number;
}

interface LoanMeta {
  kind: 'lent' | 'borrowed';
  personId: number;
}

function databaseFor(source: SourceRow, loanMetas: LoanMeta[] = []) {
  const selectedRows: (SourceRow | LoanMeta | undefined)[] = [source, ...loanMetas];
  const selectChain = {
    from: jest.fn(),
    where: jest.fn(),
    get: jest.fn(() => selectedRows.shift()),
  };
  selectChain.from.mockReturnValue(selectChain);
  selectChain.where.mockReturnValue(selectChain);

  const deleteRun = jest.fn();
  const deleteWhere = jest.fn(() => ({ run: deleteRun }));
  const updateRun = jest.fn();
  const updateWhere = jest.fn(() => ({ run: updateRun }));
  const updateSet = jest.fn((patch: Record<string, unknown>) => ({
    where: updateWhere,
    patch,
  }));
  const insertRun = jest.fn();
  const insertValues = jest.fn((values: Record<string, unknown>) => ({
    run: insertRun,
    values,
  }));

  const db = {
    select: jest.fn(() => selectChain),
    delete: jest.fn(() => ({ where: deleteWhere })),
    update: jest.fn(() => ({ set: updateSet })),
    insert: jest.fn(() => ({ values: insertValues })),
  };
  const touchRun = jest.fn();
  mockGetDb.mockReturnValue(db);
  mockGetSqlite.mockReturnValue({ runSync: touchRun });

  return {
    db,
    selectChain,
    deleteRun,
    updateRun,
    updateSet,
    insertRun,
    insertValues,
    touchRun,
  };
}

function expectNoWrites(state: ReturnType<typeof databaseFor>) {
  expect(state.deleteRun).not.toHaveBeenCalled();
  expect(state.updateRun).not.toHaveBeenCalled();
  expect(state.insertRun).not.toHaveBeenCalled();
  expect(state.touchRun).not.toHaveBeenCalled();
}

beforeEach(() => {
  mockGetDb.mockReset();
  mockGetSqlite.mockReset();
});

describe('splitTransactionAcrossLoans repository validation', () => {
  it('accepts positive partial slices and repeated loan parts', () => {
    const state = databaseFor(
      { source: 'axis', direction: 'in', paise: 10_000 },
      [
        { kind: 'lent', personId: 4 },
        { kind: 'lent', personId: 4 },
      ],
    );

    splitTransactionAcrossLoans(12, [
      { loanId: 7, part: 'repayment', paise: 6_000 },
      { loanId: 7, part: 'interest', paise: 1_000 },
    ]);

    expect(state.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        loanId: null,
        linkedImportId: null,
        personId: 4,
        transferRole: 'repaid_to_me',
      }),
    );
    expect(state.insertValues).toHaveBeenCalledTimes(2);
    expect(state.insertValues).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ txnId: 12, loanId: 7, part: 'repayment', paise: 6_000 }),
    );
    expect(state.insertValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ txnId: 12, loanId: 7, part: 'interest', paise: 1_000 }),
    );
  });

  it.each([0, -1, 1.5])('rejects a non-positive or non-integer slice (%s)', (paise) => {
    const state = databaseFor({ source: 'axis', direction: 'out', paise: 10_000 });

    expect(() =>
      splitTransactionAcrossLoans(12, [{ loanId: 7, part: 'principal', paise }]),
    ).toThrow('Every split allocation must have a valid part and a positive integer amount.');
    expectNoWrites(state);
  });

  it('rejects roles that move money in different directions', () => {
    const state = databaseFor(
      { source: 'manual', direction: 'in', paise: 10_000 },
      [
        { kind: 'lent', personId: 4 },
        { kind: 'lent', personId: 4 },
      ],
    );

    expect(() =>
      splitTransactionAcrossLoans(12, [
        { loanId: 7, part: 'principal', paise: 4_000 },
        { loanId: 7, part: 'repayment', paise: 4_000 },
      ]),
    ).toThrow('All split allocations must move money in the same direction.');
    expectNoWrites(state);
  });

  it('rejects allocations above the source transaction total', () => {
    const state = databaseFor({ source: 'axis', direction: 'in', paise: 10_000 });

    expect(() =>
      splitTransactionAcrossLoans(12, [
        { loanId: 7, part: 'repayment', paise: 8_000 },
        { loanId: 8, part: 'repayment', paise: 2_001 },
      ]),
    ).toThrow('Allocated total cannot exceed the source transaction.');
    expectNoWrites(state);
  });

  it('rejects an imported split that contradicts the statement direction', () => {
    const state = databaseFor(
      { source: 'axis', direction: 'out', paise: 10_000 },
      [{ kind: 'lent', personId: 4 }],
    );

    expect(() =>
      splitTransactionAcrossLoans(12, [
        { loanId: 7, part: 'repayment', paise: 8_000 },
      ]),
    ).toThrow('Split allocation direction must match the source transaction.');
    expectNoWrites(state);
  });

  it('keeps manual-source direction adjustment for a valid split', () => {
    const state = databaseFor(
      { source: 'manual', direction: 'in', paise: 10_000 },
      [{ kind: 'borrowed', personId: 9 }],
    );

    splitTransactionAcrossLoans(12, [
      { loanId: 8, part: 'repayment', paise: 7_000 },
    ]);

    expect(state.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'out', transferRole: 'repaid_by_me' }),
    );
    expect(state.insertRun).toHaveBeenCalledTimes(1);
  });
});

describe('lending and card-bill exclusivity', () => {
  it('clears a card-statement link when attaching one loan', () => {
    const state = databaseFor({ source: 'axis', direction: 'in', paise: 10_000 });
    state.selectChain.get
      .mockReset()
      .mockReturnValueOnce({ kind: 'lent', personId: 4 })
      .mockReturnValueOnce({ source: 'axis', direction: 'in', paise: 10_000 });

    attachTransactionToLoan(12, 7, 'repayment');

    expect(state.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        linkedImportId: null,
        loanId: 7,
        transferRole: 'repaid_to_me',
      }),
    );
  });
});
