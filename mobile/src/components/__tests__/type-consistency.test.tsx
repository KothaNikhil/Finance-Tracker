/**
 * A list row is one role, so it renders at one size everywhere. This regressed once: Lending's row
 * titles and amounts were raised above Activity's while rebuilding the hierarchy bold used to
 * carry, and the two screens visibly diverged.
 */

import { render } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TEXT_STYLES } from '../themed-text';
import { TxnRow } from '../txn-row';
import { TextRole } from '@/constants/typography';

jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@shopify/flash-list', () => ({ FlashList: () => null }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
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

const SRC = join(__dirname, '..', '..');
const read = (relative: string) => readFileSync(join(SRC, relative), 'utf8');

/** Every file that renders a list row, and so must take its sizes from `TextRole`. */
const ROW_OWNERS = [
  'app/lending.tsx',
  'components/txn-row.tsx',
  'components/card-bill-sheet.tsx',
  'components/attach-existing-sheet.tsx',
  'components/add-to-money-lent-sheet.tsx',
  'components/import-preview.tsx',
  'components/loan-detail.tsx',
  'components/category-breakdown.tsx',
];

const txn = {
  id: 1,
  isoDate: '2026-08-31',
  time: null,
  paise: 5_000_000,
  direction: 'out',
  kind: 'other',
  categoryId: null,
  subcategoryId: null,
  paymentModeId: null,
  personId: 1,
  counterpartyName: 'Zomato',
  counterpartyVpa: null,
  accountName: null,
  originalDirection: null,
  transferRole: null,
  loanId: null,
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
  dedupeKey: 'txn-1',
  autoCategorized: false,
  needsReview: false,
  createdAt: '2026-08-31T00:00:00.000Z',
} as const;

describe('list rows render at one size app-wide', () => {
  it('renders the Activity row at exactly the canonical row sizes', async () => {
    const screen = await render(
      <TxnRow txn={txn} categoryLabel={null} onPress={jest.fn()} variant="activity" />,
    );

    const title = screen.getByText('Zomato');
    const amount = screen.getByText('−₹50,000.00');

    expect(title).toHaveStyle({ fontSize: TEXT_STYLES[TextRole.rowTitle].fontSize });
    expect(amount).toHaveStyle({ fontSize: TEXT_STYLES[TextRole.rowAmount].fontSize });
  });

  it('never shrinks a row figure below the readable floor', () => {
    const smallest = TEXT_STYLES[TextRole.rowAmount].fontSize * 0.85;
    expect(smallest).toBeGreaterThanOrEqual(11);
  });

  it('keeps Lending on the same row roles as Activity rather than its own scale', () => {
    const lending = read('app/lending.tsx');

    expect(lending).toContain('TextRole.rowTitle');
    expect(lending).toContain('TextRole.rowAmount');
    // These are summary and sheet-title roles; a row that reaches for one has drifted.
    expect(lending).not.toMatch(/type="(heading|amount|amountLarge|subtitle|title)"/);
  });

  it('takes every row size from the shared map instead of naming types inline', () => {
    const offenders = ROW_OWNERS.filter((file) => !read(file).includes('TextRole.row'));
    expect(offenders).toEqual([]);
  });

  it('separates a nested row from its parent without raising the parent', () => {
    const parentTitle = TEXT_STYLES[TextRole.rowTitle];
    const nestedTitle = TEXT_STYLES[TextRole.nestedRowTitle];
    const nestedAmount = TEXT_STYLES[TextRole.nestedRowAmount];

    expect(nestedTitle.fontSize).toBeLessThan(parentTitle.fontSize);
    expect(nestedTitle.fontSize).toBeGreaterThanOrEqual(13);
    expect(nestedAmount.fontSize).toBeGreaterThanOrEqual(13);
    expect(TEXT_STYLES[TextRole.rowAmount].fontSize).toBe(parentTitle.fontSize);
  });
});
