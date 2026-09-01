import { fireEvent, render } from '@testing-library/react-native';

import { DateField } from '../date-field';

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

const open = async (screen: ReturnType<typeof render> extends Promise<infer R> ? R : any, label = 'Date') => {
  await fireEvent.press(screen.getByRole('button', { name: label }));
};

describe('DateField', () => {
  it('shows the value in a readable form and reports it to a screen reader', async () => {
    const screen = await render(
      <DateField label="Date" value="2026-09-01" onChange={jest.fn()} testID="date" />,
    );

    expect(screen.getByText('1 Sep 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Date' })).toHaveProp('accessibilityValue', {
      text: '1 September 2026',
    });
  });

  it('shows the placeholder and no clear affordance when unset', async () => {
    const screen = await render(
      <DateField label="Date" value={null} onChange={jest.fn()} clearable testID="date" />,
    );

    expect(screen.getByText('Choose a date')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear Date' })).toBeNull();
  });

  it('picks a day from the calendar and emits an ISO string', async () => {
    const onChange = jest.fn();
    const screen = await render(<DateField label="Date" value="2026-09-10" onChange={onChange} />);

    await open(screen);
    await fireEvent.press(screen.getByRole('button', { name: 'Thursday 3 September 2026' }));

    expect(onChange).toHaveBeenCalledWith('2026-09-03');
  });

  it('marks the current value selected and collapses the calendar after a pick', async () => {
    const screen = await render(<DateField label="Date" value="2026-09-10" onChange={jest.fn()} />);

    await open(screen);
    expect(screen.getByRole('button', { name: 'Thursday 10 September 2026' })).toHaveProp(
      'accessibilityState',
      { selected: true, disabled: false },
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Friday 4 September 2026' }));
    expect(screen.queryByRole('button', { name: 'Friday 4 September 2026' })).toBeNull();
  });

  it('clears the value through the clear affordance', async () => {
    const onChange = jest.fn();
    const screen = await render(
      <DateField label="Date" value="2026-09-01" onChange={onChange} clearable testID="date" />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Clear Date' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('disables days and month steps outside the allowed bounds', async () => {
    const onChange = jest.fn();
    const screen = await render(
      <DateField
        label="Date"
        value="2026-09-10"
        onChange={onChange}
        minimumDate={new Date(2026, 8, 5)}
        maximumDate={new Date(2026, 8, 20)}
      />,
    );

    await open(screen);

    expect(screen.getByRole('button', { name: 'Tuesday 1 September 2026' })).toHaveProp(
      'accessibilityState',
      { selected: false, disabled: true },
    );
    expect(screen.getByRole('button', { name: 'Monday 21 September 2026' })).toHaveProp(
      'accessibilityState',
      { selected: false, disabled: true },
    );
    expect(screen.getByRole('button', { name: 'Saturday 5 September 2026' })).toHaveProp(
      'accessibilityState',
      { selected: false, disabled: false },
    );

    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Tuesday 1 September 2026' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('steps between months and keeps leap years correct', async () => {
    const screen = await render(<DateField label="Date" value="2028-03-10" onChange={jest.fn()} />);

    await open(screen);
    await fireEvent.press(screen.getByRole('button', { name: 'Previous month' }));

    expect(screen.getByText('February 2028')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tuesday 29 February 2028' })).toBeTruthy();
  });

  it('does not open while disabled', async () => {
    const screen = await render(
      <DateField label="Date" value="2026-09-01" onChange={jest.fn()} disabled />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Date' }));
    expect(screen.queryByRole('button', { name: 'Next month' })).toBeNull();
  });

  it('reaches a year five back in three taps from the closed field', async () => {
    const onChange = jest.fn();
    const screen = await render(<DateField label="Date" value="2026-09-10" onChange={onChange} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Date' }));
    await fireEvent.press(screen.getByRole('button', { name: 'September 2026' }));
    await fireEvent.press(screen.getByRole('button', { name: '2021' }));

    expect(screen.getByText('September 2021')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thursday 9 September 2021' })).toBeTruthy();
  });

  it('pages years without walking through months, and marks the selected year', async () => {
    const screen = await render(<DateField label="Date" value="2026-09-10" onChange={jest.fn()} />);

    await open(screen);
    await fireEvent.press(screen.getByRole('button', { name: 'September 2026' }));

    expect(screen.getByRole('button', { name: '2026' })).toHaveProp('accessibilityState', {
      selected: true,
      disabled: false,
    });
    expect(screen.getByText('2016 – 2027')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Previous 12 years' }));
    expect(screen.getByText('2004 – 2015')).toBeTruthy();
    expect(screen.getByRole('button', { name: '2004' })).toBeTruthy();
  });

  it('never offers a year outside the allowed bounds', async () => {
    const screen = await render(
      <DateField
        label="Date"
        value="2026-09-10"
        onChange={jest.fn()}
        minimumDate={new Date(2025, 0, 1)}
        maximumDate={new Date(2027, 11, 31)}
      />,
    );

    await open(screen);
    await fireEvent.press(screen.getByRole('button', { name: 'September 2026' }));

    expect(screen.getByRole('button', { name: '2024' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '2025' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: '2027' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous 12 years' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next 12 years' })).toBeDisabled();
  });

  it('clamps to an in-range month when the chosen year starts outside the bounds', async () => {
    const screen = await render(
      <DateField
        label="Date"
        value="2026-09-10"
        onChange={jest.fn()}
        minimumDate={new Date(2026, 5, 1)}
      />,
    );

    await open(screen);
    await fireEvent.press(screen.getByRole('button', { name: 'September 2026' }));
    await fireEvent.press(screen.getByRole('button', { name: '2027' }));

    expect(screen.getByText('September 2027')).toBeTruthy();
  });

  it('keeps every day at a full touch target and no text below the readable floor', async () => {
    const screen = await render(<DateField label="Date" value="2026-09-10" onChange={jest.fn()} />);

    await open(screen);
    expect(screen.getByRole('button', { name: 'Thursday 3 September 2026' })).toHaveStyle({
      height: 44,
    });
  });
});
