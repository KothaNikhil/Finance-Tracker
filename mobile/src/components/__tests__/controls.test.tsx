import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Button } from '../button';
import { Card } from '../card';
import { Chip } from '../chip';
import { InfoDisclosure } from '../info-disclosure';
import { SegmentedControl } from '../segmented-control';

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

describe('foundation controls', () => {
  it('runs button actions and exposes disabled state', async () => {
    const onPress = jest.fn();
    const screen = await render(<Button label="Save" onPress={onPress} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(onPress).toHaveBeenCalledTimes(1);

    await screen.rerender(<Button label="Save" onPress={onPress} disabled />);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProp('accessibilityState', {
      disabled: true,
      busy: false,
    });
  });

  it('announces chip selection and handles presses', async () => {
    const onPress = jest.fn();
    const screen = await render(<Chip label="August 2026" selected onPress={onPress} />);
    const chip = screen.getByRole('button', { name: 'August 2026' });

    expect(chip).toHaveProp('accessibilityState', { selected: true, disabled: false });
    await fireEvent.press(chip);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('changes the selected segment', async () => {
    const onChange = jest.fn();
    const screen = await render(
      <SegmentedControl
        accessibilityLabel="Period"
        options={[
          { value: 'month', label: 'Month' },
          { value: 'year', label: 'Year' },
        ]}
        value="month"
        onChange={onChange}
      />,
    );

    await fireEvent.press(screen.getByRole('tab', { name: 'Year' }));
    expect(onChange).toHaveBeenCalledWith('year');
  });

  it('supports accessible actionable cards', async () => {
    const onPress = jest.fn();
    const screen = await render(
      <Card onPress={onPress} accessibilityLabel="Open summary">
        <Text>Summary</Text>
      </Card>,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Open summary' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps disclosure copy behind a labelled button and toggles it', async () => {
    const note = 'Self-transfers, lending principal, and linked card payments are excluded.';
    const screen = await render(
      <InfoDisclosure label="How Activity totals are counted" text={note}>
        <Text>Spent</Text>
      </InfoDisclosure>,
    );

    expect(screen.getByText('Spent')).toBeTruthy();
    expect(screen.queryByText(note)).toBeNull();

    const button = screen.getByRole('button', { name: 'How Activity totals are counted' });
    expect(button).toHaveProp('accessibilityState', {
      disabled: false,
      selected: false,
      expanded: false,
    });

    await fireEvent.press(button);
    const revealed = screen.getByText(note);
    expect(revealed).toHaveProp('accessibilityLiveRegion', 'polite');
    expect(screen.getByRole('button', { name: 'How Activity totals are counted' })).toHaveProp(
      'accessibilityState',
      { disabled: false, selected: false, expanded: true },
    );

    await fireEvent.press(screen.getByRole('button', { name: 'How Activity totals are counted' }));
    expect(screen.queryByText(note)).toBeNull();
  });
});
