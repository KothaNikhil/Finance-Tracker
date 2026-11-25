/**
 * Import screen: load a statement and review WHAT YOU JUST IMPORTED. The session list shows only
 * the transactions added THIS session (via a `since` filter on SESSION_START) — the full history
 * lives on the Activity tab. A single import can span years, so period controls let you jump
 * month-by-month. The summary tiles describe the whole current import.
 *
 * The flow is pick → preview → review. The preview owns the save: Cancel there writes nothing, and
 * "Save and review" commits the batch. Review therefore operates on STORED rows, which is what lets
 * a row open the app-wide transaction sheet and be edited. Done ends the run back at pick, so
 * importing several statements in one session is a straight loop.
 *
 * Needs-review work also happens here rather than on Activity. That list is filtered straight from
 * the durable `needs_review` flag, so it is reachable from the pick step after a Done and in a
 * brand-new session, when the session filter matches nothing at all.
 */

import * as Application from 'expo-application';
import { SymbolView } from 'expo-symbols';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { DebugLogScreen } from '@/components/debug-log-screen';
import { EmptyState } from '@/components/empty-state';
import { ImportPreview } from '@/components/import-preview';
import {
  ImportResultFooter,
  ImportResultHeader,
  type ImportResultScope,
  type ImportSavedSummary,
} from '@/components/import-result';
import { ImportStepIndicator } from '@/components/import-step-indicator';
import { ListSection } from '@/components/list-section';
import { ScreenHeader } from '@/components/screen-header';
import { Skeleton } from '@/components/skeleton';
import {
  SupportedFormatsButton,
  SupportedFormatsList,
  SupportedFormatsSheet,
} from '@/components/supported-formats';
import { ThemedText } from '@/components/themed-text';
import { TransactionList } from '@/components/transaction-list';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Opacity, Radius, Spacing } from '@/constants/theme';
import type { MonthKey, TxnFilter } from '@/core/analytics';
import type { TransactionRow } from '@/core/db/schema';
import { readCardStatementMeta } from '@/core/import/adapters/axis-cc';
import { IMPORT_ADAPTERS, IMPORT_FORMATS } from '@/core/import/formats';
import { decryptWorkbook, isEncryptedWorkbook, WrongPasswordError } from '@/core/import/decrypt';
import { isEncryptedPdf, pdfFileKey } from '@/core/import/pdf/decrypt-pdf';
import { parsePdfToSheets } from '@/core/import/pdf/pdf-text';
import { ilog, resetImportLog } from '@/core/import/import-log';
import {
  dryRunImportPreview,
  runImport,
  type ImportDryRun,
  type ImportPreview as ImportPreviewData,
} from '@/core/import/pipeline';
import type { RawRow, SheetLike } from '@/core/import/types';
import { parseXlsxBytes } from '@/core/import/xlsx';
import { useBusyAction } from '@/hooks/use-busy-action';
import { useTheme } from '@/hooks/use-theme';
import { useTransactionDetail } from '@/hooks/use-transaction-detail';
import { useViewOnly } from '@/services/drive/edit-session';
import { useCategoryIndex } from '@/hooks/use-reference-data';
import { useDimensions, useSummary } from '@/hooks/use-analytics';
import { useLastImport, useTransactionList } from '@/hooks/use-transactions';
import { runAnalyticsParityCheck, seedRandomTransactions } from '@/services/db/dev-tools';
import {
  acceptAllReviews,
  clearPendingImport,
  getCategoryIndex,
  getExistingDedupeKeys,
  getLearnedRules,
  getPendingImport,
  reconcileDuplicatesFromImport,
  revertImport,
  saveTransactions,
  setPendingImport,
  type CardStatementMeta,
} from '@/services/db/repository';
import { SESSION_START } from '@/services/session';

/** True when these bytes start with the `%PDF-` magic (a credit-card statement vs an xlsx/xls). */
function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

// The app version shown in the footer, read from the real native build (set automatically by
// android/app/build.gradle from git + build time) — never hand-edited. Falls back to 'dev' in
// environments without a native version (e.g. web / unit tests).
const APP_VERSION = Application.nativeApplicationVersion ?? 'dev';

// A tiny built-in sample (no personal data) for a one-tap demo of import + auto-categorization.
// A mix of tagged rows (categorize confidently), a known merchant (Zepto → Groceries), and
// untagged rows (flagged "Needs review") so the review + Accept-all flow is visible.

const SAMPLE_HEADERS = [
  'Date', 'Time', 'Transaction Details', 'Other Transaction Details (UPI ID or A/c No)',
  'Your Account', 'Amount', 'UPI Ref No.', 'Order ID', 'Remarks', 'Tags', 'Comment',
];
const SAMPLE_ROWS: string[][] = [
  ['29/05/2026', '13:20:00', 'Paid to Zomato Limited', 'zomato@ptys on Paytm', 'Axis Bank - 15', '-450.00', 'R1', '', 'Lunch', '#🥘 Food', ''],
  ['29/05/2026', '09:02:22', 'Received from Vutukuri Prathyusha', '9573438218@ybl on PhonePe', 'Axis Bank - 15', '+5,000.00', 'R2', '', '', '#💵 Money Received', ''],
  ['12/05/2026', '12:48:17', 'Transferred to Self, Axis Bank - 15', '7259131616@ptys on Paytm', 'Axis Bank - 15', '27,000.00', 'R3', '', 'Car emi', '#Car Emi', ''],
  ['12/05/2026', '12:48:57', 'Gold Coin Redemption', '', 'Gold Coins', '-49.75', '', 'O1', '', '#🪙 Investment', ''],
  ['28/05/2026', '19:00:00', 'Paid to ZEPTO Marketplace', 'zepto@axisb on Paytm', 'Axis Bank - 15', '-380.00', 'R4', '', '', '', ''],
  ['30/05/2026', '10:00:00', 'Paid to Corner Store', 'cornerstore@ptys on Paytm', 'Axis Bank - 15', '-120.00', 'R5', '', '', '', ''],
  ['30/05/2026', '18:30:00', 'Money sent to Ravi Kumar', 'ravi@oksbi on Google Pay', 'Axis Bank - 15', '-500.00', 'R6', '', '', '', ''],
];

function buildSampleSheet(): SheetLike {
  const rows: RawRow[] = SAMPLE_ROWS.map((cols, i) => {
    const cells: Record<string, string> = {};
    SAMPLE_HEADERS.forEach((h, idx) => (cells[h] = cols[idx] ?? ''));
    return { cells, rowNumber: i + 2 };
  });
  const matrix = [SAMPLE_HEADERS, ...SAMPLE_ROWS];
  return { name: 'Passbook Payment History', headers: SAMPLE_HEADERS, rows, matrix };
}

type ImportFlowState = 'pick' | 'preview' | 'saving' | 'review';
type ImportOperation = 'reading' | 'unlocking' | 'saving' | null;

interface PreparedImport {
  sheets: SheetLike[];
  fileName: string;
  sourceName: string;
  preview: ImportPreviewData;
  dryRun: ImportDryRun;
  cardMeta: CardStatementMeta | null;
}

export default function ImportScreen() {
  const theme = useTheme();
  const { busy: devBusy, run: runDevAction } = useBusyAction();
  // Tapping a row opens the app-wide transaction detail sheet (mounted at the root).
  const { openTxn } = useTransactionDetail();
  // View only: picking and previewing still work; saving, reverting and dev seeding are disabled.
  const viewOnly = useViewOnly();
  // Which month of the current import is shown; null = the whole import.
  const [selectedMonth, setSelectedMonth] = useState<MonthKey | null>(null);
  // Which step is on screen. `pick` is the screen's home and is never inferred from this session's
  // row count: the device lock unmounts every tab whenever the app returns from the background —
  // which includes the trip through the file picker — so an inferred step would strand the user on
  // the previous import's result and there would be no way to pick a second file.
  const [flowState, setFlowState] = useState<ImportFlowState>('pick');
  // Which saved transactions the review list shows. Both scopes read the database, so neither
  // depends on the import that happens to be in memory.
  const [resultScope, setResultScope] = useState<ImportResultScope>('session');
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  const [saved, setSaved] = useState<ImportSavedSummary | null>(null);
  const [operation, setOperation] = useState<ImportOperation>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  // A picked, password-protected .xlsx waiting for its password. We hold the file's cache URI (not
  // its bytes) so it survives an app-lock reload — the URI is also persisted (see setPendingImport).
  const [locked, setLocked] = useState<{ uri: string; label: string } | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  // The locked file's bytes, read ONCE in processPending and reused by onUnlock — the picker's cache
  // file can be reaped between the pick and the unlock (esp. on Samsung Knox app-lock, which reloads
  // the app after the picker), and re-reading a reaped URI can HANG. Re-populated by the resume path,
  // so it survives the reload too. See the on-device stall diagnosis.
  const lockedBytesRef = useRef<Uint8Array | null>(null);
  // The diagnostic-log viewer (a separate full-screen page); `ilog(...)` still records the trace.
  const [debugOpen, setDebugOpen] = useState(false);
  // The "which statements can I import?" info sheet, opened from the ⓘ button in the header.
  const [formatsOpen, setFormatsOpen] = useState(false);

  // The tiles and the session list are scoped to THIS session's imports; the review queue spans all
  // history, which is what makes it survive a Done and a fresh session.
  const sessionFilter: TxnFilter = { since: SESSION_START };
  const listFilter: TxnFilter =
    resultScope === 'flagged'
      ? { needsReview: true }
      : selectedMonth
        ? { since: SESSION_START, from: selectedMonth, to: selectedMonth }
        : sessionFilter;

  const { rows: txns, loadMore, hasMore, loading } = useTransactionList(listFilter);
  // Tiles + imported count describe THIS session's import (canonical money rules).
  const {
    spentPaise: totalOut,
    receivedPaise: totalIn,
    savedCount,
    loading: summaryLoading,
  } = useSummary(sessionFilter);
  // Review is an app-wide queue: it persists across restarts and stays until each row is
  // categorized or the guesses are accepted — so this count spans ALL data, not just this session.
  const { reviewCount } = useSummary({});
  const { months } = useDimensions(sessionFilter);
  // The last import batch — offered for a one-tap revert (survives restarts, unlike the session).
  const lastImport = useLastImport();

  const index = useCategoryIndex();
  const subNames = useMemo(() => {
    const m = new Map<number, string>();
    index.categories.forEach((c) => c.subcategories.forEach((s) => m.set(s.id, s.name)));
    return m;
  }, [index]);

  const preparePreview = useCallback((sheets: SheetLike[], fileName: string) => {
    // Reads current dedupe/category snapshots, but deliberately performs no writes. Save re-runs
    // dedupe from the original parsed sheets so this preview can safely become stale.
    const preview = runImport(sheets, IMPORT_ADAPTERS, getExistingDedupeKeys());
    const dryRun = dryRunImportPreview(preview, getCategoryIndex(), getLearnedRules());
    const format = IMPORT_FORMATS.find((item) => item.adapter.detect(sheets));
    const sourceName = format?.name ?? (preview.source === 'cc' ? 'Credit card statement' : 'Statement');
    const cardMeta =
      preview.source === 'cc' && sheets[0]?.pdfLines
        ? readCardStatementMeta(sheets[0].pdfLines)
        : null;

    ilog(
      `preview: source=${preview.source} rows=${preview.totalRows} new=${preview.newTxns.length} dupes=${preview.duplicates.length} review=${dryRun.reviewCount}`,
    );
    setPrepared({ sheets, fileName, sourceName, preview, dryRun, cardMeta });
    setSaved(null);
    setInlineError(null);
    setFlowState('preview');
  }, []);

  const onAddSample = useCallback(
    () => preparePreview([buildSampleSheet()], 'Sample statement.xlsx'),
    [preparePreview],
  );

  // DEV-only scale/correctness helpers (compiled out of release via __DEV__).
  const onSeed = useCallback(
    () =>
      runDevAction(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0)); // let the spinner paint
        const n = seedRandomTransactions(20000);
        Alert.alert('Seeded', `Inserted ${n} synthetic transactions.`);
      }),
    [runDevAction],
  );
  const onParity = useCallback(() => {
    const r = runAnalyticsParityCheck({});
    Alert.alert(r.ok ? 'Parity OK ✓' : 'Parity MISMATCH ✗', JSON.stringify(r, null, 2));
  }, []);

  // Process a picked file from its cache URI: read it, and either import it or (if it's a
  // password-protected .xlsx) show the unlock prompt. Runs both for a fresh pick and when resuming
  // after an app-lock reload — so it must be idempotent and read from the persisted URI.
  const processPending = useCallback(
    async (uri: string, label: string) => {
      setOperation('reading');
      setInlineError(null);
      setUnlockError(null);
      try {
        ilog(`processPending: label="${label}" uri=${uri.slice(0, 24)}…`);
        // Yield a frame so progress paints before synchronous format detection/parsing starts.
        await new Promise((resolve) => setTimeout(resolve, 0));
        ilog('processPending: reading file bytes…');
        const bytes = new Uint8Array(await new File(uri).arrayBuffer());
        ilog(
          `processPending: read ${bytes.length} bytes (magic ${bytes[0]},${bytes[1]},${bytes[2]},${bytes[3]})`,
        );

        // Credit-card statements are PDFs; bank/Paytm statements are xlsx/xls (CFB when locked).
        if (isPdfBytes(bytes)) {
          const encrypted = isEncryptedPdf(bytes);
          ilog(`processPending: PDF detected, encrypted=${encrypted}`);
          if (encrypted) {
            lockedBytesRef.current = bytes;
            setLocked({ uri, label });
            return;
          }
          preparePreview(parsePdfToSheets(bytes), label);
          return;
        }
        if (isEncryptedWorkbook(bytes)) {
          // Keep the marker set: an app-lock reload returns to this prompt from the cached URI.
          lockedBytesRef.current = bytes;
          setLocked({ uri, label });
          return;
        }
        preparePreview(parseXlsxBytes(bytes), label);
        // The pending marker intentionally survives through Preview. A reload reparses this cached
        // file, while Save or Cancel clears it.
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ilog(`processPending: ERROR ${message}`);
        clearPendingImport();
        lockedBytesRef.current = null;
        setLocked(null);
        setPrepared(null);
        setFlowState('pick');
        setInlineError(message);
      } finally {
        setOperation(null);
      }
    },
    [preparePreview],
  );

  const onImportFile = useCallback(async () => {
    setInlineError(null);
    let res: DocumentPicker.DocumentPickerResult;
    try {
      // expo-document-picker copies the file to our cache and gives a stable URI we can re-read.
      res = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
          'application/vnd.ms-excel', // .xls (older banks, e.g. Axis, export this)
          'application/pdf', // credit-card statements
          'application/octet-stream',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
    } catch (err) {
      setInlineError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    const label = asset.name ?? 'statement';
    resetImportLog();
    ilog(`picked: name="${asset.name}" mime=${asset.mimeType} size=${asset.size} uriScheme=${asset.uri.split(':')[0]}`);
    // Persist BEFORE we might lose focus: a Samsung Knox app-lock re-auth can reload the app on
    // return from the picker, wiping memory. The marker lets us resume from the cached file.
    setPendingImport(asset.uri, label);
    void processPending(asset.uri, label);
  }, [processPending]);

  // Resume a pending import left over from an app-lock reload (runs once on mount).
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const pending = getPendingImport();
    if (!pending) return;
    // Resume after the effect has synchronized; processPending owns the visible progress state.
    setTimeout(() => void processPending(pending.uri, pending.label), 0);
  }, [processPending]);

  // Unlock a password-protected file, then import it. Wrong password reopens the prompt.
  const onUnlock = useCallback(
    async (password: string) => {
      if (!locked || operation === 'unlocking') return;
      const { uri, label } = locked;
      setOperation('unlocking');
      setUnlockError(null);
      ilog('onUnlock: start');
      try {
        // Yield a frame so decryption progress paints before spin-count key derivation starts.
        await new Promise((resolve) => setTimeout(resolve, 0));
        // Prefer bytes already read in processPending. Re-reading a reaped picker URI can hang on
        // app-lock-managed devices, so disk is only a fallback after a process reload.
        let bytes = lockedBytesRef.current;
        if (bytes) {
          ilog(`onUnlock: using ${bytes.length} in-memory bytes`);
        } else {
          ilog('onUnlock: no cached bytes, reading file…');
          bytes = new Uint8Array(await new File(uri).arrayBuffer());
          ilog(`onUnlock: read ${bytes.length} bytes`);
        }

        const yieldFrame = () => new Promise((resolve) => setTimeout(resolve, 0));
        if (isPdfBytes(bytes)) {
          ilog('onUnlock: deriving PDF key…');
          await yieldFrame();
          const key = pdfFileKey(bytes, password);
          ilog('onUnlock: parsing unlocked PDF…');
          await yieldFrame();
          preparePreview(parsePdfToSheets(bytes, key), label);
        } else {
          ilog('onUnlock: decrypting workbook…');
          await yieldFrame();
          const decrypted = decryptWorkbook(bytes, password);
          preparePreview(parseXlsxBytes(decrypted), label);
        }
        lockedBytesRef.current = null;
        setLocked(null);
        ilog('onUnlock: preview ready');
      } catch (err) {
        ilog(
          `onUnlock: ERROR ${
            err instanceof Error ? `${err.name}: ${err.message}` : String(err)
          }`,
        );
        if (err instanceof WrongPasswordError) {
          // Keep the overlay, bytes, and pending marker so the user can retry in place.
          setUnlockError('Incorrect password. Check it and try again.');
        } else {
          const message = err instanceof Error ? err.message : String(err);
          clearPendingImport();
          lockedBytesRef.current = null;
          setLocked(null);
          setFlowState('pick');
          setInlineError(message);
        }
      } finally {
        setOperation(null);
      }
    },
    [locked, operation, preparePreview],
  );

  const onCancelUnlock = useCallback(() => {
    clearPendingImport();
    lockedBytesRef.current = null;
    setLocked(null);
    setUnlockError(null);
    setOperation(null);
  }, []);

  // The last point at which nothing has been written. Cancel here discards only a re-derivable
  // parse, so it needs no confirmation.
  const onCancelPreview = useCallback(() => {
    clearPendingImport();
    lockedBytesRef.current = null;
    setPrepared(null);
    setInlineError(null);
    setFlowState('pick');
  }, []);

  const onSaveAndReview = useCallback(async () => {
    if (!prepared || operation === 'saving') return;
    setFlowState('saving');
    setOperation('saving');
    setInlineError(null);
    try {
      // Final re-dedupe uses the original parsed sheets and a fresh database key snapshot. This
      // handles another import/save landing between Preview and this confirmation.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const finalPreview = runImport(
        prepared.sheets,
        IMPORT_ADAPTERS,
        getExistingDedupeKeys(),
      );
      const addedCount = saveTransactions(
        finalPreview.newTxns,
        prepared.fileName,
        prepared.cardMeta,
      );
      const reconciled = reconcileDuplicatesFromImport(finalPreview.duplicates);

      clearPendingImport();
      lockedBytesRef.current = null;
      setSaved({
        fileName: prepared.fileName,
        savedCount: addedCount,
        duplicatesChecked: finalPreview.duplicates.length,
        duplicatesUpdated: reconciled.updated,
        duplicatesFlagged: reconciled.flagged,
      });
      setPrepared(null);
      setSelectedMonth(null);
      setResultScope('session');
      setFlowState('review');
      ilog(
        `save: added=${addedCount} dupes=${finalPreview.duplicates.length} updated=${reconciled.updated} flagged=${reconciled.flagged}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ilog(`save: ERROR ${message}`);
      setInlineError(message);
      setFlowState('preview');
    } finally {
      setOperation(null);
    }
  }, [operation, prepared]);

  const onDoneReview = useCallback(() => {
    clearPendingImport();
    lockedBytesRef.current = null;
    setPrepared(null);
    setSaved(null);
    setInlineError(null);
    setUnlockError(null);
    setSelectedMonth(null);
    setFlowState('pick');
  }, []);

  const onViewSession = useCallback(() => {
    setSaved(null);
    setResultScope('session');
    setFlowState('review');
  }, []);

  const onViewFlagged = useCallback(() => {
    setSaved(null);
    setResultScope('flagged');
    setFlowState('review');
  }, []);

  const onAcceptAll = useCallback(() => {
    if (reviewCount === 0) return;
    Alert.alert(
      'Accept all suggestions?',
      `Clears the “Needs review” flag on ${reviewCount} transaction(s), keeping the auto-picked categories. You can still edit any of them later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Accept all', onPress: () => acceptAllReviews() },
      ],
    );
  }, [reviewCount]);

  const onRevertLast = useCallback(() => {
    if (!lastImport) return;
    const label = lastImport.sourceLabel.trim() || 'the last import';
    const n = lastImport.addedCount;
    Alert.alert(
      'Revert this import?',
      `Permanently deletes all ${n} transaction${n === 1 ? '' : 's'} added by ${lastImport.fileCount > 1 ? `${lastImport.fileCount} files imported together (${label})` : `“${label}”`} — including any you’ve since edited, categorized, split, or attached to a loan. This can’t be undone. (Duplicates it merely merged into earlier imports are kept.)`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete all',
          style: 'destructive',
          onPress: () => {
            const removed = revertImport(lastImport.id);
            setSaved(null);
            setSelectedMonth(null);
            // Nothing left from this session to look at → back to the pick step. The review queue
            // spans every import, so it stays worth showing.
            const empty = resultScope === 'session' && removed >= savedCount;
            setFlowState(empty ? 'pick' : 'review');
            Alert.alert('Import reverted', `Removed ${removed} transaction${removed === 1 ? '' : 's'}.`);
          },
        },
      ],
    );
  }, [lastImport, resultScope, savedCount]);

  const previewOpen = prepared != null && (flowState === 'preview' || flowState === 'saving');
  const reviewOpen = !previewOpen && flowState === 'review';
  const actionsDisabled = operation != null || devBusy;

  const landing = (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.landingContent}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        title="Import statement"
        action={<SupportedFormatsButton onPress={() => setFormatsOpen(true)} />}
      />
      <ImportStepIndicator current="file" />

      <Card style={styles.pickerCard}>
        <View style={[styles.uploadIcon, { backgroundColor: theme.accentMuted }]}>
          <ThemedText type="heading" style={{ color: theme.accent }}>
            ↑
          </ThemedText>
        </View>
        <ThemedText type="heading" style={styles.centerText}>
          Choose a statement
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary" style={styles.centerText}>
          Import .xlsx, .xls, or .pdf from your device.
        </ThemedText>
        <Button
          label="Choose file"
          variant="primary"
          onPress={onImportFile}
          disabled={actionsDisabled}
          loading={operation === 'reading'}
          style={styles.fullWidth}
          accessibilityHint="Opens the system document picker"
        />
        <ThemedText type="caption" themeColor="textSecondary" style={styles.centerText}>
          ▣ Your financial data is processed on this device.
        </ThemedText>
      </Card>

      {operation === 'reading' ? (
        <Card tone="accent" style={styles.progressCard}>
          <ActivityIndicator color={theme.accent} />
          <View style={styles.grow}>
            <ThemedText type="smallEmphasis">Reading statement</ThemedText>
            <ThemedText
              type="caption"
              themeColor="textSecondary"
              accessibilityLiveRegion="polite"
            >
              Detecting the format, reconciling totals, and preparing a safe preview…
            </ThemedText>
          </View>
        </Card>
      ) : null}

      {inlineError && !previewOpen ? (
        <Card tone="danger" style={styles.errorCard}>
          <ThemedText type="smallEmphasis" style={{ color: theme.spend }}>
            Could not prepare this statement
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
            {inlineError}
          </ThemedText>
          <Button
            label="Choose another file"
            variant="secondary"
            onPress={onImportFile}
            disabled={actionsDisabled}
          />
        </Card>
      ) : null}

      <View style={styles.section}>
        <ThemedText type="overline" themeColor="textSecondary">
          Supported statements
        </ThemedText>
        <SupportedFormatsList />
      </View>

      <ListSection title="IMPORT STATUS">
        {summaryLoading ? (
          <View style={styles.sessionRow}>
            <Skeleton width={30} height={30} radius={Radius.pill} />
            <View style={styles.grow}>
              <Skeleton width="62%" height={12} />
              <Skeleton width="84%" height={10} style={styles.sessionSkeletonLine} />
            </View>
          </View>
        ) : savedCount > 0 ? (
          <SessionRow
            glyph="✓"
            glyphColor={theme.accent}
            glyphBackground={theme.accentMuted}
            title={`${savedCount} transaction${savedCount === 1 ? '' : 's'} imported this session`}
            detail="View the session list and review status."
            onPress={onViewSession}
            accessibilityLabel={`View ${savedCount} transactions imported this session`}
          />
        ) : (
          <SessionRow
            glyph="◷"
            glyphColor={theme.textSecondary}
            glyphBackground={theme.backgroundSelected}
            title="Nothing imported this session"
            detail="Your saved history is available in Activity."
          />
        )}

        {reviewCount > 0 ? (
          <SessionRow
            glyph="!"
            glyphColor={theme.review}
            glyphBackground={theme.reviewMuted}
            title={`${reviewCount} transaction${reviewCount === 1 ? '' : 's'} need review`}
            detail="Categorize them here, across every import."
            onPress={onViewFlagged}
            accessibilityLabel={`Review ${reviewCount} transactions that need review`}
          />
        ) : null}

        {lastImport ? (
          <SessionRow
            kind="action"
            glyph="↶"
            glyphColor={theme.spend}
            glyphBackground={theme.spendMuted}
            title="Revert last import"
            detail={`${lastImport.sourceLabel || 'Last import'} · ${lastImport.addedCount} added · ${lastImport.importedAt.slice(0, 10)}`}
            onPress={onRevertLast}
            disabled={viewOnly}
            accessibilityLabel={`Revert last import, ${lastImport.sourceLabel}, ${lastImport.addedCount} transactions`}
            accessibilityHint="Opens a destructive confirmation"
          />
        ) : null}
      </ListSection>

      <Pressable
        onPress={() => setDebugOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Open import diagnostics"
        style={({ pressed }) => [styles.diagnosticsLink, { opacity: pressed ? 0.6 : 1 }]}
      >
        <ThemedText type="small" style={{ color: theme.accent }}>
          ⓘ Import diagnostics
        </ThemedText>
      </Pressable>

      {__DEV__ ? (
        <Card tone="subtle" style={styles.devCard}>
          <ThemedText type="overline" themeColor="textSecondary">
            Development helpers
          </ThemedText>
          <View style={styles.actions}>
            <Button
              label="Add sample"
              onPress={onAddSample}
              disabled={actionsDisabled || viewOnly}
              style={styles.grow}
            />
            <Button
              label="Seed 20k"
              onPress={onSeed}
              disabled={actionsDisabled || viewOnly}
              loading={devBusy}
              style={styles.grow}
            />
          </View>
          <Button
            label="Check analytics parity"
            variant="ghost"
            onPress={onParity}
            disabled={actionsDisabled}
          />
        </Card>
      ) : null}

      <ThemedText type="caption" themeColor="textSecondary" style={styles.centerText}>
        Finance Tracker v{APP_VERSION}
      </ThemedText>
    </ScrollView>
  );

  const reviewHeader = (
    <ImportResultHeader
      saved={saved}
      sessionCount={savedCount}
      spentPaise={totalOut}
      receivedPaise={totalIn}
      reviewCount={reviewCount}
      lastImport={
        lastImport
          ? {
              sourceLabel: lastImport.sourceLabel,
              addedCount: lastImport.addedCount,
              importedAt: lastImport.importedAt,
            }
          : null
      }
      months={months}
      selectedMonth={selectedMonth}
      scope={resultScope}
      onSelectMonth={setSelectedMonth}
      onScopeChange={setResultScope}
      onDone={onDoneReview}
      onAcceptAll={onAcceptAll}
      onRevert={onRevertLast}
    />
  );

  const reviewFooter = (
    <View>
      <ImportResultFooter appVersion={APP_VERSION} />
      <Pressable
        onPress={() => setDebugOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Open import diagnostics"
        style={({ pressed }) => [styles.diagnosticsLink, { opacity: pressed ? 0.6 : 1 }]}
      >
        <ThemedText type="small" style={{ color: theme.accent }}>
          ⓘ Import diagnostics
        </ThemedText>
      </Pressable>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {previewOpen && prepared ? (
          <ImportPreview
            fileName={prepared.fileName}
            sourceName={prepared.sourceName}
            preview={prepared.preview}
            dryRun={prepared.dryRun}
            saving={flowState === 'saving'}
            error={inlineError}
            onBack={onCancelPreview}
            onCancel={onCancelPreview}
            onSave={() => void onSaveAndReview()}
          />
        ) : reviewOpen ? (
          <TransactionList
            rows={txns}
            loading={loading}
            hasMore={hasMore}
            loadMore={loadMore}
            onPressRow={openTxn}
            categoryLabelFor={(txn) => categoryLabel(txn, index.byId, subNames)}
            showReviewBadge
            ListHeaderComponent={reviewHeader}
            ListFooterComponent={reviewFooter}
            ListEmptyComponent={
              <EmptyState
                style={styles.empty}
                title={
                  resultScope === 'flagged'
                    ? 'Nothing needs review'
                    : 'No session transactions to show'
                }
                message={
                  resultScope === 'flagged'
                    ? 'Every imported transaction has a category you have accepted.'
                    : 'Import a statement to add transactions to this session.'
                }
              />
            }
            contentContainerStyle={styles.listContent}
          />
        ) : (
          landing
        )}
      </SafeAreaView>

      {/* Inline overlay (NOT a React Native <Modal>): a separate-window Modal can be dropped when
          Samsung Knox App Lock re-authenticates and recreates the activity after the file picker.
          Rendering in the screen's own view tree keeps the prompt reliably on screen. */}
      {locked && (
        <PasswordPrompt
          label={locked.label}
          busy={operation === 'unlocking'}
          error={unlockError}
          onCancel={onCancelUnlock}
          onSubmit={onUnlock}
        />
      )}

      {/* Diagnostic-log page (separate full-screen view), opened from the "Debug logs" link. */}
      <DebugLogScreen visible={debugOpen} onClose={() => setDebugOpen(false)} />

      {/* "Which statements can I import?" — the supported-formats legend, on demand (ⓘ in header). */}
      <SupportedFormatsSheet visible={formatsOpen} onClose={() => setFormatsOpen(false)} />
    </ThemedView>
  );
}

/**
 * Password entry for a locked statement, rendered inline (an absolutely-positioned overlay in the
 * screen's own view tree) rather than a React Native <Modal>. A <Modal> is a separate OS window
 * that can be dropped when Samsung Knox App Lock re-authenticates and recreates the activity right
 * after the file picker; an inline overlay stays put. Holds its own text state.
 */
function PasswordPrompt({
  label,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  label: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  const theme = useTheme();
  const [pw, setPw] = useState('');
  return (
    // Lift the centered card above the keyboard. Both platforms: iOS never resizes for the keyboard,
    // and this app is edge-to-edge so Android doesn't resize the window under the keyboard either.
    <KeyboardAvoidingView
      style={[styles.overlay, { backgroundColor: theme.overlay }]}
      behavior="padding"
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onCancel}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Cancel unlock"
      />
      <ThemedView
        type="backgroundElement"
        style={[styles.pwCard, { borderColor: theme.border }]}
      >
        <View style={[styles.lockIcon, { backgroundColor: theme.accentMuted }]}>
          <ThemedText type="smallEmphasis" style={{ color: theme.accent }}>
            ▣
          </ThemedText>
        </View>
        <ThemedText type="heading">Unlock statement</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          “{label}” is password-protected. Enter its password to prepare the import preview.
        </ThemedText>
        <TextInput
          value={pw}
          onChangeText={setPw}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          editable={!busy}
          accessibilityLabel="Statement password"
          returnKeyType="done"
          onSubmitEditing={() => pw !== '' && !busy && onSubmit(pw)}
          style={[styles.pwInput, { color: theme.text, backgroundColor: theme.background, borderColor: theme.border }]}
        />
        {error ? (
          <ThemedText type="small" style={{ color: theme.spend }} accessibilityLiveRegion="polite">
            {error}
          </ThemedText>
        ) : null}
        {busy ? (
          <View style={styles.progressCard} accessibilityLiveRegion="polite">
            <ActivityIndicator color={theme.accent} />
            <ThemedText type="small" themeColor="textSecondary">
              Unlocking and reading statement…
            </ThemedText>
          </View>
        ) : null}
        <ThemedText type="caption" themeColor="textSecondary">
          The password and file contents stay on this device.
        </ThemedText>
        <View style={styles.actions}>
          <Button
            label="Cancel"
            variant="secondary"
            onPress={onCancel}
            disabled={busy}
            style={styles.grow}
          />
          <Button
            label="Unlock"
            variant="primary"
            onPress={() => onSubmit(pw)}
            disabled={pw === ''}
            loading={busy}
            style={styles.grow}
          />
        </View>
      </ThemedView>
    </KeyboardAvoidingView>
  );
}

function SessionRow({
  kind = 'navigation',
  glyph,
  glyphColor,
  glyphBackground,
  title,
  detail,
  onPress,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
}: {
  /** Only a row that leads somewhere carries a chevron; an `action` row runs in place. */
  kind?: 'navigation' | 'action';
  glyph: string;
  glyphColor: string;
  glyphBackground: string;
  title: string;
  detail: string;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  const body = (
    <>
      <View style={[styles.smallIcon, { backgroundColor: glyphBackground }]}>
        <ThemedText type="smallEmphasis" style={{ color: glyphColor }}>
          {glyph}
        </ThemedText>
      </View>
      <View style={styles.grow}>
        <ThemedText type="label" numberOfLines={1}>
          {title}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
          {detail}
        </ThemedText>
      </View>
      {onPress && kind === 'navigation' ? (
        <SymbolView
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          size={15}
          tintColor={theme.textSecondary}
        />
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel} style={styles.sessionRow}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.sessionRow,
        { opacity: disabled ? Opacity.disabled : pressed ? 0.6 : 1 },
      ]}
    >
      {body}
    </Pressable>
  );
}

/** Build the "🍽️ Food & Dining · Restaurant" label for a transaction. */
function categoryLabel(
  txn: TransactionRow,
  byId: Map<number, { name: string; emoji: string | null }>,
  subNames: Map<number, string>,
): string | null {
  if (txn.categoryId == null) return null;
  const cat = byId.get(txn.categoryId);
  if (!cat) return null;
  const sub = txn.subcategoryId != null ? subNames.get(txn.subcategoryId) : null;
  return `${cat.emoji ? cat.emoji + ' ' : ''}${cat.name}${sub ? ` · ${sub}` : ''}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth },
  fill: { flex: 1 },
  landingContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.two,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  pickerCard: { alignItems: 'center', gap: Spacing.one },
  uploadIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerText: { textAlign: 'center' },
  fullWidth: { alignSelf: 'stretch', marginTop: Spacing.one },
  progressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  errorCard: { gap: Spacing.one },
  section: { gap: Spacing.one },
  sessionRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  sessionSkeletonLine: { marginTop: Spacing.half },
  smallIcon: {
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diagnosticsLink: {
    minHeight: 44,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  devCard: { gap: Spacing.two },
  actions: { flexDirection: 'row', gap: Spacing.two },
  grow: { flex: 1 },
  empty: { marginTop: Spacing.three },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
    zIndex: 20,
  },
  pwCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  lockIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pwInput: {
    minHeight: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
    marginTop: Spacing.one,
  },
});
