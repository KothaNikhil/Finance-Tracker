import { fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { TransactionRow } from '@/core/db/schema';
import { AddToMoneyLentSheet, type AddToMoneyLentSheetProps } from '../add-to-money-lent-sheet';

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

const txn = {
  id: 44,
  paise: 10_000,
  direction: 'in',
  source: 'axis',
  isoDate: '2026-08-30',
  counterpartyName: 'Prathyusha',
  remarks: null,
  rawDetails: 'UPI transfer',
} as TransactionRow;

const props: AddToMoneyLentSheetProps = {
  visible: false,
  txn,
  loans: [{ id: 7, name: 'Wedding', personName: 'Prathyusha', kind: 'lent' }],
  people: [],
  onAddPerson: jest.fn(),
  onCreateLoan: jest.fn(),
  onAttach: jest.fn(),
  onSplit: jest.fn(),
  onDetach: jest.fn(),
  onClose: jest.fn(),
};

describe('AddToMoneyLentSheet direction guard', () => {
  it('blocks a split slice that contradicts the credit/debit of the transaction', async () => {
    const screen = await render(<AddToMoneyLentSheet {...props} />);
    await screen.rerender(<AddToMoneyLentSheet {...props} visible />);

    await fireEvent.press(screen.getByRole('tab', { name: 'Split across loans' }));
    await fireEvent.changeText(screen.getByLabelText('Amount for slice 1 in rupees'), '50');

    expect(screen.getByRole('button', { name: 'Save split' })).toHaveProp('accessibilityState', {
      disabled: false,
      busy: false,
    });

    await fireEvent.press(screen.getByRole('tab', { name: 'Paid' }));

    expect(screen.getByText('This is a credit (money in). Choose Received or Interest.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save split' })).toHaveProp('accessibilityState', {
      disabled: true,
      busy: false,
    });
  });

  it('offers Paid / Received / Interest and blocks Paid on a manual credit', async () => {
    const onAttach = jest.fn();
    const manual = { ...txn, source: 'manual', direction: 'out' } as TransactionRow;
    const loans: AddToMoneyLentSheetProps['loans'] = [
      { id: 8, name: 'Laptop', personName: 'Meera', kind: 'borrowed' },
    ];
    const screen = await render(
      <AddToMoneyLentSheet {...props} txn={manual} loans={loans} onAttach={onAttach} />,
    );
    await screen.rerender(
      <AddToMoneyLentSheet {...props} txn={manual} loans={loans} onAttach={onAttach} visible />,
    );

    await fireEvent.press(screen.getByRole('radio', { name: 'Meera · Laptop · borrowed' }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Received' }));
    expect(screen.getByText('This is a debit (money out). Choose Paid or Interest.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add to Money Lent' })).toHaveProp('accessibilityState', {
      disabled: true,
      busy: false,
    });

    await fireEvent.press(screen.getByRole('tab', { name: 'Paid' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add to Money Lent' }));
    // Paying money on a loan you borrowed is a repayment.
    expect(onAttach).toHaveBeenCalledWith(8, 'repayment');
  });

  it('allocates one transaction across several loans and allows a partial remainder', async () => {
    const onSplit = jest.fn();
    const loans: AddToMoneyLentSheetProps['loans'] = [
      { id: 7, name: 'Wedding', personName: 'Prathyusha', kind: 'lent' },
      { id: 9, name: 'Car', personName: 'Ravi', kind: 'lent' },
    ];
    const screen = await render(<AddToMoneyLentSheet {...props} loans={loans} onSplit={onSplit} />);
    await screen.rerender(
      <AddToMoneyLentSheet {...props} loans={loans} onSplit={onSplit} visible />,
    );

    await fireEvent.press(screen.getByRole('tab', { name: 'Split across loans' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Choose loan for slice 1' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Prathyusha · Wedding · lent' }));
    await fireEvent.changeText(screen.getByLabelText('Amount for slice 1 in rupees'), '50');

    await fireEvent.press(screen.getByRole('button', { name: 'Add slice' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Choose loan for slice 2' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Ravi · Car · lent' }));
    await fireEvent.changeText(screen.getByLabelText('Amount for slice 2 in rupees'), '30');

    expect(screen.getByText('₹20.00 left')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Save split' }));
    expect(onSplit).toHaveBeenCalledWith([
      { loanId: 7, part: 'repayment', paise: 5_000 },
      { loanId: 9, part: 'repayment', paise: 3_000 },
    ]);

    await fireEvent.press(screen.getByRole('button', { name: 'Remove slice 2' }));
    expect(screen.queryByLabelText('Amount for slice 2 in rupees')).toBeNull();
  });

  it('is content-sized so a single attach does not open a near-full-screen sheet', async () => {
    const screen = await render(<AddToMoneyLentSheet {...props} />);
    await screen.rerender(<AddToMoneyLentSheet {...props} visible />);

    const sheet = screen.getByTestId('bottom-sheet');
    expect(sheet.props.sheetClosable).toBe(true);
    expect(sheet.props.sheetHeightFraction).toBeUndefined();
  });
});
