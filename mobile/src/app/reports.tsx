/**
 * Reports (Step 6): the same spend sliced different ways — top merchants, by funding account,
 * by "For" person — plus a cashback/refund summary. All figures in ₹, self-transfers excluded.
 *
 * Two of the originally-planned reports are intentionally NOT here yet, because our data can't
 * support them honestly: net worth needs account balances (UPI statements have none) and an EMI
 * schedule needs recurring-payment detection (out of scope for v1). A note on-screen says so.
 */

import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryBreakdown, type CategoryBreakdownRow } from '@/components/category-breakdown';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  accountSpend,
  cashbackTotals,
  listYears,
  merchantSpend,
  personSpend,
  type AnalyticsTxn,
  type GroupSpend,
  type PeriodFilter,
} from '@/core/analytics';
import { transactions } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { useTheme } from '@/hooks/use-theme';
import { useLists } from '@/hooks/use-reference-data';
import { getDb } from '@/services/db/database';

const SPEND = '#e5484d';
const REFUND = '#3c87f7';
const TOP_MERCHANTS = 12;

/** null year = "All years". */
type YearSel = number | 'all';

export default function ReportsScreen() {
  const theme = useTheme();
  const db = getDb();

  const query = useMemo(
    () =>
      db
        .select({
          isoDate: transactions.isoDate,
          paise: transactions.paise,
          direction: transactions.direction,
          isRefund: transactions.isRefund,
          categoryId: transactions.categoryId,
          subcategoryId: transactions.subcategoryId,
          counterpartyName: transactions.counterpartyName,
          counterpartyVpa: transactions.counterpartyVpa,
          accountName: transactions.accountName,
          personId: transactions.personId,
        })
        .from(transactions),
    [db],
  );
  const { data } = useLiveQuery(query);
  const txns = (data ?? []) as AnalyticsTxn[];

  const lists = useLists();
  const personNames = useMemo(() => new Map(lists.people.map((p) => [p.id, p.name])), [lists.people]);

  const years = useMemo(() => listYears(txns), [txns]);
  const [sel, setSel] = useState<YearSel | null>(null);
  // Default to the most recent year with data (or all-time if none yet).
  const active: YearSel = sel ?? years[0] ?? 'all';
  const filter: PeriodFilter | null = active === 'all' ? null : { year: active };
  const periodLabel = active === 'all' ? 'All years' : String(active);

  const merchants = useMemo(() => merchantSpend(txns, filter), [txns, filter]);
  const accounts = useMemo(() => accountSpend(txns, filter), [txns, filter]);
  const people = useMemo(() => personSpend(txns, filter), [txns, filter]);
  const cashback = useMemo(() => cashbackTotals(txns, filter), [txns, filter]);

  const merchantTotal = merchants.reduce((s, m) => s + m.spentPaise, 0);
  const accountTotal = accounts.reduce((s, a) => s + a.spentPaise, 0);
  const peopleTotal = people.reduce((s, p) => s + p.spentPaise, 0);

  const toRows = (groups: GroupSpend[]): CategoryBreakdownRow[] =>
    groups.map((g) => ({ key: g.key, label: g.key, value: g.spentPaise }));

  const topMerchants = toRows(merchants.slice(0, TOP_MERCHANTS));
  const hiddenMerchants = Math.max(0, merchants.length - TOP_MERCHANTS);

  const accountRows = toRows(accounts);
  const personRows: CategoryBreakdownRow[] = people.map((p) => ({
    key: String(p.personId ?? 'none'),
    label: p.personId != null ? (personNames.get(p.personId) ?? 'Unknown') : 'Not assigned',
    value: p.spentPaise,
  }));

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedText type="subtitle">Reports</ThemedText>

          {txns.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No transactions yet. Import a Paytm statement on the Home tab and your merchant,
              account and person reports will show up here.
            </ThemedText>
          ) : (
            <>
              {years.length > 1 && (
                <View style={styles.chipsRow}>
                  <Chip label="All" active={active === 'all'} onPress={() => setSel('all')} theme={theme} />
                  {years.map((y) => (
                    <Chip key={y} label={String(y)} active={active === y} onPress={() => setSel(y)} theme={theme} />
                  ))}
                </View>
              )}

              {/* Cashback & refunds */}
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                Cashback &amp; refunds · {periodLabel}
              </ThemedText>
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="title" style={{ color: REFUND, fontSize: 30, lineHeight: 36 }}>
                  {formatINR(cashback.totalPaise)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {cashback.count} refund{cashback.count === 1 ? '' : 's'} / cashback received ·
                  subtracted from your spending
                </ThemedText>
              </ThemedView>

              {/* Top merchants */}
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                Top merchants · {periodLabel}
              </ThemedText>
              <ThemedView type="backgroundElement" style={styles.card}>
                <CategoryBreakdown rows={topMerchants} total={merchantTotal} color={SPEND} />
                {hiddenMerchants > 0 && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                    + {hiddenMerchants} more merchant{hiddenMerchants === 1 ? '' : 's'}
                  </ThemedText>
                )}
              </ThemedView>

              {/* By account */}
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                Spend by account · {periodLabel}
              </ThemedText>
              <ThemedView type="backgroundElement" style={styles.card}>
                <CategoryBreakdown rows={accountRows} total={accountTotal} color={SPEND} />
              </ThemedView>

              {/* By person */}
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                Spend by person (For) · {periodLabel}
              </ThemedText>
              <ThemedView type="backgroundElement" style={styles.card}>
                <CategoryBreakdown rows={personRows} total={peopleTotal} color={SPEND} />
                <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                  Assign a “For” person on a transaction (tap it on Home) to fill this in.
                </ThemedText>
              </ThemedView>

              {/* Not yet available */}
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                Not yet available
              </ThemedText>
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary">
                  Net worth and an EMI/loan schedule aren’t shown yet: net worth needs your account
                  balances (Paytm UPI statements don’t include a running balance) and an EMI schedule
                  needs recurring-payment tracking. Both are planned for a later version once we can
                  compute them accurately.
                </ThemedText>
              </ThemedView>

              <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
                All figures in ₹, money spent only. Transfers between your own accounts are excluded.
              </ThemedText>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Chip({
  label,
  active,
  onPress,
  theme,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: active ? theme.backgroundSelected : theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <ThemedText type="smallBold" themeColor={active ? 'text' : 'textSecondary'}>
        {label}
      </ThemedText>
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
  empty: { marginTop: Spacing.three },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
  chip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: Spacing.four },
  sectionTitle: { marginTop: Spacing.three },
  card: { borderRadius: Spacing.three, padding: Spacing.three, marginTop: Spacing.one, gap: Spacing.half },
  hint: { marginTop: Spacing.two },
  footer: { marginTop: Spacing.three },
});
