/**
 * Import screen: load a Paytm statement and review WHAT YOU JUST IMPORTED. It shows only the
 * transactions added THIS session (via a `since` filter on SESSION_START) — the full history lives
 * on the Reports tab. A single import can span years, so a {@link PeriodTabs} bar lets you jump
 * month-by-month (with a year row when the import spans multiple years). The summary tiles describe
 * the whole current import.
 */

import * as Application from 'expo-application';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { PeriodTabs } from '@/components/period-tabs';
import { StatTile } from '@/components/stat-tile';
import { ThemedText } from '@/components/themed-text';
import { TransactionList } from '@/components/transaction-list';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import type { MonthKey, TxnFilter } from '@/core/analytics';
import type { TransactionRow } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { axisAdapter } from '@/core/import/adapters/axis';
import { axisCcAdapter, readCardStatementMeta } from '@/core/import/adapters/axis-cc';
import { kvbAdapter } from '@/core/import/adapters/kvb';
import { paytmAdapter } from '@/core/import/adapters/paytm';
import { sbiAdapter } from '@/core/import/adapters/sbi';
import { decryptWorkbook, isEncryptedWorkbook, WrongPasswordError } from '@/core/import/decrypt';
import { isEncryptedPdf, pdfFileKey } from '@/core/import/pdf/decrypt-pdf';
import { parsePdfToSheets } from '@/core/import/pdf/pdf-text';
import { ilog, resetImportLog, subscribeImportLog } from '@/core/import/import-log';
import { runImport } from '@/core/import/pipeline';
import type { RawRow, SheetLike } from '@/core/import/types';
import { parseXlsxBytes } from '@/core/import/xlsx';
import { useBusyAction } from '@/hooks/use-busy-action';
import { useTheme } from '@/hooks/use-theme';
import { useTransactionDetail } from '@/hooks/use-transaction-detail';
import { useCategoryIndex } from '@/hooks/use-reference-data';
import { useDimensions, useSummary } from '@/hooks/use-analytics';
import { useLastImport, useTransactionList } from '@/hooks/use-transactions';
import { runAnalyticsParityCheck, seedRandomTransactions } from '@/services/db/dev-tools';
import {
  acceptAllReviews,
  clearPendingImport,
  getExistingDedupeKeys,
  getPendingImport,
  reconcileDuplicatesFromImport,
  revertImport,
  saveTransactions,
  setPendingImport,
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

export default function ImportScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { busy, run } = useBusyAction();
  // Tapping a row opens the app-wide transaction detail sheet (mounted at the root).
  const { openTxn } = useTransactionDetail();
  // Which month of the current import is shown; null = the whole import.
  const [selectedMonth, setSelectedMonth] = useState<MonthKey | null>(null);
  // A picked, password-protected .xlsx waiting for its password. We hold the file's cache URI (not
  // its bytes) so it survives an app-lock reload — the URI is also persisted (see setPendingImport).
  const [locked, setLocked] = useState<{ uri: string; label: string } | null>(null);
  // The locked file's bytes, read ONCE in processPending and reused by onUnlock — the picker's cache
  // file can be reaped between the pick and the unlock (esp. on Samsung Knox app-lock, which reloads
  // the app after the picker), and re-reading a reaped URI can HANG. Re-populated by the resume path,
  // so it survives the reload too. See the on-device stall diagnosis.
  const lockedBytesRef = useRef<Uint8Array | null>(null);
  // TEMP: on-screen tail of the import diagnostic log (see core/import/import-log).
  const [logLines, setLogLines] = useState<string[]>([]);
  useEffect(() => subscribeImportLog(setLogLines), []);

  // Everything on this screen is scoped to THIS session's imports.
  const sessionFilter: TxnFilter = { since: SESSION_START };
  const listFilter: TxnFilter = selectedMonth
    ? { since: SESSION_START, from: selectedMonth, to: selectedMonth }
    : sessionFilter;

  const { rows: txns, loadMore, hasMore, loading } = useTransactionList(listFilter);
  // Tiles + imported count describe THIS session's import (canonical money rules).
  const { spentPaise: totalOut, receivedPaise: totalIn, savedCount } = useSummary(sessionFilter);
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

  const commit = useCallback(
    (sheets: SheetLike[], sourceLabel: string) => {
      const preview = runImport(
        sheets,
        [paytmAdapter, axisAdapter, kvbAdapter, sbiAdapter, axisCcAdapter],
        getExistingDedupeKeys(),
      );
      ilog(`commit: source=${preview.source} rows=${preview.totalRows} new=${preview.newTxns.length} dupes=${preview.duplicates.length}`);
      // For a credit-card statement, capture the card/month/total-due so the batch can later be
      // linked to the bank bill-payment that settled it (Phase B). Null for every other source.
      const cardMeta =
        preview.source === 'cc' && sheets[0]?.pdfLines ? readCardStatementMeta(sheets[0].pdfLines) : null;
      // Duplicates (same UPI ref already stored from the other statement) can still be reconciled:
      // filling a category/tag where they agree, or flagging review where a tag disagrees with our
      // category. So a Save is worthwhile even with 0 brand-new rows.
      const save = () =>
        run(
          async () => {
            // Yield a frame so the spinner paints before the synchronous DB write blocks the thread.
            await new Promise((resolve) => setTimeout(resolve, 0));
            const n = saveTransactions(preview.newTxns, sourceLabel, cardMeta);
            const { updated, flagged } = reconcileDuplicatesFromImport(preview.duplicates);
            const parts = [`${n} new transaction(s) saved from ${sourceLabel} and auto-categorized.`];
            if (updated > 0) parts.push(`${updated} matching row(s) already imported were updated.`);
            if (flagged > 0)
              parts.push(`${flagged} row(s) were flagged for review — a Paytm tag disagreed with the category, so you decide.`);
            parts.push('Anything the app was unsure about is flagged “Needs review”.');
            Alert.alert('Imported', parts.join(' '));
          },
          { errorTitle: 'Could not save import' },
        );
      // Reconciliation tally so you can check totals against the statement. `errors` are rows that
      // weren't transactions at all; anything unreadable-but-real was salvaged into `newTxns`.
      const lines = [
        `Found ${preview.totalRows} rows`,
        `New: ${preview.newTxns.length}`,
        `Duplicates (checked for tag conflicts): ${preview.duplicates.length}`,
        `Total debit: ${formatINR(preview.totalDebitPaise)}`,
        `Total credit: ${formatINR(preview.totalCreditPaise)}`,
      ];
      if (preview.salvaged.length > 0) lines.push(`Couldn’t fully read (saved for review): ${preview.salvaged.length}`);
      if (preview.errors.length > 0) lines.push(`Skipped non-transaction rows: ${preview.errors.length}`);
      Alert.alert(
        'Import preview',
        lines.join('\n'),
        preview.newTxns.length > 0 || preview.duplicates.length > 0
          ? [{ text: 'Cancel', style: 'cancel' }, { text: 'Save', onPress: save }]
          : [{ text: 'OK' }],
      );
    },
    [run],
  );

  const onAddSample = useCallback(() => commit([buildSampleSheet()], 'the sample'), [commit]);

  // DEV-only scale/correctness helpers (compiled out of release via __DEV__).
  const onSeed = useCallback(
    () =>
      run(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0)); // let the spinner paint
        const n = seedRandomTransactions(20000);
        Alert.alert('Seeded', `Inserted ${n} synthetic transactions.`);
      }),
    [run],
  );
  const onParity = useCallback(() => {
    const r = runAnalyticsParityCheck({});
    Alert.alert(r.ok ? 'Parity OK ✓' : 'Parity MISMATCH ✗', JSON.stringify(r, null, 2));
  }, []);

  // Process a picked file from its cache URI: read it, and either import it or (if it's a
  // password-protected .xlsx) show the unlock prompt. Runs both for a fresh pick and when resuming
  // after an app-lock reload — so it must be idempotent and read from the persisted URI.
  const processPending = useCallback(
    (uri: string, label: string) => {
      run(
        async () => {
          ilog(`processPending: label="${label}" uri=${uri.slice(0, 24)}…`);
          // Yield a frame so the spinner paints before the synchronous parse blocks the thread.
          await new Promise((resolve) => setTimeout(resolve, 0));
          let bytes: Uint8Array;
          try {
            ilog('processPending: reading file bytes…');
            bytes = new Uint8Array(await new File(uri).arrayBuffer());
            ilog(`processPending: read ${bytes.length} bytes (magic ${bytes[0]},${bytes[1]},${bytes[2]},${bytes[3]})`);
          } catch (err) {
            ilog(`processPending: FILE READ FAILED: ${err instanceof Error ? err.message : String(err)}`);
            clearPendingImport(); // the cache file is gone — drop the marker so we don't loop
            throw err;
          }
          // Credit-card statements are PDFs; bank/Paytm statements are xlsx/xls (CFB when locked).
          if (isPdfBytes(bytes)) {
            const enc = isEncryptedPdf(bytes);
            ilog(`processPending: PDF detected, encrypted=${enc}`);
            if (enc) {
              lockedBytesRef.current = bytes; // reuse in onUnlock — don't re-read the (reapable) URI
              setLocked({ uri, label });
              return;
            }
            clearPendingImport();
            commit(parsePdfToSheets(bytes), label);
            return;
          }
          if (isEncryptedWorkbook(bytes)) {
            // Keep the marker set: if the app is reloaded by the lock, we resume this prompt.
            lockedBytesRef.current = bytes; // reuse in onUnlock — don't re-read the (reapable) URI
            setLocked({ uri, label });
            return;
          }
          clearPendingImport();
          commit(parseXlsxBytes(bytes), label);
        },
        { errorTitle: 'Could not import' },
      );
    },
    [commit, run],
  );

  const onImportFile = useCallback(async () => {
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
      Alert.alert('Could not import', err instanceof Error ? err.message : String(err));
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
    processPending(asset.uri, label);
  }, [processPending]);

  // Resume a pending import left over from an app-lock reload (runs once on mount).
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const pending = getPendingImport();
    if (pending) processPending(pending.uri, pending.label);
  }, [processPending]);

  // Unlock a password-protected file, then import it. Wrong password reopens the prompt.
  const onUnlock = useCallback(
    (password: string) => {
      if (!locked) return;
      const { uri, label } = locked;
      setLocked(null);
      run(
        async () => {
          ilog('onUnlock: start');
          // Yield a frame so the spinner paints — decryption (spin-count key derivation) is heavy.
          await new Promise((resolve) => setTimeout(resolve, 0));
          // Prefer the bytes we already read in processPending — re-reading the URI here can HANG if
          // the picker's cache file was reaped (the on-device stall). Only touch disk as a fallback.
          let bytes = lockedBytesRef.current;
          if (bytes) {
            ilog(`onUnlock: using ${bytes.length} in-memory bytes`);
          } else {
            try {
              ilog('onUnlock: no cached bytes, reading file…');
              bytes = new Uint8Array(await new File(uri).arrayBuffer());
              ilog(`onUnlock: read ${bytes.length} bytes`);
            } catch {
              ilog('onUnlock: FILE READ FAILED (file gone)');
              clearPendingImport();
              Alert.alert('Couldn’t unlock', 'The file is no longer available — please pick it again.');
              return;
            }
          }
          // Yield to the UI before each heavy synchronous step so the on-screen log paints the step's
          // label first — whichever label is the LAST one visible when the spinner sticks is the
          // stage that blocked (the JS thread can't repaint mid-block).
          const yieldFrame = () => new Promise((r) => setTimeout(r, 0));
          try {
            if (isPdfBytes(bytes)) {
              ilog('onUnlock: deriving key (pdfFileKey)…');
              await yieldFrame();
              // Verify + derive the key (throws WrongPasswordError on a bad password), then parse.
              const key = pdfFileKey(bytes, password);
              ilog('onUnlock: key derived, parsing PDF…');
              await yieldFrame();
              const sheets = parsePdfToSheets(bytes, key);
              ilog('onUnlock: parsed, committing…');
              await yieldFrame();
              clearPendingImport();
              commit(sheets, label);
              ilog('onUnlock: commit returned');
            } else {
              const decrypted = decryptWorkbook(bytes, password);
              clearPendingImport();
              commit(parseXlsxBytes(decrypted), label);
            }
          } catch (err) {
            ilog(`onUnlock: ERROR ${err instanceof Error ? err.name + ': ' + err.message : String(err)}`);
            if (err instanceof WrongPasswordError) {
              setLocked({ uri, label }); // reopen so they can retry (marker still set)
              Alert.alert('Incorrect password', 'That password didn’t unlock the file. Please try again.');
            } else {
              clearPendingImport();
              Alert.alert('Couldn’t unlock', err instanceof Error ? err.message : String(err));
            }
          }
        },
        { errorTitle: 'Could not unlock' },
      );
    },
    [locked, run, commit],
  );

  const onCancelUnlock = useCallback(() => {
    clearPendingImport();
    lockedBytesRef.current = null;
    setLocked(null);
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
      `Permanently deletes all ${n} transaction${n === 1 ? '' : 's'} added by “${label}” — including any you’ve since edited, categorized, split, or attached to a loan. This can’t be undone. (Duplicates it merely merged into earlier imports are kept.)`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete all',
          style: 'destructive',
          onPress: () => {
            const removed = revertImport(lastImport.id);
            Alert.alert('Import reverted', `Removed ${removed} transaction${removed === 1 ? '' : 's'}.`);
          },
        },
      ],
    );
  }, [lastImport]);

  const header = (
    <View style={styles.header}>
      <ThemedText type="subtitle">Import</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {savedCount > 0
          ? `${savedCount} transaction${savedCount === 1 ? '' : 's'} imported this session`
          : 'Import a Paytm statement to review it here'}
      </ThemedText>

      {savedCount > 0 && (
        <View style={styles.tiles}>
          <StatTile label="Spent" value={formatINR(totalOut)} color={theme.spend} />
          <StatTile label="Received" value={formatINR(totalIn)} color={theme.income} />
        </View>
      )}

      {/* Needs-review banner. Tapping it opens Reports filtered to the review queue; "Accept all"
          is a separate inner action. */}
      {reviewCount > 0 && (
        <Pressable
          onPress={() => router.navigate({ pathname: '/reports', params: { review: '1', t: String(Date.now()) } })}
          accessibilityRole="button"
          accessibilityLabel={`${reviewCount} transactions need review. Open the review list.`}
          style={({ pressed }) => [styles.reviewBanner, { borderColor: theme.review, opacity: pressed ? 0.8 : 1 }]}
        >
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold" style={{ color: theme.review }}>
              {reviewCount} need{reviewCount === 1 ? 's' : ''} review
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Tap to review them all, or accept the suggestions.
            </ThemedText>
          </View>
          <Pressable
            onPress={onAcceptAll}
            accessibilityRole="button"
            accessibilityLabel="Accept all suggestions"
            hitSlop={12}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <ThemedText type="smallBold" style={{ color: theme.review }}>
              Accept all
            </ThemedText>
          </Pressable>
        </Pressable>
      )}

      {/* Actions. "Add sample" / dev tools are compiled out of release builds via __DEV__. */}
      <View style={styles.actions}>
        <Button label="Import file" variant="primary" onPress={onImportFile} disabled={busy} style={styles.grow} />
        {__DEV__ && <Button label="Add sample" onPress={onAddSample} disabled={busy} style={styles.grow} />}
      </View>
      {__DEV__ && (
        <View style={styles.actions}>
          <Button label="Seed 20k" onPress={onSeed} disabled={busy} style={styles.grow} />
          <Button label="Check parity" onPress={onParity} disabled={busy} style={styles.grow} />
        </View>
      )}
      {busy && <ActivityIndicator style={{ marginTop: Spacing.two }} />}

      {/* TEMP diagnostic: on-screen import log tail. Shows where an import stalls on-device without
          needing adb. The LAST line before a frozen spinner is the stage that hung. */}
      {logLines.length > 0 && (
        <View style={[styles.logPanel, { borderColor: theme.border }]}>
          {logLines.slice(-16).map((line, i) => (
            <ThemedText key={i} type="caption" themeColor="textSecondary" style={styles.logLine}>
              {line}
            </ThemedText>
          ))}
        </View>
      )}

      {/* Revert the last import — deletes everything that batch added (survives app restarts). */}
      {lastImport && (
        <Pressable
          onPress={onRevertLast}
          accessibilityRole="button"
          accessibilityLabel="Revert the last import"
          style={({ pressed }) => [styles.revertRow, { borderColor: theme.border, opacity: pressed ? 0.6 : 1 }]}
        >
          <View style={styles.grow}>
            <ThemedText type="smallBold" style={{ color: theme.spend }}>
              ↩ Revert last import
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {(lastImport.sourceLabel.trim() || 'Last import')} · {lastImport.addedCount} added · {lastImport.importedAt.slice(0, 10)}
            </ThemedText>
          </View>
        </Pressable>
      )}

      {/* Month navigation for the current import (year row appears when it spans multiple years). */}
      {months.length > 0 && (
        <View style={styles.tabsWrap}>
          <PeriodTabs months={months} selected={selectedMonth} onSelect={setSelectedMonth} />
        </View>
      )}
    </View>
  );

  const footer = (
    <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
      Showing this session’s import — your full history is on the Reports tab. Categories are
      auto-picked from your Paytm tags and known merchants; low-confidence guesses are flagged
      “Review”. Tap any transaction to change its category.{'\n'}Finance Tracker v{APP_VERSION}
    </ThemedText>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <TransactionList
          rows={txns}
          loading={loading}
          hasMore={hasMore}
          loadMore={loadMore}
          onPressRow={openTxn}
          categoryLabelFor={(t) => categoryLabel(t, index.byId, subNames)}
          showReviewBadge
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          ListEmptyComponent={
            <EmptyState
              style={styles.empty}
              title="Nothing imported this session"
              message={
                __DEV__
                  ? 'Tap “Import file” to load a Paytm statement, or “Add sample” to try it.'
                  : 'Tap “Import file” to load a Paytm statement.'
              }
            />
          }
          contentContainerStyle={styles.content}
        />
      </SafeAreaView>

      {/* Inline overlay (NOT a React Native <Modal>): a separate-window Modal can be dropped when
          Samsung Knox App Lock re-authenticates and recreates the activity after the file picker.
          Rendering in the screen's own view tree keeps the prompt reliably on screen. */}
      {locked && <PasswordPrompt label={locked.label} onCancel={onCancelUnlock} onSubmit={onUnlock} />}
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
  onCancel,
  onSubmit,
}: {
  label: string;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  const theme = useTheme();
  const [pw, setPw] = useState('');
  return (
    // Lift the centered card above the keyboard. Both platforms: iOS never resizes for the keyboard,
    // and this app is edge-to-edge so Android doesn't resize the window under the keyboard either.
    <KeyboardAvoidingView style={styles.overlay} behavior="padding">
      <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Cancel" />
      <ThemedView type="backgroundElement" style={styles.pwCard}>
        <ThemedText type="subtitle">Unlock statement</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          “{label}” is password-protected. Enter the password to import it. This can take a few seconds.
        </ThemedText>
        <TextInput
          value={pw}
          onChangeText={setPw}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          onSubmitEditing={() => pw !== '' && onSubmit(pw)}
          style={[styles.pwInput, { color: theme.text, backgroundColor: theme.background, borderColor: theme.border }]}
        />
        <View style={styles.actions}>
          <Button label="Cancel" variant="secondary" onPress={onCancel} style={styles.grow} />
          <Button label="Unlock" variant="primary" onPress={() => onSubmit(pw)} disabled={pw === ''} style={styles.grow} />
        </View>
      </ThemedView>
    </KeyboardAvoidingView>
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
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  header: { gap: Spacing.two, marginBottom: Spacing.two },
  tiles: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  reviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    marginTop: Spacing.two,
  },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  grow: { flex: 1 },
  revertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.two,
  },
  logPanel: {
    marginTop: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.two,
    padding: Spacing.two,
    gap: 1,
  },
  logLine: { fontFamily: 'monospace', fontSize: 10 },
  tabsWrap: { marginTop: Spacing.two },
  footer: { marginTop: Spacing.three },
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
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  pwCard: { width: '100%', maxWidth: 420, borderRadius: Spacing.four, padding: Spacing.four, gap: Spacing.two },
  pwInput: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginTop: Spacing.one,
  },
});
