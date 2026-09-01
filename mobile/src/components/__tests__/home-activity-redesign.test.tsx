import { fireEvent, render } from '@testing-library/react-native';

import { ActivityFilterBar } from '../activity-filter-bar';
import { ActivitySummary, ACTIVITY_TOTALS_NOTE } from '../activity-summary';
import { HomePeriodSelector } from '../home-period-selector';
import { lendingRowLabel } from '../lending-row-label';
import { dayLabel } from '../transaction-list';
import { formatTime, TxnRow } from '../txn-row';

jest.mock('expo-symbols', () => ({
  SymbolView: () => null,
}));

jest.mock('@shopify/flash-list', () => ({
  FlashList: () => null,
}));

jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => 'light',
}));

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

describe('Home and Activity redesign controls', () => {
  it('switches Home period modes and exposes bounded navigation', async () => {
    const onModeChange = jest.fn();
    const onPrevious = jest.fn();
    const onNext = jest.fn();
    const screen = await render(
      <HomePeriodSelector
        mode="month"
        label="August 2026"
        canGoPrevious
        canGoNext={false}
        onPrevious={onPrevious}
        onNext={onNext}
        onModeChange={onModeChange}
      />,
    );

    expect(screen.getByLabelText('Selected period: August 2026')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Year' }));
    expect(onModeChange).toHaveBeenCalledWith('year');

    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Next month' })).toHaveProp('accessibilityState', {
      disabled: true,
      selected: false,
    });
  });

  it('opens filters and removes individual Activity chips', async () => {
    const onOpenFilters = jest.fn();
    const onClearAll = jest.fn();
    const clearPeriod = jest.fn();
    const screen = await render(
      <ActivityFilterBar
        chips={[{ key: 'period', label: 'August 2026', clear: clearPeriod }]}
        onOpenFilters={onOpenFilters}
        onClearAll={onClearAll}
        showClearAll
      />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Remove August 2026 filter' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Clear all' }));

    expect(onOpenFilters).toHaveBeenCalledTimes(1);
    expect(clearPeriod).toHaveBeenCalledTimes(1);
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('summarises Activity without repeating the transaction count from the list heading', async () => {
    const screen = await render(
      <ActivitySummary loading={false} spentPaise={271463451} receivedPaise={339366002} />,
    );

    expect(screen.getByText('Spent')).toBeTruthy();
    expect(screen.getByText('Received')).toBeTruthy();
    expect(screen.queryByText('Transactions')).toBeNull();

    expect(screen.queryByText(ACTIVITY_TOTALS_NOTE)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'How Activity totals are counted' }));
    expect(screen.getByText(ACTIVITY_TOTALS_NOTE)).toBeTruthy();
  });

  it('labels day groups and statement times without timezone conversion', () => {
    const now = new Date(2026, 7, 31, 18, 0, 0);
    expect(dayLabel('2026-08-31', now)).toBe('Today · 31 Aug');
    expect(dayLabel('2026-08-30', now)).toBe('Yesterday · 30 Aug');
    expect(formatTime('13:05:00')).toBe('1:05 PM');
    expect(formatTime('25:99:00')).toBeNull();
  });

  it('keeps self-transfers visually and semantically distinct in dense rows', async () => {
    const onPress = jest.fn();
    const txn = {
      id: 42,
      isoDate: '2026-08-31',
      time: '13:05:00',
      paise: 500000,
      direction: 'self',
      kind: 'self',
      categoryId: null,
      subcategoryId: null,
      paymentModeId: null,
      personId: null,
      counterpartyName: 'Own account',
      counterpartyVpa: null,
      accountName: 'Axis Bank',
      originalDirection: null,
      transferRole: null,
      loanId: null,
      importId: 1,
      linkedImportId: null,
      rawDetails: 'Transfer',
      rawTag: null,
      remarks: null,
      note: null,
      isRefund: false,
      source: 'axis',
      sourceRef: null,
      orderId: null,
      dedupeKey: 'self-42',
      autoCategorized: false,
      needsReview: false,
      createdAt: '2026-08-31T13:05:00.000Z',
    } as const;

    const screen = await render(
      <TxnRow txn={txn} categoryLabel={null} onPress={onPress} variant="activity" />,
    );
    const row = screen.getByRole('button', { name: /Own account.*Transfer/ });
    await fireEvent.press(row);

    expect(onPress).toHaveBeenCalledWith(42);
    expect(screen.getByText('⇄')).toBeTruthy();
  });

  it('identifies every lending shape from the loan data it actually has', () => {
    const shekhar = { id: 1, name: 'Shekhar 10l', personName: 'Shekhar' };
    const wedding = { id: 2, name: 'Wedding', personName: 'Shekhar' };
    const smr = { id: 3, name: '', personName: 'Smr' };

    expect(
      lendingRowLabel({ transferRole: 'lent' }, { personName: 'Shekhar', loan: shekhar, splitLoans: [] }),
    ).toEqual({ title: 'Shekhar', detail: 'Shekhar 10l' });

    expect(
      lendingRowLabel({ transferRole: 'repaid_to_me' }, { personName: 'Smr', loan: smr, splitLoans: [] }),
    ).toEqual({ title: 'Smr', detail: null });

    expect(
      lendingRowLabel({ transferRole: 'borrowed' }, { personName: null, loan: wedding, splitLoans: [] }),
    ).toEqual({ title: 'Wedding', detail: null });

    expect(
      lendingRowLabel({ transferRole: 'repaid_by_me' }, { personName: 'Smr', loan: smr, splitLoans: [] }),
    ).toEqual({ title: 'Smr', detail: null });

    expect(
      lendingRowLabel({ transferRole: 'interest_received' }, { personName: 'Shekhar', loan: shekhar, splitLoans: [] }),
    ).toEqual({ title: 'Shekhar', detail: 'Shekhar 10l' });

    // Split across one person's two loans: the repository keeps person_id, so the person still names it.
    expect(
      lendingRowLabel({ transferRole: 'lent' }, { personName: 'Shekhar', loan: null, splitLoans: [shekhar, wedding] }),
    ).toEqual({ title: 'Shekhar', detail: 'Split across 2 loans' });

    // Split across two people: person_id is cleared, so the split itself is the identity.
    expect(
      lendingRowLabel({ transferRole: 'lent' }, { personName: null, loan: null, splitLoans: [shekhar, smr] }),
    ).toEqual({ title: 'Split across 2 loans', detail: null });

    // Two slices on ONE loan is one loan, however many times the caller lists it.
    expect(
      lendingRowLabel({ transferRole: 'lent' }, { personName: 'Shekhar', loan: null, splitLoans: [shekhar, shekhar] }),
    ).toEqual({ title: 'Shekhar', detail: 'Shekhar 10l' });
    expect(
      lendingRowLabel({ transferRole: 'lent' }, { personName: null, loan: null, splitLoans: [smr, smr] }),
    ).toEqual({ title: 'Smr', detail: null });

    // Nothing identifying, and non-lending rows, fall back to the caller.
    expect(
      lendingRowLabel({ transferRole: 'lent' }, { personName: null, loan: null, splitLoans: [] }),
    ).toBeNull();
    expect(
      lendingRowLabel({ transferRole: null }, { personName: 'Shekhar', loan: shekhar, splitLoans: [] }),
    ).toBeNull();
  });

  it('gives an in-app lending row a summary line and a real glyph', async () => {
    const txn = lendingTxn();
    const screen = await render(
      <TxnRow
        txn={txn}
        categoryLabel={null}
        lendingTitle="Shekhar"
        lendingDetail="Shekhar 10l"
        onPress={jest.fn()}
        variant="activity"
      />,
    );

    expect(screen.getByText('Shekhar')).toBeTruthy();
    expect(screen.getByText('💸 Lent · Shekhar 10l')).toBeTruthy();
    expect(screen.getByText('💸')).toBeTruthy();
    expect(screen.queryByText('•')).toBeNull();
    expect(
      screen.getByRole('button', { name: /^Shekhar, −₹50,000\.00, 💸 Lent · Shekhar 10l/ }),
    ).toBeTruthy();
  });

  it('falls back to the role when a lending row has nothing identifying', async () => {
    const screen = await render(
      <TxnRow
        txn={lendingTxn()}
        categoryLabel={null}
        onPress={jest.fn()}
        variant="activity"
      />,
    );

    expect(screen.getByText('💸 Lent')).toBeTruthy();
    expect(screen.getByText('Uncategorized')).toBeTruthy();
    expect(screen.queryByText('•')).toBeNull();
  });

  it('names a split-across-loans row without inventing a loan', async () => {
    const screen = await render(
      <TxnRow
        txn={{ ...lendingTxn(), loanId: null, personId: null }}
        categoryLabel={null}
        lendingTitle="Split across 2 loans"
        onPress={jest.fn()}
        variant="activity"
      />,
    );

    expect(screen.getByText('Split across 2 loans')).toBeTruthy();
    expect(screen.getByText('💸 Lent')).toBeTruthy();
  });
});

/** A hand-entered "Lent" row: no merchant, and `raw_details` at its NOT NULL DEFAULT ''. */
function lendingTxn() {
  return {
    id: 77,
    isoDate: '2026-08-31',
    time: null,
    paise: 5000000,
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
  } as const;
}
