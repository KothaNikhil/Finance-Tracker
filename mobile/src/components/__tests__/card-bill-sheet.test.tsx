import { fireEvent, render } from '@testing-library/react-native';

import type { ImportRow, TransactionRow } from '@/core/db/schema';

import { CardBillSheet } from '../card-bill-sheet';

jest.mock('expo-symbols', () => ({
  SymbolView: () => null,
}));

jest.mock('@/components/bottom-sheet', () => {
  const { View: MockView } = jest.requireActual('react-native');
  return {
    BottomSheet: ({
      visible,
      children,
      heightFraction,
      onClose,
    }: {
      visible: boolean;
      children: React.ReactNode;
      heightFraction?: number;
      onClose: () => void;
    }) =>
      visible ? (
        <MockView
          testID="bottom-sheet"
          sheetHeightFraction={heightFraction}
          sheetClosable={typeof onClose === 'function'}
        >
          {children}
        </MockView>
      ) : null,
  };
});

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

const statement = (patch: Partial<ImportRow> = {}): ImportRow => ({
  id: 11,
  sourceLabel: 'Axis Credit Card.pdf',
  batchKey: null,
  importedAt: '2026-08-31T10:00:00.000Z',
  addedCount: 3,
  updatedCount: 0,
  cardLast4: '4821',
  statementMonth: '2026-08',
  totalDuePaise: 1_842_000,
  ...patch,
});

const item = (patch: Partial<TransactionRow>): TransactionRow =>
  ({
    id: 1,
    isoDate: '2026-08-20',
    time: null,
    paise: 459_900,
    direction: 'out',
    kind: 'paid',
    categoryId: null,
    subcategoryId: null,
    paymentModeId: null,
    personId: null,
    counterpartyName: 'Amazon Marketplace',
    counterpartyVpa: null,
    accountName: null,
    originalDirection: null,
    transferRole: null,
    loanId: null,
    importId: 11,
    linkedImportId: null,
    rawDetails: 'Amazon Marketplace',
    rawTag: null,
    remarks: null,
    note: null,
    isRefund: false,
    source: 'cc',
    sourceRef: null,
    orderId: null,
    dedupeKey: 'item-1',
    autoCategorized: true,
    needsReview: false,
    createdAt: '2026-08-31T10:00:00.000Z',
    ...patch,
  }) as TransactionRow;

describe('CardBillSheet', () => {
  it('shows due-versus-payment reconciliation and drillable purchases/refunds', async () => {
    const onPressSpend = jest.fn();
    const onUnlink = jest.fn();
    const screen = await render(
      <CardBillSheet
        visible
        linkedImportId={11}
        linkedStatement={statement()}
        items={[
          item({ id: 1 }),
          item({
            id: 2,
            direction: 'in',
            kind: 'refund',
            isRefund: true,
            paise: 123_000,
            counterpartyName: 'Amazon refund',
          }),
          item({
            id: 3,
            direction: 'in',
            kind: 'billpay',
            transferRole: 'cc_payment_received',
            counterpartyName: 'Payment received',
          }),
        ]}
        statements={[statement()]}
        suggestedIds={[11]}
        paymentPaise={1_842_000}
        onLink={jest.fn()}
        onUnlink={onUnlink}
        onPressSpend={onPressSpend}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('Payment matches statement due')).toBeTruthy();
    expect(screen.getByText(/1 purchase · 1 refund · Itemised net/)).toBeTruthy();
    expect(screen.getByText('Amazon Marketplace')).toBeTruthy();
    expect(screen.getByText('Amazon refund')).toBeTruthy();
    expect(screen.queryByText('Payment received')).toBeNull();
    expect(
      screen.getByText(
        /The linked bill-payment leg is excluded from spending and income/,
      ),
    ).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: /Open purchase Amazon Marketplace/ }));
    expect(onPressSpend).toHaveBeenCalledWith(1);

    await fireEvent.press(screen.getByRole('button', { name: 'Unlink this statement' }));
    expect(onUnlink).toHaveBeenCalledTimes(1);
  });

  it('keeps suggestions and every other statement linkable', async () => {
    const onLink = jest.fn();
    const suggested = statement();
    const other = statement({
      id: 12,
      sourceLabel: 'Backup Card.xlsx',
      cardLast4: '9012',
      statementMonth: '2026-07',
      totalDuePaise: 900_000,
    });
    const screen = await render(
      <CardBillSheet
        visible
        linkedImportId={null}
        linkedStatement={null}
        items={[]}
        statements={[suggested, other]}
        suggestedIds={[suggested.id]}
        paymentPaise={1_842_000}
        onLink={onLink}
        onUnlink={jest.fn()}
        onPressSpend={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('SUGGESTED AMOUNT MATCHES')).toBeTruthy();
    expect(screen.getByText('ALL OTHER STATEMENTS')).toBeTruthy();
    expect(screen.getByText(/Axis Credit Card · ••4821 · Aug 2026/)).toBeTruthy();
    expect(screen.getByText(/Backup Card · ••9012 · Jul 2026/)).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: /Link Axis Credit Card/ }));
    expect(onLink).toHaveBeenCalledWith(11);
  });

  it('is content-sized rather than pinned to a fraction of the screen', async () => {
    const screen = await render(
      <CardBillSheet
        visible
        linkedImportId={null}
        linkedStatement={null}
        items={[]}
        statements={[statement()]}
        suggestedIds={[]}
        paymentPaise={1_842_000}
        onLink={jest.fn()}
        onUnlink={jest.fn()}
        onPressSpend={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    const sheet = screen.getByTestId('bottom-sheet');
    expect(sheet.props.sheetClosable).toBe(true);
    expect(sheet.props.sheetHeightFraction).toBeUndefined();
  });
});
