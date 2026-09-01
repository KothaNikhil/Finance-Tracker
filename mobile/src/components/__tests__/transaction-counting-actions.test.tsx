import { fireEvent, render } from '@testing-library/react-native';

import {
  COUNTING_CHIP_LAYOUT,
  TransactionCountingActions,
  countingChipRowWidth,
  visibleCountingActions,
} from '../transaction-counting-actions';

const COMMON_ACTIONS = ['Self-transfer', 'Money Lent', 'Card bill'] as const;

// Rendered label widths in dp, measured with GDI+ at 13px bold using Arial as a slightly wider
// stand-in for Roboto, then cross-checked against a device screenshot.
const LABEL_WIDTH: Record<string, number> = {
  'Self-transfer': 76.6,
  Refund: 44.8,
  'Money Lent': 72.2,
  'Card bill': 52.0,
};

// The sheet insets its content by 12dp a side: a 320dp screen leaves 296dp, a 360dp one 336dp and
// the reviewed 412dp device 388dp.
const NARROW_CONTENT_WIDTH = 296;
const MAINSTREAM_CONTENT_WIDTH = 336;
const WIDE_CONTENT_WIDTH = 388;

jest.mock('expo-symbols', () => ({
  SymbolView: () => null,
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

const callbacks = () => ({
  onSetSelfTransfer: jest.fn(),
  onSetRefund: jest.fn(),
  onManageMoneyLent: jest.fn(),
  onManageCardBill: jest.fn(),
});

describe('transaction counting controls', () => {
  it('implements the exact conditional action matrix', () => {
    expect(
      visibleCountingActions({
        direction: 'out',
        cardBillLinked: false,
        hasCardStatements: false,
      }),
    ).toEqual(['self', 'moneyLent']);

    expect(
      visibleCountingActions({
        direction: 'out',
        cardBillLinked: false,
        hasCardStatements: true,
      }),
    ).toEqual(['self', 'moneyLent', 'cardBill']);

    expect(
      visibleCountingActions({
        direction: 'in',
        cardBillLinked: false,
        hasCardStatements: true,
      }),
    ).toEqual(['self', 'refund', 'moneyLent']);

    expect(
      visibleCountingActions({
        direction: 'self',
        cardBillLinked: true,
        hasCardStatements: false,
      }),
    ).toEqual(['self', 'moneyLent', 'cardBill']);
  });

  it('toggles self-transfer and refund from eligible states', async () => {
    const outgoingCallbacks = callbacks();
    const outgoing = await render(
      <TransactionCountingActions
        direction="out"
        isRefund={false}
        moneyLent={null}
        cardBillLinked={false}
        cardBillLabel={null}
        cardBillSuggestion={null}
        hasCardStatements={false}
        {...outgoingCallbacks}
      />,
    );

    await fireEvent.press(outgoing.getByRole('button', { name: 'Self-transfer' }));
    expect(outgoingCallbacks.onSetSelfTransfer).toHaveBeenCalledWith(true);
    expect(outgoing.queryByRole('button', { name: 'Refund' })).toBeNull();
    expect(outgoing.queryByRole('button', { name: 'Card bill' })).toBeNull();

    const incomingCallbacks = callbacks();
    await outgoing.rerender(
      <TransactionCountingActions
        direction="in"
        isRefund
        moneyLent={null}
        cardBillLinked={false}
        cardBillLabel={null}
        cardBillSuggestion={null}
        hasCardStatements
        {...incomingCallbacks}
      />,
    );

    const refund = outgoing.getByRole('button', { name: 'Refund' });
    expect(refund).toHaveProp('accessibilityState', { selected: true });
    await fireEvent.press(refund);
    expect(incomingCallbacks.onSetRefund).toHaveBeenCalledWith(false);
    expect(outgoing.getByText('Offsets spending')).toBeTruthy();
    expect(outgoing.queryByRole('button', { name: 'Card bill' })).toBeNull();
  });

  it('explains every selected exclusion and reopens both managers', async () => {
    const actions = callbacks();
    const screen = await render(
      <TransactionCountingActions
        direction="self"
        isRefund={false}
        moneyLent={{
          label: 'Split across 2 loans · 3 slices',
          detailLines: ['Wedding · Repayment ₹6,000'],
          excluded: true,
          countablePaise: 0,
        }}
        cardBillLinked
        cardBillLabel="Axis Credit Card · Aug 2026"
        cardBillSuggestion={null}
        hasCardStatements={false}
        {...actions}
      />,
    );

    expect(screen.getByText('Excluded from spent, received and net spent')).toBeTruthy();
    expect(screen.getByText('Split across 2 loans · 3 slices')).toBeTruthy();
    expect(
      screen.getByText(
        'This transaction is loan principal or repayment, so it is excluded from normal spending and income.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('This bill-payment leg is excluded; the card purchases remain expenses.'),
    ).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: /Manage Money Lent/ }));
    await fireEvent.press(screen.getByRole('button', { name: /Open linked card bill/ }));
    expect(actions.onManageMoneyLent).toHaveBeenCalledTimes(1);
    expect(actions.onManageCardBill).toHaveBeenCalledTimes(1);
  });

  it('keeps the compact chips selectable and the card-bill suggestion reachable', async () => {
    const actions = callbacks();
    const screen = await render(
      <TransactionCountingActions
        direction="out"
        isRefund={false}
        moneyLent={null}
        cardBillLinked={false}
        cardBillLabel={null}
        cardBillSuggestion="Axis Credit Card · Aug 2026"
        hasCardStatements
        {...actions}
      />,
    );

    expect(screen.getByRole('button', { name: 'Self-transfer' })).toHaveProp('accessibilityState', {
      selected: false,
    });
    expect(screen.getByRole('button', { name: 'Card bill' })).toHaveProp('accessibilityState', {
      selected: false,
    });
    expect(
      screen.getByText('The statement due matches this payment amount. Review before linking.'),
    ).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: /Review suggested card statement/ }));
    expect(actions.onManageCardBill).toHaveBeenCalledTimes(1);
  });

  it('grows every chip to fill the row without ever squeezing a label', async () => {
    const screen = await render(
      <TransactionCountingActions
        direction="out"
        isRefund={false}
        moneyLent={null}
        cardBillLinked={false}
        cardBillLabel={null}
        cardBillSuggestion={null}
        hasCardStatements
        {...callbacks()}
      />,
    );

    const row = screen.getByLabelText('How this transaction is counted');
    expect(row).toHaveProp('accessibilityRole', 'toolbar');
    expect(row).toHaveStyle({ flexDirection: 'row' });
    expect(row).not.toHaveStyle({ justifyContent: 'space-between' });

    COMMON_ACTIONS.forEach((label) => {
      const chip = screen.getByRole('button', { name: label });
      expect(screen.getByText(label)).toBeTruthy();
      expect(chip).toHaveStyle({ flexGrow: 1, flexShrink: 0 });
      expect(chip).not.toHaveStyle({ flexBasis: 128 });
      expect(chip).toHaveStyle({ minHeight: COUNTING_CHIP_LAYOUT.height });
      expect(chip).toHaveProp('hitSlop', COUNTING_CHIP_LAYOUT.hitSlop);
    });
  });

  it('fills a two-chip row the same way, with no count-specific distribution', async () => {
    const screen = await render(
      <TransactionCountingActions
        direction="out"
        isRefund={false}
        moneyLent={null}
        cardBillLinked={false}
        cardBillLabel={null}
        cardBillSuggestion={null}
        hasCardStatements={false}
        {...callbacks()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Card bill' })).toBeNull();
    expect(screen.getByLabelText('How this transaction is counted')).not.toHaveStyle({
      justifyContent: 'space-between',
    });
    ['Self-transfer', 'Money Lent'].forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toHaveStyle({
        flexGrow: 1,
        flexShrink: 0,
      });
    });
  });

  it('keeps every chip at a 44dp effective touch target from a 30dp box', () => {
    const { height, hitSlop } = COUNTING_CHIP_LAYOUT;
    expect(height + hitSlop.top + hitSlop.bottom).toBeGreaterThanOrEqual(44);
  });

  it('holds the common three actions on one row down to a 320dp-wide screen', () => {
    const widths = COMMON_ACTIONS.map((label) => LABEL_WIDTH[label]);
    expect(countingChipRowWidth(widths)).toBeLessThanOrEqual(NARROW_CONTENT_WIDTH);
    expect(countingChipRowWidth(widths, [true, false, false])).toBeLessThanOrEqual(
      MAINSTREAM_CONTENT_WIDTH,
    );
    expect(countingChipRowWidth(widths)).toBeLessThan(MAINSTREAM_CONTENT_WIDTH);
  });

  it('keeps four actions to one row on a wide device and wraps them only below that', () => {
    const four = [
      LABEL_WIDTH['Self-transfer'],
      LABEL_WIDTH.Refund,
      LABEL_WIDTH['Money Lent'],
      LABEL_WIDTH['Card bill'],
    ];
    expect(countingChipRowWidth(four)).toBeLessThanOrEqual(WIDE_CONTENT_WIDTH);
    expect(countingChipRowWidth(four)).toBeGreaterThan(MAINSTREAM_CONTENT_WIDTH);
  });
});
