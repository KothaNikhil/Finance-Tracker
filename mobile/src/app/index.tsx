import { desc } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { File } from 'expo-file-system';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { CategoryPicker } from '@/components/category-picker';
import { EmptyState } from '@/components/empty-state';
import { StatTile } from '@/components/stat-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TransactionDetail } from '@/components/transaction-detail';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { formatINR } from '@/core/domain/money';
import { paytmAdapter } from '@/core/import/adapters/paytm';
import { runImport } from '@/core/import/pipeline';
import type { RawRow, SheetLike } from '@/core/import/types';
import { parseXlsxBytes } from '@/core/import/xlsx';
import { useBusyAction } from '@/hooks/use-busy-action';
import { useTheme } from '@/hooks/use-theme';
import { useCategoryIndex, useLists } from '@/hooks/use-reference-data';
import { transactions, type TransactionRow } from '@/core/db/schema';
import { getDb } from '@/services/db/database';
import {
  acceptAllReviews,
  addCategory,
  addSubcategory,
  clearAllTransactions,
  clearTransactionCategory,
  getExistingDedupeKeys,
  saveTransactions,
  setTransactionCategory,
} from '@/services/db/repository';

const DIRECTION_META = {
  out: { sign: '−', color: 'spend' },
  in: { sign: '+', color: 'income' },
  self: { sign: '⇄', color: 'review' },
} as const;

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

export default function HomeScreen() {
  const theme = useTheme();
  const { busy, run } = useBusyAction();
  // The transaction whose detail sheet is open; `pickerOpen` layers the category picker on top.
  const [detailId, setDetailId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const db = getDb();
  const query = useMemo(
    () => db.select().from(transactions).orderBy(desc(transactions.isoDate), desc(transactions.id)),
    [db],
  );
  const { data } = useLiveQuery(query);
  const txns: TransactionRow[] = data ?? [];

  // Category reference data for display + the picker. Categories are seeded once and there's no
  // editing UI yet, so building this once per render from the DB is fine for v1.
  const index = useCategoryIndex();
  const lists = useLists();
  const subNames = useMemo(() => {
    const m = new Map<number, string>();
    index.categories.forEach((c) => c.subcategories.forEach((s) => m.set(s.id, s.name)));
    return m;
  }, [index]);
  const pmNames = useMemo(() => new Map(lists.paymentModes.map((p) => [p.id, p.name])), [lists.paymentModes]);
  const personNames = useMemo(() => new Map(lists.people.map((p) => [p.id, p.name])), [lists.people]);

  // Look the open transaction up live so the detail sheet reflects edits immediately.
  const detailTxn = detailId != null ? (txns.find((t) => t.id === detailId) ?? null) : null;

  const totalOut = txns
    .filter((t) => t.direction === 'out' && !t.isRefund)
    .reduce((s, t) => s + t.paise, 0);
  const totalIn = txns.filter((t) => t.direction === 'in').reduce((s, t) => s + t.paise, 0);
  const reviewCount = txns.filter((t) => t.needsReview).length;

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

  const onClear = useCallback(() => {
    Alert.alert('Clear all transactions?', 'This removes every saved transaction.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => clearAllTransactions() },
    ]);
  }, []);

  const onPickCategory = useCallback(
    (categoryId: number, subcategoryId: number | null) => {
      if (detailId != null) setTransactionCategory(detailId, categoryId, subcategoryId, { learn: true });
      setPickerOpen(false); // back to the detail sheet, which now shows the new category
    },
    [detailId],
  );

  // Live queries keep `index` in sync, so these just write and return the new id.
  const onAddCategory = useCallback((name: string, emoji: string | null) => addCategory(name, emoji), []);
  const onAddSubcategory = useCallback(
    (categoryId: number, name: string) => addSubcategory(categoryId, name),
    [],
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedText type="subtitle">Finance Tracker</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {txns.length} transaction{txns.length === 1 ? '' : 's'} saved on this device
          </ThemedText>

          {/* Totals (only once there's something to total) */}
          {txns.length > 0 && (
            <View style={styles.tiles}>
              <StatTile label="Spent" value={formatINR(totalOut)} color={theme.spend} />
              <StatTile label="Received" value={formatINR(totalIn)} color={theme.income} />
            </View>
          )}

          {/* Needs-review banner */}
          {reviewCount > 0 && (
            <Pressable
              onPress={onAcceptAll}
              accessibilityRole="button"
              accessibilityLabel={`${reviewCount} transactions need review. Accept all suggestions.`}
              style={({ pressed }) => [
                styles.reviewBanner,
                { borderColor: theme.review, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold" style={{ color: theme.review }}>
                  {reviewCount} need{reviewCount === 1 ? 's' : ''} review
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Tap a transaction to fix its category, or accept all suggestions.
                </ThemedText>
              </View>
              <ThemedText type="smallBold" style={{ color: theme.review }}>
                Accept all
              </ThemedText>
            </Pressable>
          )}

          {/* Actions */}
          <View style={styles.actions}>
            <Button label="Import file" variant="primary" onPress={onImportFile} disabled={busy} />
            <Button label="Add sample" onPress={onAddSample} disabled={busy} />
            <Button label="Clear" onPress={onClear} disabled={busy} />
          </View>
          {busy && <ActivityIndicator style={{ marginTop: Spacing.two }} />}

          {/* Transactions */}
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Transactions
          </ThemedText>
          {txns.length === 0 && (
            <EmptyState message="None yet. Tap “Import file” to load a Paytm statement, or “Add sample” to try it." />
          )}
          {txns.slice(0, 100).map((t) => (
            <TxnRow
              key={t.id}
              txn={t}
              categoryLabel={categoryLabel(t, index.byId, subNames)}
              onPress={() => {
                setDetailId(t.id);
                setPickerOpen(false);
              }}
            />
          ))}

          <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
            Categories are auto-picked from your Paytm tags and known merchants. Low-confidence
            guesses are flagged “Review”. Tap any transaction to change its category — the app
            remembers your choice for next time.
          </ThemedText>
        </ScrollView>
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

function TxnRow({
  txn,
  categoryLabel,
  onPress,
}: {
  txn: TransactionRow;
  categoryLabel: string | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  const meta = DIRECTION_META[txn.direction as keyof typeof DIRECTION_META] ?? DIRECTION_META.out;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <ThemedView type="backgroundElement" style={styles.txnRow}>
        <View style={styles.txnLeft}>
          <ThemedText type="default" numberOfLines={1}>
            {txn.counterpartyName ?? txn.rawDetails ?? '—'}
          </ThemedText>
          <View style={styles.txnMetaRow}>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.txnMeta}>
              {categoryLabel ?? (txn.direction === 'self' || txn.kind === 'received' ? 'Transfer' : 'Uncategorized')}
              {' · '}
              {txn.isoDate}
            </ThemedText>
            {txn.needsReview && (
              <View style={[styles.badge, { backgroundColor: theme.review }]}>
                <ThemedText type="small" style={[styles.badgeText, { color: theme.onReview }]}>
                  Review
                </ThemedText>
              </View>
            )}
          </View>
        </View>
        <ThemedText type="smallBold" style={{ color: theme[meta.color] }}>
          {meta.sign} {formatINR(txn.paise)}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.two,
  },
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
  sectionTitle: { marginTop: Spacing.three },
  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  txnLeft: { flex: 1, gap: 2 },
  txnMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  txnMeta: { flexShrink: 1 },
  badge: {
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
  },
  badgeText: { fontSize: 11, lineHeight: 16, fontWeight: '700' },
  footer: { marginTop: Spacing.three },
});
