/**
 * Import screen: load a Paytm statement and review WHAT YOU JUST IMPORTED. It shows only the
 * transactions added THIS session (via a `since` filter on SESSION_START) — the full history lives
 * on the Reports tab. A single import can span years, so a {@link PeriodTabs} bar lets you jump
 * month-by-month (with a year row when the import spans multiple years). The summary tiles describe
 * the whole current import.
 */

import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { CategoryPicker } from '@/components/category-picker';
import { EmptyState } from '@/components/empty-state';
import { PeriodTabs } from '@/components/period-tabs';
import { StatTile } from '@/components/stat-tile';
import { ThemedText } from '@/components/themed-text';
import { TransactionDetail } from '@/components/transaction-detail';
import { TransactionList } from '@/components/transaction-list';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import type { MonthKey, TxnFilter } from '@/core/analytics';
import type { TransactionRow } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { paytmAdapter } from '@/core/import/adapters/paytm';
import { runImport } from '@/core/import/pipeline';
import type { RawRow, SheetLike } from '@/core/import/types';
import { parseXlsxBytes } from '@/core/import/xlsx';
import { useBusyAction } from '@/hooks/use-busy-action';
import { useTheme } from '@/hooks/use-theme';
import { useCategoryIndex, useLists } from '@/hooks/use-reference-data';
import { useDimensions, useSummary } from '@/hooks/use-analytics';
import { useTransactionList } from '@/hooks/use-transactions';
import { runAnalyticsParityCheck, seedRandomTransactions } from '@/services/db/dev-tools';
import {
  acceptAllReviews,
  addCategory,
  addSubcategory,
  clearTransactionCategory,
  deleteTransaction,
  getExistingDedupeKeys,
  saveTransactions,
  setTransactionCategory,
} from '@/services/db/repository';
import { SESSION_START } from '@/services/session';

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
  return { name: 'Passbook Payment History', headers: SAMPLE_HEADERS, rows };
}

export default function ImportScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { busy, run } = useBusyAction();
  // The transaction whose detail sheet is open; `pickerOpen` layers the category picker on top.
  const [detailId, setDetailId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Which month of the current import is shown; null = the whole import.
  const [selectedMonth, setSelectedMonth] = useState<MonthKey | null>(null);

  // Everything on this screen is scoped to THIS session's imports.
  const sessionFilter: TxnFilter = { since: SESSION_START };
  const listFilter: TxnFilter = selectedMonth
    ? { since: SESSION_START, from: selectedMonth, to: selectedMonth }
    : sessionFilter;

  const { rows: txns, loadMore, hasMore, loading } = useTransactionList(listFilter);
  // Summary + review/imported counts describe the WHOLE current import (canonical money rules).
  const { spentPaise: totalOut, receivedPaise: totalIn, reviewCount, savedCount } = useSummary(sessionFilter);
  const { months } = useDimensions(sessionFilter);

  const index = useCategoryIndex();
  const lists = useLists();
  const subNames = useMemo(() => {
    const m = new Map<number, string>();
    index.categories.forEach((c) => c.subcategories.forEach((s) => m.set(s.id, s.name)));
    return m;
  }, [index]);
  const pmNames = useMemo(() => new Map(lists.paymentModes.map((p) => [p.id, p.name])), [lists.paymentModes]);
  const personNames = useMemo(() => new Map(lists.people.map((p) => [p.id, p.name])), [lists.people]);

  // Look the open transaction up live (the tapped row is always inside the loaded, live window).
  const detailTxn = detailId != null ? (txns.find((t) => t.id === detailId) ?? null) : null;

  const commit = useCallback(
    (sheets: SheetLike[], sourceLabel: string) => {
      const preview = runImport(sheets, [paytmAdapter], getExistingDedupeKeys());
      const save = () =>
        run(
          async () => {
            // Yield a frame so the spinner paints before the synchronous DB write blocks the thread.
            await new Promise((resolve) => setTimeout(resolve, 0));
            const n = saveTransactions(preview.newTxns);
            Alert.alert(
              'Imported',
              `${n} new transaction(s) saved from ${sourceLabel} and auto-categorized. ` +
                `Anything the app was unsure about is flagged “Needs review”.`,
            );
          },
          { errorTitle: 'Could not save import' },
        );
      Alert.alert(
        'Import preview',
        `Found ${preview.totalRows} rows\nNew: ${preview.newTxns.length}\nDuplicates: ${preview.duplicates.length}\nErrors: ${preview.errors.length}`,
        preview.newTxns.length > 0
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

  const onImportFile = useCallback(async () => {
    let picked;
    try {
      picked = await File.pickFileAsync({
        mimeTypes: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/octet-stream',
        ],
      });
    } catch (err) {
      Alert.alert('Could not import', err instanceof Error ? err.message : String(err));
      return;
    }
    if (picked.canceled || !picked.result) return;
    const file = picked.result;
    run(
      async () => {
        // Yield a frame so the spinner paints before the synchronous parse blocks the thread.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const buffer = await file.arrayBuffer();
        const sheets = parseXlsxBytes(new Uint8Array(buffer));
        commit(sheets, file.name);
      },
      { errorTitle: 'Could not import' },
    );
  }, [commit, run]);

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

  const onPickCategory = useCallback(
    (categoryId: number, subcategoryId: number | null) => {
      if (detailId != null) setTransactionCategory(detailId, categoryId, subcategoryId, { learn: true });
      setPickerOpen(false); // back to the detail sheet, which now shows the new category
    },
    [detailId],
  );

  const onAddCategory = useCallback((name: string, emoji: string | null) => addCategory(name, emoji), []);
  const onAddSubcategory = useCallback((categoryId: number, name: string) => addSubcategory(categoryId, name), []);

  // Stable so the memoized (recycled) TxnRow isn't invalidated each render.
  const openDetail = useCallback((id: number) => {
    setDetailId(id);
    setPickerOpen(false);
  }, []);

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
          onPress={() => router.navigate({ pathname: '/reports', params: { review: '1' } })}
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
      “Review”. Tap any transaction to change its category.
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
          onPressRow={openDetail}
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

      <TransactionDetail
        visible={detailTxn !== null && !pickerOpen}
        txn={detailTxn}
        categoryLabel={detailTxn ? categoryLabel(detailTxn, index.byId, subNames) : null}
        paymentModeName={detailTxn?.paymentModeId != null ? (pmNames.get(detailTxn.paymentModeId) ?? null) : null}
        personName={detailTxn?.personId != null ? (personNames.get(detailTxn.personId) ?? null) : null}
        onClose={() => setDetailId(null)}
        onChangeCategory={() => setPickerOpen(true)}
        onRemoveCategory={() => {
          if (detailId != null) clearTransactionCategory(detailId);
        }}
        onDelete={() => {
          if (detailId != null) deleteTransaction(detailId);
        }}
      />

      <CategoryPicker
        visible={detailTxn !== null && pickerOpen}
        categories={index.categories}
        title={detailTxn ? (detailTxn.counterpartyName ?? detailTxn.rawDetails) : undefined}
        onClose={() => setPickerOpen(false)}
        onPick={onPickCategory}
        onAddCategory={onAddCategory}
        onAddSubcategory={onAddSubcategory}
      />
    </ThemedView>
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
  tabsWrap: { marginTop: Spacing.two },
  footer: { marginTop: Spacing.three },
  empty: { marginTop: Spacing.three },
});
