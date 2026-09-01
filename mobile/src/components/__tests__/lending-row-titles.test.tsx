/**
 * A lending transaction added in the app has no merchant: `addLoanTransaction` never writes
 * `counterparty_name`, and `raw_details` is `NOT NULL DEFAULT ''`, so a `??` chain over the two
 * stops at the empty string. These cover the two places outside the Activity row that name such a
 * transaction — the category picker opened from the detail sheet, and the last-edited pill.
 */

import { render } from '@testing-library/react-native';

import { LastEditedPill } from '../last-edited-pill';
import { TransactionDetailController } from '../transaction-detail-controller';

interface LoanRef {
  id: number;
  name: string;
  personName: string;
}

const mockPickerTitles: (string | undefined)[] = [];
let mockTxn: Record<string, unknown> | null = null;
let mockAllocations: { loanId: number; part: string | null; paise: number }[] = [];
let mockLoans: LoanRef[] = [];
let mockPeople: { id: number; name: string }[] = [];

jest.mock('expo-symbols', () => ({
  SymbolView: () => null,
}));

jest.mock('@/components/category-picker', () => ({
  CategoryPicker: ({ title }: { title?: string }) => {
    mockPickerTitles.push(title);
    return null;
  },
}));

jest.mock('@/components/transaction-detail', () => ({ TransactionDetail: () => null }));
jest.mock('@/components/add-to-money-lent-sheet', () => ({ AddToMoneyLentSheet: () => null }));
jest.mock('@/components/card-bill-sheet', () => ({
  CardBillSheet: () => null,
  cardStatementLabel: () => 'Statement',
}));

jest.mock('@/services/db/database', () => ({ getDb: () => ({}) }));
jest.mock('@/services/db/queries/transactions', () => ({ txnByIdQuery: () => ({ tag: 'txn' }) }));
jest.mock('@/services/db/queries/lending', () => ({
  allocationsForTxnQuery: () => ({ tag: 'allocations' }),
}));
jest.mock('@/services/db/queries/cards', () => ({
  cardStatementByIdQuery: () => ({ tag: 'none' }),
  cardStatementItemsQuery: () => ({ tag: 'none' }),
  cardStatementsQuery: () => ({ tag: 'none' }),
  matchingCardStatementsQuery: () => ({ tag: 'none' }),
}));
jest.mock('@/services/db/repository', () => ({
  acceptTransactionReview: jest.fn(),
  addCategory: jest.fn(),
  addPerson: jest.fn(),
  addSubcategory: jest.fn(),
  attachTransactionToLoan: jest.fn(),
  clearTransactionCategory: jest.fn(),
  createLoan: jest.fn(),
  deleteTransaction: jest.fn(),
  detachTransactionFromLoan: jest.fn(),
  linkTxnToCardStatement: jest.fn(),
  recategorizeTransaction: jest.fn(),
  setTransactionCategory: jest.fn(),
  setTransactionNote: jest.fn(),
  setTransactionRefund: jest.fn(),
  setTransactionSelfTransfer: jest.fn(),
  splitTransactionAcrossLoans: jest.fn(),
  unlinkCardStatement: jest.fn(),
}));

jest.mock('@/hooks/use-live-query', () => ({
  useLiveQuery: (query: { tag: string }) => {
    if (query.tag === 'txn') return { data: mockTxn ? [mockTxn] : [] };
    if (query.tag === 'allocations') return { data: mockAllocations };
    return { data: [] };
  },
}));
jest.mock('@/hooks/use-lending', () => ({
  useLoans: () => ({
    active: [],
    byId: (id: number | null) => mockLoans.find((loan) => loan.id === id) ?? null,
  }),
}));
jest.mock('@/hooks/use-reference-data', () => ({
  useCategoryIndex: () => ({ categories: [], byId: new Map() }),
  useLists: () => ({ paymentModes: [], people: mockPeople }),
}));
jest.mock('@/hooks/use-transaction-detail', () => ({
  useTransactionDetail: () => ({
    // No sheet is open, so the pill is free to render its shortcut to the last-edited row.
    openId: null,
    lastEditedId: 77,
    openTxn: jest.fn(),
    openLast: jest.fn(),
    close: jest.fn(),
    noteEdited: jest.fn(),
    clearLastEdited: jest.fn(),
  }),
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({
    text: '#142321',
    textSecondary: '#64726E',
    background: '#F5F7F6',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E7EFEC',
    border: '#DDE5E2',
    borderStrong: '#C7D3CF',
    accent: '#0F766E',
    accentMuted: '#DFF1ED',
    onAccent: '#FFFFFF',
    spend: '#D14D47',
    spendMuted: '#FBE9E7',
    income: '#247B58',
    incomeMuted: '#E4F3EB',
    review: '#B66A00',
    reviewMuted: '#FFF2D8',
    onReview: '#2C1B00',
    overlay: 'rgba(8, 18, 16, 0.48)',
    shadow: '#0B1714',
    skeleton: '#DCE6E2',
    focus: '#0F766E',
  }),
}));

/** A hand-entered "Lent" row: no merchant, and `raw_details` at its NOT NULL DEFAULT ''. */
function lendingTxn(over: Record<string, unknown> = {}) {
  return {
    id: 77,
    isoDate: '2026-08-31',
    time: null,
    paise: 5_000_000,
    direction: 'out',
    kind: 'other',
    categoryId: null,
    subcategoryId: null,
    paymentModeId: null,
    personId: 1,
    counterpartyName: null,
    counterpartyVpa: null,
    accountName: null,
    originalDirection: null,
    transferRole: 'lent',
    loanId: 1,
    importId: null,
    linkedImportId: null,
    rawDetails: '',
    rawTag: null,
    remarks: null,
    note: null,
    isRefund: false,
    source: 'manual',
    sourceRef: null,
    orderId: null,
    dedupeKey: 'manual:77',
    autoCategorized: false,
    needsReview: false,
    createdAt: '2026-08-31T00:00:00.000Z',
    ...over,
  };
}

/** The title the controller handed the category picker on the most recent render. */
function lastPickerTitle(): string | undefined {
  return mockPickerTitles[mockPickerTitles.length - 1];
}

beforeEach(() => {
  mockPickerTitles.length = 0;
  mockTxn = null;
  mockAllocations = [];
  mockLoans = [
    { id: 1, name: 'Shekhar 10l', personName: 'Shekhar' },
    { id: 3, name: '', personName: 'Smr' },
  ];
  mockPeople = [
    { id: 1, name: 'Shekhar' },
    { id: 3, name: 'Smr' },
  ];
});

describe('the category picker opened from a transaction', () => {
  it('names an in-app lending row by its person rather than leaving the header blank', async () => {
    mockTxn = lendingTxn();
    await render(<TransactionDetailController />);

    expect(lastPickerTitle()).toBe('Shekhar');
  });

  it('summarises a split across two people, whose transaction keeps no person of its own', async () => {
    mockTxn = lendingTxn({ personId: null, loanId: null });
    mockAllocations = [
      { loanId: 1, part: 'repayment', paise: 3_000_000 },
      { loanId: 3, part: 'repayment', paise: 2_000_000 },
    ];
    await render(<TransactionDetailController />);

    expect(lastPickerTitle()).toBe('Split across 2 loans');
  });

  it('names a two-slice split on one loan by the person behind it', async () => {
    mockTxn = lendingTxn({ personId: null, loanId: null });
    mockAllocations = [
      { loanId: 1, part: 'repayment', paise: 3_000_000 },
      { loanId: 1, part: 'interest', paise: 200_000 },
    ];
    await render(<TransactionDetailController />);

    expect(lastPickerTitle()).toBe('Shekhar');
  });

  it('falls back to the role when a lending row has nothing identifying', async () => {
    mockTxn = lendingTxn({ personId: null, loanId: null });
    await render(<TransactionDetailController />);

    expect(lastPickerTitle()).toBe('💸 Lent');
  });

  it('still prefers the merchant of an imported row', async () => {
    mockTxn = lendingTxn({
      counterpartyName: 'Zomato',
      rawDetails: 'UPI/ZOMATO/1234',
      transferRole: null,
      loanId: null,
      personId: null,
    });
    await render(<TransactionDetailController />);

    expect(lastPickerTitle()).toBe('Zomato');
  });

  it('falls back to a generic label rather than blank when a row has no text at all', async () => {
    mockTxn = lendingTxn({ transferRole: null, loanId: null, personId: null });
    await render(<TransactionDetailController />);

    expect(lastPickerTitle()).toBe('Transaction');
  });
});

describe('the last-edited pill', () => {
  it('names an in-app lending row by its person rather than showing a blank line', async () => {
    mockTxn = lendingTxn();
    const screen = await render(<LastEditedPill />);

    expect(screen.getByText('Shekhar')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Reopen last edited transaction: Shekhar' }),
    ).toBeTruthy();
  });

  it('falls back to the role when a lending row has no person', async () => {
    mockTxn = lendingTxn({ personId: null, loanId: null });
    const screen = await render(<LastEditedPill />);

    expect(screen.getByText('💸 Lent')).toBeTruthy();
  });

  it('still prefers the merchant of an imported row', async () => {
    mockTxn = lendingTxn({ counterpartyName: 'Zomato', transferRole: null, loanId: null });
    const screen = await render(<LastEditedPill />);

    expect(screen.getByText('Zomato')).toBeTruthy();
  });
});
