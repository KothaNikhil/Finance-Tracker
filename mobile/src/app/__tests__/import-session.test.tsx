/**
 * Screen-level regression for the repeatable import flow: pick → preview → review, run several
 * times in ONE app session.
 *
 * The pipeline tests cover parse → dedupe → preview in isolation; this drives the real Import
 * screen so the flow's own state machine is covered, including that Cancel on the preview writes
 * nothing, that the save commits everything, that a review row opens the editable transaction
 * sheet, and that the needs-review list keeps working after a Done and in a fresh session. The
 * database and the file picker are faked in memory, but the adapters, the xlsx reader, the dedupe
 * pipeline, the dry-run review flags and the filter predicate are the real ones.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
// `mock`-prefixed so the mock factories below may reference them (see babel-plugin-jest-hoist).
import * as mockReact from 'react';
import { Alert, Text as mockRowText } from 'react-native';
import * as XLSX from 'xlsx';

import ImportScreen from '../import';
import { buildCategoryIndex } from '@/core/categorize';
import {
  matchesFilter as mockMatchesFilter,
  type FilterableTxn,
  type TxnFilter,
} from '@/core/analytics';
import { dryRunImportPreview as mockDryRunImportPreview } from '@/core/import/pipeline';
import type { NormalizedTxn } from '@/core/import/types';
import type { CardStatementMeta } from '@/services/db/repository';

interface StoredTxn {
  id: number;
  importId: number;
  txn: NormalizedTxn;
  categoryId: number | null;
  needsReview: boolean;
  createdAt: string;
}

interface StoredImport {
  id: number;
  sourceLabel: string;
  importedAt: string;
  addedCount: number;
  cardMeta: CardStatementMeta | null;
}

const mockFiles = new Map<string, Uint8Array>();

const mockDb: {
  txns: StoredTxn[];
  imports: StoredImport[];
  meta: Map<string, string>;
  reconciledKeys: string[][];
  nextId: number;
} = { txns: [], imports: [], meta: new Map(), reconciledKeys: [], nextId: 1 };

// The screen reads `SESSION_START` on every render, so moving this models relaunching the app.
const mockSession = { start: '2000-01-01T00:00:00.000Z' };

// The app-wide transaction sheet, which only stored rows can open.
const mockOpenTxn = jest.fn();

jest.mock('expo-symbols', () => ({ SymbolView: () => null }));

jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.2.3' }));

jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: jest.fn() }) }));

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));

jest.mock('expo-file-system', () => ({
  File: class MockFile {
    constructor(private readonly mockUri: string) {}

    async arrayBuffer(): Promise<ArrayBuffer> {
      const bytes = mockFiles.get(this.mockUri);
      if (!bytes) throw new Error(`no staged file at ${this.mockUri}`);
      return bytes.slice().buffer;
    }
  },
}));

jest.mock('@/services/session', () => ({
  get SESSION_START() {
    return mockSession.start;
  },
}));

jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

jest.mock('@/hooks/use-transaction-detail', () => ({
  useTransactionDetail: () => ({ openTxn: mockOpenTxn }),
}));

jest.mock('@/components/bottom-sheet', () => ({
  BottomSheet: ({ visible, children }: { visible: boolean; children: mockReact.ReactNode }) =>
    visible ? mockReact.createElement(mockReact.Fragment, null, children) : null,
}));

jest.mock('@/components/debug-log-screen', () => ({ DebugLogScreen: () => null }));

jest.mock('@/components/supported-formats', () => ({
  SupportedFormatsButton: () => null,
  SupportedFormatsList: () => null,
  SupportedFormatsSheet: () => null,
}));

// Stubbed down to the parts this screen owns: the real list is virtualized (rows off-screen are
// not rendered) and it belongs to the Activity redesign, so rows collapse to a pressable title.
jest.mock('@/components/transaction-list', () => ({
  TransactionList: ({
    rows,
    onPressRow,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
  }: import('@/components/transaction-list').TransactionListProps) =>
    mockReact.createElement(
      mockReact.Fragment,
      null,
      ListHeaderComponent,
      rows.length === 0
        ? ListEmptyComponent
        : rows.map((txn) =>
            mockReact.createElement(
              mockRowText,
              { key: txn.id, onPress: () => onPressRow(txn.id) },
              txn.counterpartyName ?? txn.rawDetails ?? 'Transaction',
            ),
          ),
      ListFooterComponent,
    ),
}));

jest.mock('@/services/db/dev-tools', () => ({
  seedRandomTransactions: jest.fn(() => 0),
  runAnalyticsParityCheck: jest.fn(() => ({ ok: true })),
}));

jest.mock('@/hooks/use-reference-data', () => ({
  useCategoryIndex: () => mockCategoryIndex(),
}));

jest.mock('@/hooks/use-analytics', () => ({
  useSummary: (filter: TxnFilter) => {
    const rows = mockSelect(filter);
    return {
      spentPaise: rows
        .filter((r) => r.txn.ledgerSide === 'debit')
        .reduce((sum, r) => sum + r.txn.paise, 0),
      receivedPaise: rows
        .filter((r) => r.txn.ledgerSide === 'credit')
        .reduce((sum, r) => sum + r.txn.paise, 0),
      reviewCount: rows.filter((r) => r.needsReview).length,
      savedCount: rows.length,
      loading: false,
      error: undefined,
      retry: jest.fn(),
    };
  },
  useDimensions: () => ({ years: [], months: [], accounts: [] }),
}));

jest.mock('@/hooks/use-transactions', () => ({
  useTransactionList: (filter: TxnFilter) => {
    const rows = mockSelect(filter);
    return {
      rows: rows.map((r) => ({
        ...r.txn,
        id: r.id,
        importId: r.importId,
        categoryId: r.categoryId,
        needsReview: r.needsReview,
        createdAt: r.createdAt,
      })),
      count: rows.length,
      hasMore: false,
      loadMore: jest.fn(),
      loading: false,
      error: undefined,
      retry: jest.fn(),
    };
  },
  useLastImport: () => mockDb.imports.at(-1) ?? null,
}));

jest.mock('@/services/db/repository', () => ({
  getExistingDedupeKeys: () => new Set(mockDb.txns.map((r) => r.txn.dedupeKey)),
  getCategoryIndex: () => mockCategoryIndex(),
  getLearnedRules: () => [],
  saveTransactions: (
    txns: NormalizedTxn[],
    sourceLabel: string | null,
    cardMeta: CardStatementMeta | null,
  ) => {
    const stored = new Set(mockDb.txns.map((r) => r.txn.dedupeKey));
    const fresh = txns.filter((t) => !stored.has(t.dedupeKey));
    if (fresh.length === 0) return 0;
    const importId = mockDb.nextId++;
    const now = new Date().toISOString();
    mockDb.imports.push({
      id: importId,
      sourceLabel: sourceLabel ?? '',
      importedAt: now,
      addedCount: fresh.length,
      cardMeta,
    });
    // The real save auto-categorizes with the same rule the dry run projects, so the stored
    // needs-review flags must come from that rule and not from a fixture.
    mockDryRunImportPreview({ newTxns: fresh }, mockCategoryIndex()).rows.forEach((row) =>
      mockDb.txns.push({
        id: mockDb.nextId++,
        importId,
        txn: row.txn,
        categoryId: row.categoryId,
        needsReview: row.needsReview,
        createdAt: now,
      }),
    );
    return fresh.length;
  },
  reconcileDuplicatesFromImport: (dupes: NormalizedTxn[]) => {
    mockDb.reconciledKeys.push(dupes.map((t) => t.dedupeKey));
    return { updated: dupes.length, flagged: 0 };
  },
  revertImport: (importId: number) => {
    const removed = mockDb.txns.filter((r) => r.importId === importId).length;
    mockDb.txns = mockDb.txns.filter((r) => r.importId !== importId);
    mockDb.imports = mockDb.imports.filter((i) => i.id !== importId);
    return removed;
  },
  acceptAllReviews: () => {
    const pending = mockDb.txns.filter((r) => r.needsReview);
    pending.forEach((r) => (r.needsReview = false));
    return pending.length;
  },
  getPendingImport: () => {
    const raw = mockDb.meta.get('pending_import');
    return raw ? (JSON.parse(raw) as { uri: string; label: string }) : null;
  },
  setPendingImport: (uri: string, label: string) =>
    mockDb.meta.set('pending_import', JSON.stringify({ uri, label })),
  clearPendingImport: () => mockDb.meta.delete('pending_import'),
}));

function mockCategoryIndex() {
  return buildCategoryIndex(
    [
      { id: 1, name: 'Food & Dining', emoji: '🍽️' },
      { id: 2, name: 'Groceries', emoji: '🛒' },
    ],
    [],
  );
}

/** Apply the production filter predicate to the fake store, so `since`/`needsReview` behave. */
function mockSelect(filter: TxnFilter): StoredTxn[] {
  return mockDb.txns.filter((row) => {
    const filterable: FilterableTxn = {
      isoDate: row.txn.isoDate,
      paise: row.txn.paise,
      direction: row.txn.direction,
      categoryId: row.categoryId,
      subcategoryId: null,
      accountName: row.txn.accountName,
      personId: null,
      rawDetails: row.txn.rawDetails,
      counterpartyVpa: row.txn.counterpartyVpa,
      counterpartyName: row.txn.counterpartyName,
      remarks: row.txn.remarks,
      note: null,
      rawTag: row.txn.rawTag,
      needsReview: row.needsReview,
      isRefund: row.txn.kind === 'refund',
      createdAt: row.createdAt,
    };
    return mockMatchesFilter(filterable, filter);
  });
}

const HEADERS = [
  'Date',
  'Time',
  'Transaction Details',
  'Other Transaction Details (UPI ID or A/c No)',
  'Your Account',
  'Amount',
  'UPI Ref No.',
  'Order ID',
  'Remarks',
  'Tags',
  'Comment',
];

/** One Paytm passbook row; `ref` is what the dedupe key is built from. */
function row(date: string, details: string, amount: string, ref: string): string[] {
  return [date, '13:20:00', details, 'payee@ptys on Paytm', 'Axis Bank - 15', amount, ref, '', '', '', ''];
}

const FIRST_FILE_ROWS = [
  row('01/05/2026', 'Paid to Zomato Limited', '-450.00', 'REF-A1'),
  row('02/05/2026', 'Paid to ZEPTO Marketplace', '-380.00', 'REF-A2'),
  row('03/05/2026', 'Received from Vutukuri Prathyusha', '+5,000.00', 'REF-A3'),
];

// Overlaps the first file on REF-A3 (statements overlap all the time) plus two genuinely new rows.
const SECOND_FILE_ROWS = [
  row('03/05/2026', 'Received from Vutukuri Prathyusha', '+5,000.00', 'REF-A3'),
  row('04/06/2026', 'Paid to Corner Store', '-120.00', 'REF-B1'),
  row('05/06/2026', 'Paid to Sri Babu Raju Ram Fuel', '-900.00', 'REF-B2'),
];

/** Write a real .xlsx for these rows and stage it as the picker's next result. */
function stageFile(name: string, rows: string[][]): void {
  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Passbook Payment History');
  const bytes = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
  const uri = `file:///cache/DocumentPicker/${name}`;
  mockFiles.set(uri, bytes);
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri, name, mimeType: 'application/vnd.ms-excel', size: bytes.length }],
  });
}

type Screen = Awaited<ReturnType<typeof render>>;

/** Pick a staged statement and wait for its preview. */
async function pickFile(screen: Screen, name: string, rows: string[][]): Promise<void> {
  stageFile(name, rows);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose file' }));
  await waitFor(() => expect(screen.getByText('Import preview')).toBeTruthy());
  await waitFor(() => expect(screen.getByText(name)).toBeTruthy());
}

/** Commit from the preview — the only step that writes — and land on the review step. */
async function save(screen: Screen): Promise<void> {
  await fireEvent.press(screen.getByRole('button', { name: /^(Save and review|Check) / }));
  await waitFor(() => expect(screen.getByText('Review transactions')).toBeTruthy());
}

/** Finish the run from the review step, the way the user does. */
async function done(screen: Screen): Promise<void> {
  await fireEvent.press(
    screen.getByRole('button', { name: 'Done, back to choosing a statement' }),
  );
  await waitFor(() => expect(screen.getByText('Choose a statement')).toBeTruthy());
}

/**
 * Tear the screen down and mount it fresh — what `Gate` does every time the device lock re-engages,
 * which includes every return from the file picker.
 */
async function remount(screen: Screen, mount: number): Promise<void> {
  await screen.rerender(<ImportScreen key={`mount-${mount}`} />);
}

beforeEach(() => {
  mockFiles.clear();
  mockDb.txns = [];
  mockDb.imports = [];
  mockDb.meta.clear();
  mockDb.reconciledKeys = [];
  mockDb.nextId = 1;
  mockSession.start = '2000-01-01T00:00:00.000Z';
  mockOpenTxn.mockReset();
  (DocumentPicker.getDocumentAsync as jest.Mock).mockReset();
});

describe('importing several statements in one session', () => {
  it('previews and saves a second file independently of the first', async () => {
    const screen = await render(<ImportScreen />);

    await pickFile(screen, 'Paytm_May.xlsx', FIRST_FILE_ROWS);
    expect(screen.getByText('Paytm UPI · 3 rows')).toBeTruthy();
    await save(screen);
    expect(mockDb.txns).toHaveLength(3);
    await done(screen);

    await pickFile(screen, 'Paytm_Jun.xlsx', SECOND_FILE_ROWS);
    // The second preview must describe the SECOND file: 3 rows, 2 new, 1 already-stored duplicate.
    expect(screen.getByText('Paytm UPI · 3 rows')).toBeTruthy();
    expect(screen.getByText('Corner Store')).toBeTruthy();
    expect(screen.queryByText('Zomato Limited')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Save and review 2 transactions' }),
    ).toBeTruthy();

    await save(screen);

    // Dedupe held across the two imports: only the two new rows landed, and the overlapping row
    // went through duplicate reconciliation instead of being inserted again.
    expect(mockDb.txns.map((r) => r.txn.dedupeKey)).toEqual([
      'ref:REF-A1',
      'ref:REF-A2',
      'ref:REF-A3',
      'ref:REF-B1',
      'ref:REF-B2',
    ]);
    expect(mockDb.reconciledKeys).toEqual([[], ['ref:REF-A3']]);
    expect(mockDb.imports).toHaveLength(2);
    expect(mockDb.imports.map((i) => i.sourceLabel)).toEqual([
      'Paytm_May.xlsx',
      'Paytm_Jun.xlsx',
    ]);
  });

  it('keeps session totals cumulative and reverts only the most recent import', async () => {
    const screen = await render(<ImportScreen />);

    await pickFile(screen, 'Paytm_May.xlsx', FIRST_FILE_ROWS);
    await save(screen);
    await done(screen);
    await pickFile(screen, 'Paytm_Jun.xlsx', SECOND_FILE_ROWS);
    await save(screen);

    // The banner reports only the last import; the totals beside it cover the whole session.
    expect(screen.getByText('2 transactions saved')).toBeTruthy();
    expect(screen.getByText('Imported')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();

    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Revert last import, Paytm_Jun.xlsx, 2 transactions',
      }),
    );
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === 'Delete all')?.onPress?.();

    // Only the second import's rows are gone; the first import's three rows survive.
    expect(mockDb.txns.map((r) => r.txn.dedupeKey)).toEqual([
      'ref:REF-A1',
      'ref:REF-A2',
      'ref:REF-A3',
    ]);
    expect(mockDb.imports.map((i) => i.sourceLabel)).toEqual(['Paytm_May.xlsx']);
    alert.mockRestore();
  });

  // The device lock re-engages every time the app returns from the background, and `Gate` swaps the
  // whole tab tree for the lock screen — so the trip through the OS file picker remounts this
  // screen on every single pick. The pick step therefore has to survive a remount.
  it('still offers the pick step after a completed import is remounted by the app lock', async () => {
    const screen = await render(<ImportScreen key="mount-1" />);
    await pickFile(screen, 'Paytm_May.xlsx', FIRST_FILE_ROWS);
    await save(screen);

    await remount(screen, 2);
    await waitFor(() => expect(screen.getByText('Choose a statement')).toBeTruthy());

    // …and the second file imports from there, deduping against the first.
    await pickFile(screen, 'Paytm_Jun.xlsx', SECOND_FILE_ROWS);
    expect(
      screen.getByRole('button', { name: 'Save and review 2 transactions' }),
    ).toBeTruthy();
    await save(screen);

    expect(mockDb.txns.map((r) => r.txn.dedupeKey)).toEqual([
      'ref:REF-A1',
      'ref:REF-A2',
      'ref:REF-A3',
      'ref:REF-B1',
      'ref:REF-B2',
    ]);
    expect(mockDb.imports).toHaveLength(2);
  });

  it('resumes a file picked just before an app-lock remount instead of the previous result', async () => {
    const screen = await render(<ImportScreen key="mount-1" />);
    await pickFile(screen, 'Paytm_May.xlsx', FIRST_FILE_ROWS);
    await save(screen);
    await done(screen);

    // The lock fires while the picker is open, so the pick lands on a screen that is about to be
    // torn down; only the persisted marker carries the file across the remount.
    stageFile('Paytm_Jun.xlsx', SECOND_FILE_ROWS);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose file' }));
    await remount(screen, 2);

    await waitFor(() => expect(screen.getByText('Import preview')).toBeTruthy());
    expect(screen.getByText('Paytm_Jun.xlsx')).toBeTruthy();
    await save(screen);
    expect(mockDb.txns).toHaveLength(5);
  });

  it('saves from the preview, reports it on the review step, and ends on pick', async () => {
    const screen = await render(<ImportScreen />);
    await pickFile(screen, 'Paytm_May.xlsx', FIRST_FILE_ROWS);

    // Every parsed row is listed on the step that commits — no truncation.
    expect(screen.getByText('Zomato Limited')).toBeTruthy();
    expect(screen.getByText('ZEPTO Marketplace')).toBeTruthy();
    expect(screen.getByText('Vutukuri Prathyusha')).toBeTruthy();
    expect(screen.queryByText(/^Showing /)).toBeNull();

    await fireEvent.press(
      screen.getByRole('button', { name: 'Save and review 3 transactions' }),
    );
    await waitFor(() => expect(screen.getByText('Review transactions')).toBeTruthy());

    expect(mockDb.txns).toHaveLength(3);
    expect(screen.getByText('3 transactions saved')).toBeTruthy();
    // The money figures on the review step come from the stored rows.
    expect(screen.getByText('₹830.00')).toBeTruthy();
    expect(screen.getByText('₹5,000.00')).toBeTruthy();
    expect(screen.getByText('Revert last import')).toBeTruthy();

    await done(screen);
    expect(screen.getByText('3 transactions imported this session')).toBeTruthy();
  });

  it('opens a review row in the editable transaction sheet', async () => {
    const screen = await render(<ImportScreen />);
    await pickFile(screen, 'Paytm_Jun.xlsx', SECOND_FILE_ROWS);
    await save(screen);

    // Straight off the save: these are stored records, so the app-wide sheet can edit them.
    await fireEvent.press(screen.getByText('Corner Store'));
    const stored = mockDb.txns.find((r) => r.txn.counterpartyName === 'Corner Store');
    expect(mockOpenTxn).toHaveBeenCalledWith(stored?.id);

    // Same again once the list is narrowed to the flagged rows.
    mockOpenTxn.mockReset();
    await fireEvent.press(screen.getByRole('tab', { name: 'Needs review 2' }));
    await waitFor(() => expect(screen.getByText('Needs review')).toBeTruthy());
    await fireEvent.press(screen.getByText('Sri Babu Raju Ram Fuel'));
    const flagged = mockDb.txns.find((r) => r.txn.counterpartyName === 'Sri Babu Raju Ram Fuel');
    expect(mockOpenTxn).toHaveBeenCalledWith(flagged?.id);
  });

  it('opens a read-only detail for a preview row that is not stored yet', async () => {
    const screen = await render(<ImportScreen />);
    await pickFile(screen, 'Paytm_Jun.xlsx', SECOND_FILE_ROWS);

    await fireEvent.press(
      screen.getByRole('button', { name: 'Corner Store, ₹120.00, Pending category' }),
    );

    expect(screen.getByText('PARSED FROM THE STATEMENT')).toBeTruthy();
    expect(screen.getByText('Paid to Corner Store')).toBeTruthy();
    expect(mockOpenTxn).not.toHaveBeenCalled();
    expect(mockDb.txns).toHaveLength(0);
  });

  it('writes nothing when the preview is cancelled, and everything when it saves', async () => {
    const screen = await render(<ImportScreen />);
    await pickFile(screen, 'Paytm_May.xlsx', FIRST_FILE_ROWS);

    await fireEvent.press(
      screen.getByRole('button', { name: 'Cancel import, nothing is saved' }),
    );
    await waitFor(() => expect(screen.getByText('Choose a statement')).toBeTruthy());
    expect(mockDb.txns).toHaveLength(0);
    expect(mockDb.imports).toHaveLength(0);
    expect(mockDb.reconciledKeys).toEqual([]);
    expect(screen.getByText('Nothing imported this session')).toBeTruthy();

    // Re-picking the same file and saving writes the whole batch.
    await pickFile(screen, 'Paytm_May.xlsx', FIRST_FILE_ROWS);
    await save(screen);
    expect(mockDb.txns.map((r) => r.txn.dedupeKey)).toEqual([
      'ref:REF-A1',
      'ref:REF-A2',
      'ref:REF-A3',
    ]);
    expect(mockDb.imports).toHaveLength(1);
  });

  it('filters the review step to the flagged rows without leaving Import', async () => {
    const screen = await render(<ImportScreen />);
    await pickFile(screen, 'Paytm_Jun.xlsx', SECOND_FILE_ROWS);
    await save(screen);

    expect(screen.getByText('Corner Store')).toBeTruthy();
    expect(screen.getByText('Vutukuri Prathyusha')).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: 'Needs review 2' }));
    expect(screen.getByText('Corner Store')).toBeTruthy();
    expect(screen.getByText('Sri Babu Raju Ram Fuel')).toBeTruthy();
    expect(screen.queryByText('Vutukuri Prathyusha')).toBeNull();
  });

  it('keeps the needs-review list reachable on Import after Done and in a new session', async () => {
    const screen = await render(<ImportScreen key="mount-1" />);
    await pickFile(screen, 'Paytm_Jun.xlsx', SECOND_FILE_ROWS);
    await save(screen);
    expect(mockDb.txns.filter((r) => r.needsReview)).toHaveLength(2);

    // Done ends the run on the pick step, which is where the review queue is advertised.
    await done(screen);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Review 2 transactions that need review' }),
    );
    await waitFor(() => expect(screen.getByText('Needs review')).toBeTruthy());
    expect(screen.getByText('Corner Store')).toBeTruthy();
    expect(screen.getByText('Sri Babu Raju Ram Fuel')).toBeTruthy();

    // A fresh session: SESSION_START moves past every stored row, so the session list is empty
    // while the review queue — filtered on the durable flag — is not.
    mockSession.start = new Date(Date.now() + 1000).toISOString();
    await remount(screen, 2);
    await waitFor(() => expect(screen.getByText('Choose a statement')).toBeTruthy());
    expect(screen.getByText('Nothing imported this session')).toBeTruthy();

    await fireEvent.press(
      screen.getByRole('button', { name: 'Review 2 transactions that need review' }),
    );
    await waitFor(() => expect(screen.getByText('Corner Store')).toBeTruthy());
    expect(screen.getByText('Sri Babu Raju Ram Fuel')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'This session 0' })).toBeTruthy();
  });
});
