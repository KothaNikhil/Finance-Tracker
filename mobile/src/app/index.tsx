import { desc } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { File } from 'expo-file-system';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { formatINR } from '@/core/domain/money';
import { paytmAdapter } from '@/core/import/adapters/paytm';
import { runImport } from '@/core/import/pipeline';
import type { RawRow, SheetLike } from '@/core/import/types';
import { parseXlsxBytes } from '@/core/import/xlsx';
import { useTheme } from '@/hooks/use-theme';
import { transactions, type TransactionRow } from '@/core/db/schema';
import { getDb } from '@/services/db/database';
import {
  clearAllTransactions,
  getExistingDedupeKeys,
  saveTransactions,
} from '@/services/db/repository';

const DIRECTION_META = {
  out: { sign: '−', color: '#e5484d' },
  in: { sign: '+', color: '#30a46c' },
  self: { sign: '⇄', color: '#f5a524' },
} as const;

// A tiny built-in sample (no personal data) for a one-tap demo of import + dedupe.
const SAMPLE_HEADERS = [
  'Date', 'Time', 'Transaction Details', 'Other Transaction Details (UPI ID or A/c No)',
  'Your Account', 'Amount', 'UPI Ref No.', 'Order ID', 'Remarks', 'Tags', 'Comment',
];
const SAMPLE_ROWS: string[][] = [
  ['29/05/2026', '13:20:00', 'Paid to Zomato Limited', 'zomato@ptys on Paytm', 'Axis Bank - 15', '-450.00', 'R1', '', 'Lunch', '#🥘 Food', ''],
  ['29/05/2026', '09:02:22', 'Received from Vutukuri Prathyusha', '9573438218@ybl on PhonePe', 'Axis Bank - 15', '+5,000.00', 'R2', '', '', '#💵 Money Received', ''],
  ['12/05/2026', '12:48:17', 'Transferred to Self, Axis Bank - 15', '7259131616@ptys on Paytm', 'Axis Bank - 15', '27,000.00', 'R3', '', 'Car emi', '#Car Emi', ''],
  ['12/05/2026', '12:48:57', 'Gold Coin Redemption', '', 'Gold Coins', '-49.75', '', 'O1', '', '#🪙 Investment', ''],
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
  const [busy, setBusy] = useState(false);

  const db = getDb();
  const query = useMemo(
    () => db.select().from(transactions).orderBy(desc(transactions.isoDate), desc(transactions.id)),
    [db],
  );
  const { data } = useLiveQuery(query);
  const txns: TransactionRow[] = data ?? [];

  const totalOut = txns
    .filter((t) => t.direction === 'out' && !t.isRefund)
    .reduce((s, t) => s + t.paise, 0);
  const totalIn = txns.filter((t) => t.direction === 'in').reduce((s, t) => s + t.paise, 0);

  const commit = useCallback((sheets: SheetLike[], sourceLabel: string) => {
    const preview = runImport(sheets, [paytmAdapter], getExistingDedupeKeys());
    const save = () => {
      const n = saveTransactions(preview.newTxns);
      Alert.alert('Imported', `${n} new transaction(s) saved from ${sourceLabel}.`);
    };
    Alert.alert(
      'Import preview',
      `Found ${preview.totalRows} rows\nNew: ${preview.newTxns.length}\nDuplicates: ${preview.duplicates.length}\nErrors: ${preview.errors.length}`,
      preview.newTxns.length > 0
        ? [{ text: 'Cancel', style: 'cancel' }, { text: 'Save', onPress: save }]
        : [{ text: 'OK' }],
    );
  }, []);

  const onAddSample = useCallback(() => commit([buildSampleSheet()], 'the sample'), [commit]);

  const onImportFile = useCallback(async () => {
    try {
      const picked = await File.pickFileAsync({
        mimeTypes: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/octet-stream',
        ],
      });
      if (picked.canceled || !picked.result) return;
      setBusy(true);
      const buffer = await picked.result.arrayBuffer();
      const sheets = parseXlsxBytes(new Uint8Array(buffer));
      commit(sheets, picked.result.name);
    } catch (err) {
      Alert.alert('Could not import', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [commit]);

  const onClear = useCallback(() => {
    Alert.alert('Clear all transactions?', 'This removes every saved transaction.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => clearAllTransactions() },
    ]);
  }, []);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedText type="subtitle">Finance Tracker</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {txns.length} transaction{txns.length === 1 ? '' : 's'} saved on this device
          </ThemedText>

          {/* Totals */}
          <ThemedView type="backgroundElement" style={styles.card}>
            <View style={styles.statsRow}>
              <Stat label="Spent" value={formatINR(totalOut)} color="#e5484d" />
              <Stat label="Received" value={formatINR(totalIn)} color="#30a46c" />
            </View>
          </ThemedView>

          {/* Actions */}
          <View style={styles.actions}>
            <Button label="Import file" onPress={onImportFile} theme={theme} primary />
            <Button label="Add sample" onPress={onAddSample} theme={theme} />
            <Button label="Clear" onPress={onClear} theme={theme} />
          </View>
          {busy && <ActivityIndicator style={{ marginTop: Spacing.two }} />}

          {/* Transactions */}
          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Transactions
          </ThemedText>
          {txns.length === 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              None yet. Tap “Import file” to load a Paytm statement, or “Add sample” to try it.
            </ThemedText>
          )}
          {txns.slice(0, 100).map((t) => (
            <TxnRow key={t.id} txn={t} />
          ))}

          <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
            Imported data is saved on this device and de-duplicated. Auto-categorization,
            dashboards, and Google Drive backup come next.
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="smallBold" style={{ color }}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

function Button({
  label,
  onPress,
  theme,
  primary,
}: {
  label: string;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary ? '#3c87f7' : theme.backgroundSelected, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <ThemedText type="smallBold" style={{ color: primary ? '#ffffff' : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function TxnRow({ txn }: { txn: TransactionRow }) {
  const meta = DIRECTION_META[txn.direction as keyof typeof DIRECTION_META] ?? DIRECTION_META.out;
  return (
    <ThemedView type="backgroundElement" style={styles.txnRow}>
      <View style={styles.txnLeft}>
        <ThemedText type="default" numberOfLines={1}>
          {txn.counterpartyName ?? txn.rawDetails ?? '—'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {txn.isoDate} · {txn.kind}
          {txn.rawTag ? ` · ${txn.rawTag}` : ''}
        </ThemedText>
      </View>
      <ThemedText type="smallBold" style={{ color: meta.color }}>
        {meta.sign} {formatINR(txn.paise)}
      </ThemedText>
    </ThemedView>
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
  card: { borderRadius: Spacing.three, padding: Spacing.three, marginTop: Spacing.two },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  stat: { alignItems: 'center', flex: 1, gap: 2 },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  button: {
    flex: 1,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  footer: { marginTop: Spacing.three },
});
