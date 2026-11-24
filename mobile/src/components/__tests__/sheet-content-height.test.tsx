import { fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { DEFAULT_HOME_PERIOD_MODE } from '../home-period-selector';
import { LoanFormModal } from '../loan-form-modal';
import { LoanTxnForm } from '../loan-txn-form';

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

describe('Lending sheets are sized to their content', () => {
  it('opens the loan form at its content height, not a fraction of the screen', async () => {
    const screen = await render(
      <LoanFormModal
        visible
        mode="create"
        people={[{ id: 1, name: 'Prathyusha' }]}
        onAddPerson={jest.fn()}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    const sheet = screen.getByTestId('bottom-sheet');
    expect(sheet.props.sheetClosable).toBe(true);
    expect(sheet.props.sheetHeightFraction).toBeUndefined();
  });

  it('opens the manual entry form at its content height and picks its date', async () => {
    const screen = await render(<LoanTxnForm visible onSubmit={jest.fn()} onClose={jest.fn()} />);

    const sheet = screen.getByTestId('bottom-sheet');
    expect(sheet.props.sheetClosable).toBe(true);
    expect(sheet.props.sheetHeightFraction).toBeUndefined();

    expect(screen.getByRole('button', { name: 'Date' })).toBeTruthy();
    expect(screen.queryByPlaceholderText('YYYY-MM-DD')).toBeNull();
  });
});

describe('Editing a hand-entered loan entry', () => {
  it('seeds every field from the entry and offers removal', async () => {
    const onSubmit = jest.fn();
    const onDelete = jest.fn();
    const screen = await render(
      <LoanTxnForm
        visible
        mode="edit"
        initial={{ part: 'repayment', paise: 75_050, isoDate: '2026-08-14', remarks: 'Cash back' }}
        loanKind="lent"
        onSubmit={onSubmit}
        onDelete={onDelete}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('Edit entry')).toBeTruthy();
    expect(screen.getByLabelText('Entry amount in rupees')).toHaveProp('value', '750.50');
    expect(screen.getByText('14 Aug 2026')).toBeTruthy();
    expect(screen.getByDisplayValue('Cash back')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Received' })).toHaveProp('accessibilityState', {
      selected: true,
      disabled: false,
    });
    expect(screen.getByRole('button', { name: 'Delete entry' })).toBeTruthy();
  });

  it('submits the corrected values and keeps creation validation on edit', async () => {
    const onSubmit = jest.fn();
    const screen = await render(
      <LoanTxnForm
        visible
        mode="edit"
        initial={{ part: 'repayment', paise: 75_050, isoDate: '2026-08-14', remarks: null }}
        onSubmit={onSubmit}
        onDelete={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    await fireEvent.changeText(screen.getByLabelText('Entry amount in rupees'), '900');
    await fireEvent.press(screen.getByRole('button', { name: 'Interest' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSubmit).toHaveBeenCalledWith({
      part: 'interest',
      paise: 90_000,
      isoDate: '2026-08-14',
      remarks: null,
    });
  });

  it('offers no delete when creating', async () => {
    const screen = await render(<LoanTxnForm visible onSubmit={jest.fn()} onClose={jest.fn()} />);

    expect(screen.getByText('Add manual entry')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete entry' })).toBeNull();
  });
});

describe('Home period default', () => {
  it('opens on the whole year', () => {
    expect(DEFAULT_HOME_PERIOD_MODE).toBe('year');
  });
});
