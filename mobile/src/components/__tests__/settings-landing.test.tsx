import { fireEvent, render } from '@testing-library/react-native';

import { SettingsLanding, type SettingsLandingProps } from '../settings-landing';

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

function makeProps(overrides: Partial<SettingsLandingProps> = {}): SettingsLandingProps {
  return {
    categoryCount: 12,
    paymentModeCount: 6,
    peopleCount: 3,
    appearanceLabel: 'System',
    appLockLabel: 'Protected',
    accountEmail: 'nikhil@example.com',
    driveEnabled: true,
    onOpenCategories: jest.fn(),
    onOpenPaymentModes: jest.fn(),
    onOpenPeople: jest.fn(),
    onOpenAppearance: jest.fn(),
    onOpenBackup: jest.fn(),
    onOpenAccount: jest.fn(),
    onDeleteAll: jest.fn(),
    ...overrides,
  };
}

describe('SettingsLanding', () => {
  it('groups shipped settings and opens focused views', async () => {
    const props = makeProps();
    const screen = await render(<SettingsLanding {...props} />);

    expect(screen.getByText('ORGANIZE')).toBeTruthy();
    expect(screen.getByText('PREFERENCES')).toBeTruthy();
    expect(screen.getByText('DATA & ACCOUNT')).toBeTruthy();
    expect(screen.getByLabelText('App lock, Protected')).toBeTruthy();
    expect(screen.getByLabelText('Currency, Indian Rupee (₹)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'App lock, Protected' })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Categories, 12' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Payment modes, 6' }));
    await fireEvent.press(screen.getByRole('button', { name: 'People & groups, 3' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Appearance, System' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Backup & restore, Drive + local file' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Account, Google' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete all data' }));

    expect(props.onOpenCategories).toHaveBeenCalledTimes(1);
    expect(props.onOpenPaymentModes).toHaveBeenCalledTimes(1);
    expect(props.onOpenPeople).toHaveBeenCalledTimes(1);
    expect(props.onOpenAppearance).toHaveBeenCalledTimes(1);
    expect(props.onOpenBackup).toHaveBeenCalledTimes(1);
    expect(props.onOpenAccount).toHaveBeenCalledTimes(1);
    expect(props.onDeleteAll).toHaveBeenCalledTimes(1);
  });

  it('omits account and Drive affordances when unavailable', async () => {
    const props = makeProps({
      accountEmail: undefined,
      onOpenAccount: undefined,
      driveEnabled: false,
    });
    const screen = await render(<SettingsLanding {...props} />);

    expect(screen.queryByText('nikhil@example.com')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back up now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Account, Google' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Backup & restore, Local file' })).toBeTruthy();
  });
});
