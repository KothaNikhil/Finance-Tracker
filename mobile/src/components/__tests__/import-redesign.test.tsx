import { fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { ImportPreview } from '../import-preview';
import { ImportResultHeader } from '../import-result';
import { ImportStepIndicator } from '../import-step-indicator';
import type { ImportDryRun, ImportPreview as ImportPreviewData } from '@/core/import/pipeline';
import type { NormalizedTxn } from '@/core/import/types';

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

const TXN: NormalizedTxn = {
  isoDate: '2026-08-03',
  time: '12:00:00',
  paise: 45000,
  direction: 'out',
  kind: 'paid',
  counterpartyName: 'Zomato Limited',
  counterpartyVpa: 'zomato@ptys',
  accountName: 'Axis Bank',
  rawDetails: 'Paid to Zomato Limited',
  rawTag: '#🥘 Food',
  remarks: 'Lunch',
  sourceRef: 'ref-1',
  orderId: null,
  source: 'paytm',
  ledgerSide: 'debit',
  dedupeKey: 'ref:ref-1',
};

const PREVIEW: ImportPreviewData = {
  source: 'paytm',
  totalRows: 3,
  parsed: [TXN],
  newTxns: [TXN],
  duplicates: [],
  salvaged: [],
  errors: [{ rowNumber: 5, message: 'Not a transaction' }],
  totalDebitPaise: 45000,
  totalCreditPaise: 0,
};

const UNSURE_TXN: NormalizedTxn = {
  ...TXN,
  counterpartyName: 'Corner Store',
  counterpartyVpa: 'cornerstore@ptys',
  rawDetails: 'Paid to Corner Store',
  rawTag: null,
  remarks: null,
  sourceRef: 'ref-2',
  dedupeKey: 'ref:ref-2',
};

const DRY_RUN: ImportDryRun = {
  reviewCount: 0,
  rows: [
    {
      txn: TXN,
      categoryId: 1,
      subcategoryId: null,
      categoryLabel: '🍽️ Food & Dining',
      confidence: 'high',
      needsReview: false,
      via: 'tag',
      reason: 'Tag',
    },
  ],
};

const MIXED_DRY_RUN: ImportDryRun = {
  reviewCount: 1,
  rows: [
    ...DRY_RUN.rows,
    {
      txn: UNSURE_TXN,
      categoryId: null,
      subcategoryId: null,
      categoryLabel: null,
      confidence: 'none',
      needsReview: true,
      via: 'none',
      reason: 'No match',
    },
  ],
};

describe('guided import components', () => {
  it('announces the active import step', async () => {
    const screen = await render(<ImportStepIndicator current="preview" />);

    expect(
      screen.getByRole('progressbar', {
        name: 'Import progress: step 2 of 3, Preview',
      }),
    ).toHaveProp('accessibilityValue', { min: 1, max: 3, now: 2 });
  });

  it('centres every step label under its own circle', async () => {
    const screen = await render(<ImportStepIndicator current="preview" />);

    // Each step owns one equal share of the row and centres its contents in it, so no per-step
    // offset can creep back in. The last step is where the old geometry drifted most.
    ['File', 'Preview', 'Review'].forEach((label) => {
      expect(screen.getByText(label).parent?.props.style).toMatchObject({
        flex: 1,
        alignItems: 'center',
      });
    });

    // The unreached step's number and its label share one cell, so they cannot separate.
    expect(screen.getByText('3').parent?.parent).toBe(screen.getByText('Review').parent);
  });

  it('shows every parsed row and saves from the preview step', async () => {
    const onSave = jest.fn();
    const screen = await render(
      <ImportPreview
        fileName="Paytm_Aug_2026.xlsx"
        sourceName="Paytm UPI"
        preview={{ ...PREVIEW, newTxns: [TXN, UNSURE_TXN] }}
        dryRun={MIXED_DRY_RUN}
        saving={false}
        error={null}
        onBack={jest.fn()}
        onCancel={jest.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByText('Paytm_Aug_2026.xlsx')).toBeTruthy();
    expect(screen.getByText('Salvaged')).toBeTruthy();
    expect(screen.getByText('Skipped')).toBeTruthy();
    expect(screen.getByText('Total debit')).toBeTruthy();
    expect(screen.getByText('🍽️ Food & Dining')).toBeTruthy();
    // No truncation: the step the user commits from lists everything.
    expect(screen.getByText('Zomato Limited')).toBeTruthy();
    expect(screen.getByText('Corner Store')).toBeTruthy();
    expect(screen.queryByText(/^Showing /)).toBeNull();

    await fireEvent.press(
      screen.getByRole('button', { name: 'Save and review 2 transactions' }),
    );
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('opens a read-only detail for a preview row that has no stored record yet', async () => {
    const screen = await render(
      <ImportPreview
        fileName="Paytm_Aug_2026.xlsx"
        sourceName="Paytm UPI"
        preview={{ ...PREVIEW, newTxns: [TXN, UNSURE_TXN] }}
        dryRun={MIXED_DRY_RUN}
        saving={false}
        error={null}
        onBack={jest.fn()}
        onCancel={jest.fn()}
        onSave={jest.fn()}
      />,
    );

    await fireEvent.press(
      screen.getByRole('button', { name: 'Corner Store, ₹450.00, Pending category' }),
    );

    expect(screen.getByText('PARSED FROM THE STATEMENT')).toBeTruthy();
    expect(screen.getByText('Paid to Corner Store')).toBeTruthy();
    expect(screen.getByText('Flagged for review')).toBeTruthy();
    expect(
      screen.getByText(/Nothing here is saved yet, so it cannot be edited/),
    ).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('PARSED FROM THE STATEMENT')).toBeNull();
  });

  it('reports the save on the review step and offers no cancel there', async () => {
    const screen = await render(
      <ImportResultHeader
        saved={{
          fileName: 'Paytm_Aug_2026.xlsx',
          savedCount: 3,
          duplicatesChecked: 1,
          duplicatesUpdated: 1,
          duplicatesFlagged: 0,
        }}
        sessionCount={3}
        spentPaise={45000}
        receivedPaise={870000}
        reviewCount={0}
        lastImport={null}
        months={[]}
        selectedMonth={null}
        scope="session"
        onSelectMonth={jest.fn()}
        onScopeChange={jest.fn()}
        onDone={jest.fn()}
        onAcceptAll={jest.fn()}
        onRevert={jest.fn()}
      />,
    );

    expect(
      screen.getByRole('progressbar', { name: 'Import progress: step 3 of 3, Review' }),
    ).toBeTruthy();
    expect(screen.getByText('3 transactions saved')).toBeTruthy();
    expect(
      screen.getByText('Paytm_Aug_2026.xlsx · 1 duplicate checked · 1 existing row updated'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Cancel/ })).toBeNull();
  });

  it('exposes post-save review, scope and revert actions without leaving Import', async () => {
    const onAcceptAll = jest.fn();
    const onRevert = jest.fn();
    const onScopeChange = jest.fn();
    const onDone = jest.fn();
    const screen = await render(
      <ImportResultHeader
        saved={null}
        sessionCount={3}
        spentPaise={45000}
        receivedPaise={870000}
        reviewCount={2}
        lastImport={{
          sourceLabel: 'Paytm_Aug_2026.xlsx',
          addedCount: 3,
          importedAt: '2026-08-31T10:00:00.000Z',
        }}
        months={[]}
        selectedMonth={null}
        scope="session"
        onSelectMonth={jest.fn()}
        onScopeChange={onScopeChange}
        onDone={onDone}
        onAcceptAll={onAcceptAll}
        onRevert={onRevert}
      />,
    );

    expect(screen.queryByRole('button', { name: /Import another/ })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Accept all' }));
    expect(onAcceptAll).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole('tab', { name: 'Needs review 2' }));
    expect(onScopeChange).toHaveBeenCalledWith('flagged');

    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Revert last import, Paytm_Aug_2026.xlsx, 3 transactions',
      }),
    );
    expect(onRevert).toHaveBeenCalledTimes(1);

    await fireEvent.press(
      screen.getByRole('button', { name: 'Done, back to choosing a statement' }),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
