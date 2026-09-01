/**
 * The Activity filter sheet. Every dimension the one `TxnFilter` carries has to stay reachable and
 * apply correctly from the redesigned rows, so these tests walk the sheet the way a user does.
 */

import { fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { MonthKey, TxnFilter } from '@/core/analytics';
import { ActivityFilterBar } from '../activity-filter-bar';
import { ReportsFilters, type ReportsFiltersProps } from '../reports-filters';

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

const mockMatchCount = jest.fn((_filter: TxnFilter) => ({
  count: 128,
  loading: false,
  error: undefined as Error | undefined,
  retry: jest.fn(),
}));

jest.mock('@/hooks/use-transactions', () => ({
  useTransactionCount: (filter: TxnFilter) => mockMatchCount(filter),
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

/** Aug 2026 back to Jul 2025, newest first — enough history for both relative presets. */
const months: MonthKey[] = Array.from({ length: 14 }, (_, i) => {
  const o = 2026 * 12 + 7 - i;
  return { year: Math.floor(o / 12), month: (o % 12) + 1 };
});

const categories: ReportsFiltersProps['categories'] = [
  { id: 1, name: 'Food', emoji: '🍔', subcategories: [{ id: 11, name: 'Snacks' }, { id: 12, name: 'Dining' }] },
  { id: 2, name: 'Groceries', emoji: '🛒', subcategories: [] },
  { id: 3, name: 'Transport', emoji: null, subcategories: [] },
  { id: 4, name: 'Rent', emoji: null, subcategories: [] },
  { id: 5, name: 'Health', emoji: null, subcategories: [] },
  { id: 6, name: 'Utilities', emoji: null, subcategories: [] },
  { id: 7, name: 'Shopping', emoji: null, subcategories: [] },
  { id: 8, name: 'Travel', emoji: null, subcategories: [] },
  { id: 9, name: 'Gifts', emoji: null, subcategories: [] },
];

const baseProps: ReportsFiltersProps = {
  visible: false,
  initial: {},
  years: [2026, 2025],
  months,
  categories,
  accounts: ['Axis Bank - 15', 'KVB - 22'],
  people: [
    { id: 5, name: 'Prathyusha' },
    { id: 6, name: 'Ravi' },
  ],
  onApply: jest.fn(),
  onClose: jest.fn(),
};

/** Mount closed, then open — the seeding path the Activity screen actually uses. */
async function openSheet(overrides: Partial<ReportsFiltersProps> = {}) {
  const props = { ...baseProps, onApply: jest.fn(), onClose: jest.fn(), ...overrides };
  const screen = await render(<ReportsFilters {...props} visible={false} />);
  await screen.rerender(<ReportsFilters {...props} visible />);
  return { screen, props };
}

beforeEach(() => {
  mockMatchCount.mockClear();
});

describe('Activity filter sheet', () => {
  it('reaches and applies every filter dimension', async () => {
    const { screen, props } = await openSheet();

    await fireEvent.press(screen.getByRole('button', { name: 'From: Earliest' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Mar 2026' }));
    await fireEvent.press(screen.getByRole('button', { name: 'To: Latest' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Aug 2026' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Category: Any' }));
    await fireEvent.press(screen.getByRole('button', { name: '🍔 Food' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Sub-category: Any' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Snacks' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Direction: Any' }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Received' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Refunds: Any' }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Refunds only' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Account: Any' }));
    await fireEvent.press(screen.getByRole('button', { name: 'KVB - 22' }));

    await fireEvent.press(screen.getByRole('button', { name: 'For (person): Any' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Ravi' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Amount: Any' }));
    await fireEvent.changeText(screen.getByLabelText('Minimum amount in rupees'), '500');
    await fireEvent.changeText(screen.getByLabelText('Maximum amount in rupees'), '2000');

    await fireEvent.press(screen.getByRole('switch', { name: 'Needs review only' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Apply filters' }));

    expect(props.onApply).toHaveBeenCalledWith({
      from: { year: 2026, month: 3 },
      to: { year: 2026, month: 8 },
      categoryId: 1,
      subcategoryId: 11,
      direction: 'in',
      isRefund: true,
      account: 'KVB - 22',
      personId: 6,
      minPaise: 50_000,
      maxPaise: 200_000,
      needsReview: true,
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps every direction and refund state selectable', async () => {
    const { screen } = await openSheet();

    await fireEvent.press(screen.getByRole('button', { name: 'Direction: Any' }));
    for (const label of ['Any', 'Spent', 'Received', 'Transfer']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
    await fireEvent.press(screen.getByRole('tab', { name: 'Transfer' }));
    expect(screen.getByRole('button', { name: 'Direction: Transfer' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Refunds: Any' }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Exclude' }));
    expect(screen.getByRole('button', { name: 'Refunds: Exclude' })).toBeTruthy();
  });

  it('states a refund-only deep link on the row rather than burying it', async () => {
    const { screen, props } = await openSheet({ initial: { isRefund: true } });

    expect(screen.getByRole('button', { name: 'Refunds: Refunds only' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear the refunds filter' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Apply filters' }));
    expect(props.onApply).toHaveBeenCalledWith({ isRefund: true });
  });

  it('applies whole years and relative periods from the preset chips', async () => {
    const { screen, props } = await openSheet();

    await fireEvent.press(screen.getByRole('button', { name: '2025' }));
    expect(screen.getByRole('button', { name: 'From: Jan 2025' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'To: Dec 2025' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Last 3 months' }));
    expect(screen.getByRole('button', { name: 'From: Jun 2026' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Last 12 months' }));
    expect(screen.getByRole('button', { name: 'From: Sep 2025' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'All time' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apply filters' }));
    expect(props.onApply).toHaveBeenCalledWith({});
  });

  it('picks months from a grid and keeps one-sided ranges open-ended', async () => {
    const { screen, props } = await openSheet();

    await fireEvent.press(screen.getByRole('button', { name: 'From: Earliest' }));
    expect(screen.getByText('Choose the first month')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next year' })).toHaveProp('accessibilityState', {
      disabled: true,
      selected: false,
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Previous year' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Jun 2025' }));

    expect(screen.getByRole('button', { name: 'From: Jun 2025' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'To: Latest' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Apply filters' }));
    expect(props.onApply).toHaveBeenCalledWith({ from: { year: 2025, month: 6 } });
  });

  it('cannot be driven into an inverted month range', async () => {
    const { screen } = await openSheet({
      initial: { from: { year: 2026, month: 1 }, to: { year: 2026, month: 3 } },
    });

    await fireEvent.press(screen.getByRole('button', { name: 'From: Jan 2026' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Aug 2026' }));

    expect(screen.getByRole('button', { name: 'From: Aug 2026' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'To: Aug 2026' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply filters' })).toHaveProp('accessibilityState', {
      disabled: false,
      busy: false,
    });
  });

  it('refuses to apply a period or amount range that can never match', async () => {
    const { screen } = await openSheet({
      initial: { from: { year: 2026, month: 12 }, to: { year: 2026, month: 1 } },
    });

    expect(screen.getByText('The first month must not be after the last.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply filters' })).toHaveProp('accessibilityState', {
      disabled: true,
      busy: false,
    });

    await fireEvent.press(screen.getByRole('button', { name: 'All time' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Amount: Any' }));
    await fireEvent.changeText(screen.getByLabelText('Minimum amount in rupees'), '2000');
    await fireEvent.changeText(screen.getByLabelText('Maximum amount in rupees'), '500');

    expect(screen.getByText('Minimum must not exceed maximum.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply filters' })).toHaveProp('accessibilityState', {
      disabled: true,
      busy: false,
    });
  });

  it('separates clearing one filter from clearing all of them', async () => {
    const { screen } = await openSheet({
      initial: {
        from: { year: 2026, month: 1 },
        to: { year: 2026, month: 12 },
        categoryId: 1,
        subcategoryId: 11,
        direction: 'out',
        minPaise: 50_000,
        needsReview: true,
      },
    });

    expect(screen.getByRole('button', { name: 'Category: 🍔 Food' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Amount: ₹500.00 and above' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Clear the category filter' }));

    expect(screen.getByRole('button', { name: 'Category: Any' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Sub-category/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Direction: Spent' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'From: Jan 2026' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Clear all' }));

    expect(screen.getByRole('button', { name: 'Direction: Any' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'From: Earliest' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Amount: Any' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Needs review only' })).toHaveProp('accessibilityState', {
      checked: false,
    });
    expect(screen.getByRole('button', { name: 'Clear all' })).toHaveProp('accessibilityState', {
      disabled: true,
      busy: false,
    });
  });

  it('searches an option list once it is too long to scan', async () => {
    const { screen } = await openSheet();

    await fireEvent.press(screen.getByRole('button', { name: 'Account: Any' }));
    expect(screen.queryByLabelText('Search account options')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Account: Any' }));

    await fireEvent.press(screen.getByRole('button', { name: 'Category: Any' }));
    const box = screen.getByLabelText('Search category options');

    await fireEvent.changeText(box, 'gro');
    expect(screen.getByRole('button', { name: '🛒 Groceries' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Transport' })).toBeNull();

    await fireEvent.changeText(box, 'zzz');
    expect(screen.getByText('Nothing matches “zzz”.')).toBeTruthy();
  });

  it('shows one dimension at a time so the rest of the filter stays readable', async () => {
    const { screen } = await openSheet();

    await fireEvent.press(screen.getByRole('button', { name: 'Category: Any' }));
    expect(screen.getByRole('button', { name: 'Category: Any' })).toHaveProp('accessibilityState', {
      expanded: true,
    });
    expect(screen.getByRole('button', { name: 'Uncategorized' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Account: Any' }));
    expect(screen.queryByRole('button', { name: 'Uncategorized' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Category: Any' })).toHaveProp('accessibilityState', {
      expanded: false,
    });
    expect(screen.getByRole('button', { name: 'Axis Bank - 15' })).toBeTruthy();
  });

  it('is a draft until Apply, so backing out changes nothing', async () => {
    const props = { ...baseProps, onApply: jest.fn(), onClose: jest.fn(), initial: { direction: 'out' as const } };
    const screen = await render(<ReportsFilters {...props} visible={false} />);
    await screen.rerender(<ReportsFilters {...props} visible />);

    await fireEvent.press(screen.getByRole('button', { name: 'Direction: Spent' }));
    await fireEvent.press(screen.getByRole('tab', { name: 'Received' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Close filters' }));

    expect(props.onApply).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledTimes(1);

    await screen.rerender(<ReportsFilters {...props} visible={false} />);
    await screen.rerender(<ReportsFilters {...props} visible />);
    expect(screen.getByRole('button', { name: 'Direction: Spent' })).toBeTruthy();
  });

  it('says how many transactions the draft will show, search included', async () => {
    const initial: TxnFilter = { direction: 'out' };
    const screen = await render(<ReportsFilters {...baseProps} initial={initial} search="zomato" visible />);

    expect(mockMatchCount).toHaveBeenCalledWith({ direction: 'out', search: 'zomato' });
    expect(screen.getByText('128 transactions match.')).toBeTruthy();

    mockMatchCount.mockReturnValue({ count: 0, loading: false, error: undefined, retry: jest.fn() });
    await screen.rerender(<ReportsFilters {...baseProps} initial={initial} search="zomato" visible />);
    expect(screen.getByText('No transactions match these filters.')).toBeTruthy();

    // An empty result is still applicable — the sheet warns rather than blocking.
    expect(screen.getByRole('button', { name: 'Apply filters' })).toHaveProp('accessibilityState', {
      disabled: false,
      busy: false,
    });

    mockMatchCount.mockReturnValue({ count: 128, loading: false, error: undefined, retry: jest.fn() });
  });

  it('sizes itself to its content instead of holding 90% of the screen', async () => {
    const { screen } = await openSheet();

    const sheet = screen.getByTestId('bottom-sheet');
    expect(sheet.props.sheetClosable).toBe(true);
    expect(sheet.props.sheetHeightFraction).toBeUndefined();
  });
});

describe('Activity filter bar', () => {
  it('carries the active filter count on the entry point', async () => {
    const screen = await render(
      <ActivityFilterBar
        chips={[
          { key: 'period', label: 'August 2026', clear: jest.fn() },
          { key: 'dir', label: 'Spent', clear: jest.fn() },
        ]}
        activeCount={2}
        onOpenFilters={jest.fn()}
        onClearAll={jest.fn()}
        showClearAll
      />,
    );

    expect(screen.getByRole('button', { name: 'Filters, 2 active' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Spent filter' })).toBeTruthy();
  });
});
