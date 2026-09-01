import { fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import type { TransactionRow } from '@/core/db/schema';

import { TransactionDetail, type TransactionDetailProps } from '../transaction-detail';

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
      children: ReactNode;
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

const txn = (patch: Partial<TransactionRow> = {}): TransactionRow =>
  ({
    id: 501,
    isoDate: '2025-08-31',
    time: '18:29:40',
    paise: 200_000,
    direction: 'out',
    kind: 'paid',
    categoryId: 4,
    subcategoryId: null,
    paymentModeId: null,
    personId: null,
    counterpartyName: 'KOTHA NIKHITA',
    counterpartyVpa: null,
    accountName: null,
    originalDirection: null,
    transferRole: null,
    loanId: null,
    importId: null,
    linkedImportId: null,
    rawDetails: 'UPI transfer',
    rawTag: null,
    remarks: null,
    note: null,
    isRefund: false,
    source: 'paytm',
    sourceRef: null,
    orderId: null,
    dedupeKey: 'txn-501',
    autoCategorized: true,
    needsReview: false,
    createdAt: '2025-08-31T13:00:00.000Z',
    ...patch,
  }) as TransactionRow;

/** A hand-entered "Lent" row: no merchant, and `raw_details` at its NOT NULL DEFAULT ''. */
const lendingTxn = (patch: Partial<TransactionRow> = {}): TransactionRow =>
  txn({
    counterpartyName: null,
    rawDetails: '',
    categoryId: null,
    autoCategorized: false,
    source: 'manual',
    transferRole: 'lent',
    personId: 1,
    loanId: 1,
    ...patch,
  });

const handlers = () => ({
  onClose: jest.fn(),
  onChangeCategory: jest.fn(),
  onRemoveCategory: jest.fn(),
  onAccept: jest.fn(),
  onManageMoneyLent: jest.fn(),
  onManageCardBill: jest.fn(),
  onSaveNote: jest.fn(),
  onRecategorize: jest.fn(),
  onSetRefund: jest.fn(),
  onSetSelfTransfer: jest.fn(),
  onDelete: jest.fn(),
});

const baseProps: Omit<TransactionDetailProps, keyof ReturnType<typeof handlers> | 'txn'> = {
  visible: true,
  categoryLabel: '🏥 Medicine & Health',
  paymentModeName: null,
  personName: null,
  provenance: null,
  moneyLent: null,
  cardBillLinked: false,
  cardBillLabel: null,
  cardSpendCount: 0,
  cardBillSuggestion: null,
  hasCardStatements: false,
};

describe('TransactionDetail category row', () => {
  it('opens the picker from the row itself instead of a separate Change button', async () => {
    const actions = handlers();
    const screen = await render(<TransactionDetail {...baseProps} txn={txn()} {...actions} />);

    const row = screen.getByRole('button', { name: 'Category: 🏥 Medicine & Health' });
    expect(row).toHaveProp(
      'accessibilityHint',
      'Choose a category or create a new category or subcategory',
    );
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();

    await fireEvent.press(row);
    expect(actions.onChangeCategory).toHaveBeenCalledTimes(1);
    expect(actions.onRemoveCategory).not.toHaveBeenCalled();
    expect(actions.onRecategorize).not.toHaveBeenCalled();
  });

  it('fires Remove and Re-categorize without also opening the picker', async () => {
    const actions = handlers();
    const screen = await render(<TransactionDetail {...baseProps} txn={txn()} {...actions} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Remove category' }));
    expect(actions.onRemoveCategory).toHaveBeenCalledTimes(1);
    expect(actions.onChangeCategory).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Re-categorize' }));
    expect(actions.onRecategorize).toHaveBeenCalledTimes(1);
    expect(actions.onChangeCategory).not.toHaveBeenCalled();
  });

  it('accepts a review from Looks right without also opening the picker', async () => {
    const actions = handlers();
    const screen = await render(
      <TransactionDetail {...baseProps} txn={txn({ needsReview: true })} {...actions} />,
    );

    expect(screen.getByText('Needs review')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Looks right' }));
    expect(actions.onAccept).toHaveBeenCalledTimes(1);
    expect(actions.onChangeCategory).not.toHaveBeenCalled();
  });

  it('drops Remove when the transaction is uncategorized but keeps the row and re-categorize', async () => {
    const actions = handlers();
    const screen = await render(
      <TransactionDetail
        {...baseProps}
        categoryLabel={null}
        txn={txn({ categoryId: null, autoCategorized: false })}
        {...actions}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Remove category' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Re-categorize' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Category: Uncategorized' }));
    expect(actions.onChangeCategory).toHaveBeenCalledTimes(1);
  });
});

describe('TransactionDetail imported metadata', () => {
  it('keeps the Paytm tag out of Overview and shows it with the provenance fields', async () => {
    const actions = handlers();
    const screen = await render(
      <TransactionDetail
        {...baseProps}
        txn={txn({ rawTag: 'Medical', remarks: 'Powder' })}
        {...actions}
      />,
    );

    expect(screen.queryByText('Paytm tag')).toBeNull();
    expect(screen.queryByText('Medical')).toBeNull();
    expect(screen.getByText('Imported remarks')).toBeTruthy();
    expect(screen.getByText('Powder')).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: 'Details' }));

    expect(screen.getByText('Raw Paytm tag')).toBeTruthy();
    expect(screen.getByText('Medical')).toBeTruthy();
  });
});

const textStyle = (node: { props: { style?: StyleProp<TextStyle> } }): TextStyle =>
  StyleSheet.flatten(node.props.style) ?? {};

describe('TransactionDetail header hierarchy', () => {
  it('separates the header with size and colour, never weight', async () => {
    const actions = handlers();
    const screen = await render(<TransactionDetail {...baseProps} txn={txn()} {...actions} />);

    const title = textStyle(screen.getByText('KOTHA NIKHITA'));
    const amount = textStyle(screen.getByText('−₹2,000.00'));
    const meta = textStyle(screen.getByText('Money out · 31 Aug 2025 · 6:29 PM'));
    const sectionLabel = textStyle(screen.getByText('CATEGORY'));

    [title, amount, meta, sectionLabel].forEach((style) => {
      expect(Number(style.fontWeight)).toBeLessThanOrEqual(500);
    });

    expect(amount.fontSize).toBeGreaterThan(title.fontSize ?? 0);
    expect(title.fontSize).toBeGreaterThan(meta.fontSize ?? 0);
    expect(sectionLabel.fontSize).toBeLessThan(meta.fontSize ?? 0);

    expect(amount.color).toBe('#D14D47');
    expect(meta.color).toBe('#64726E');
    expect(title.color).toBe('#142321');
  });

  it('keeps the amount tabular so figures stay column-aligned', async () => {
    const actions = handlers();
    const screen = await render(<TransactionDetail {...baseProps} txn={txn()} {...actions} />);

    expect(textStyle(screen.getByText('−₹2,000.00')).fontVariant).toContain('tabular-nums');
  });
});

describe('TransactionDetail sheet height', () => {
  it('is content-sized so Overview is not padded out to a fraction of the screen', async () => {
    const actions = handlers();
    const screen = await render(<TransactionDetail {...baseProps} txn={txn()} {...actions} />);

    const sheet = screen.getByTestId('bottom-sheet');
    expect(sheet.props.sheetClosable).toBe(true);
    expect(sheet.props.sheetHeightFraction).toBeUndefined();
  });
});

describe('TransactionDetail header', () => {
  it('keeps the full amount beside a truncating merchant name, with one meta line below', async () => {
    const actions = handlers();
    const screen = await render(
      <TransactionDetail
        {...baseProps}
        txn={txn({ counterpartyName: 'KOTHA NIKHITA AND A VERY LONG MERCHANT NAME' })}
        {...actions}
      />,
    );

    const name = screen.getByText('KOTHA NIKHITA AND A VERY LONG MERCHANT NAME');
    expect(name).toHaveProp('numberOfLines', 1);

    const amount = screen.getByText('−₹2,000.00');
    expect(amount).toHaveProp('numberOfLines', 1);
    expect(amount).toHaveStyle({ flexShrink: 0 });

    expect(screen.getByText('Money out · 31 Aug 2025 · 6:29 PM')).toBeTruthy();
  });

  it('names an in-app lending row by the identity Activity shows, not the generic word', async () => {
    const actions = handlers();
    const screen = await render(
      <TransactionDetail
        {...baseProps}
        txn={lendingTxn()}
        lendingTitle="Shekhar"
        {...actions}
      />,
    );

    expect(screen.getByText('Shekhar')).toBeTruthy();
    expect(screen.queryByText('Transaction')).toBeNull();
  });

  it('still prefers the merchant of an imported row over any lending identity', async () => {
    const actions = handlers();
    const screen = await render(
      <TransactionDetail
        {...baseProps}
        txn={txn({ counterpartyName: 'Zomato', loanId: 1, personId: 1, transferRole: 'lent' })}
        lendingTitle="Shekhar"
        {...actions}
      />,
    );

    expect(screen.getByText('Zomato')).toBeTruthy();
    expect(screen.queryByText('Shekhar')).toBeNull();
  });

  it('keeps the generic fallback when a row has no name and no lending identity', async () => {
    const actions = handlers();
    const screen = await render(
      <TransactionDetail {...baseProps} txn={lendingTxn({ transferRole: null })} {...actions} />,
    );

    expect(screen.getByText('Transaction')).toBeTruthy();
  });
});
