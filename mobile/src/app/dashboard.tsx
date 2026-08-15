/**
 * Dashboards (Step 5): monthly and yearly spend, in ₹.
 *
 * The numbers come from the pure `core/analytics` layer, which enforces the two money rules:
 *  - self-transfers (`direction === 'self'`) are excluded from every total, and
 *  - refunds/cashback offset spend rather than counting as income.
 *
 * "Net spent" (spent − refunds) is the headline metric and what the month/year bars plot; the
 * category breakdown shows gross spend composition (so its bars sum to the "Spent" tile).
 */

import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryBreakdown, type CategoryBreakdownRow } from '@/components/category-breakdown';
import { SpendBarChart, type BarDatum } from '@/components/spend-bar-chart';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  categoryBreakdown,
  listYears,
  monthlyForYear,
  MONTH_LABELS,
  totalsForPeriod,
  yearlyTotals,
  type AnalyticsTxn,
} from '@/core/analytics';
import { transactions } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { useTheme } from '@/hooks/use-theme';
import { useCategoryIndex } from '@/hooks/use-reference-data';
import { getDb } from '@/services/db/database';

// Semantic colours, shared with the rest of the app. Each is always paired with a text label,
// so the red↔green pair is never distinguished by colour alone.
const SPEND = '#e5484d';
const INCOME = '#30a46c';
const REFUND = '#3c87f7';

export default function DashboardScreen() {
  const theme = useTheme();
  const db = getDb();

  // Only the columns the analytics need; useLiveQuery keeps this in sync with imports/edits.
  const query = useMemo(
    () =>
      db
        .select({
          isoDate: transactions.isoDate,
          paise: transactions.paise,
          direction: transactions.direction,
          isRefund: transactions.isRefund,
          categoryId: transactions.categoryId,
        })
        .from(transactions),
    [db],
  );
  const { data } = useLiveQuery(query);
  const txns = (data ?? []) as AnalyticsTxn[];

  const index = useCategoryIndex();

  const years = useMemo(() => listYears(txns), [txns]);
  const yearly = useMemo(() => yearlyTotals(txns), [txns]);

  // Selected period: a year, optionally narrowed to one month (set by tapping a bar).
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);

  // Default to the most recent year that has data (falls back to the current calendar year).
  const activeYear = selectedYear ?? years[0] ?? new Date().getFullYear();

  const monthly = useMemo(() => monthlyForYear(txns, activeYear), [txns, activeYear]);
  const period = useMemo(
    () => ({ year: activeYear, month: selectedMonth ?? undefined }),
    [activeYear, selectedMonth],
  );
  const periodTotals = useMemo(() => totalsForPeriod(txns, period), [txns, period]);

  const bars: BarDatum[] = monthly.map((m) => ({
    key: m.label,
    label: m.label,
    value: m.totals.netSpentPaise,
  }));

  const catRows: CategoryBreakdownRow[] = useMemo(() => {
    return categoryBreakdown(txns, period).map((c) => {
      const cat = c.categoryId != null ? index.byId.get(c.categoryId) : null;
      const label = cat ? `${cat.emoji ? cat.emoji + ' ' : ''}${cat.name}` : 'Uncategorized';
      return { key: String(c.categoryId ?? 'none'), label, value: c.spentPaise };
    });
  }, [txns, period, index]);

  const yearRows: CategoryBreakdownRow[] = yearly.map((y) => ({
    key: String(y.year),
    label: String(y.year),
    value: Math.max(0, y.totals.netSpentPaise),
  }));
  const allYearsNet = yearly.reduce((s, y) => s + Math.max(0, y.totals.netSpentPaise), 0);

  const periodLabel =
    selectedMonth != null ? `${MONTH_LABELS[selectedMonth - 1]} ${activeYear}` : `${activeYear}`;

  const selectYear = (y: number) => {
    setSelectedYear(y);
    setSelectedMonth(null); // a new year starts on the whole-year view
  };
  const onBarSelect = (i: number) => {
    const month = i + 1;
    setSelectedMonth((cur) => (cur === month ? null : month)); // tap again to zoom back out
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedText type="subtitle">Dashboard</ThemedText>

          {txns.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No transactions yet. Import a Paytm statement (or add the sample) on the Home tab and
              your monthly and yearly spend will show up here.
            </ThemedText>
          ) : (
            <>
              {/* Year selector */}
              {years.length > 1 && (
                <View style={styles.chipsRow}>
                  {years.map((y) => (
                    <Chip
                      key={y}
                      label={String(y)}
                      active={y === activeYear}
                      onPress={() => selectYear(y)}
                      theme={theme}
                    />
                  ))}
                </View>
              )}

              {/* Summary tiles for the selected period */}
              <View style={styles.tiles}>
                <StatTile label="Net spent" value={formatINR(periodTotals.netSpentPaise)} color={theme.text} />
                <StatTile label="Spent" value={formatINR(periodTotals.spentPaise)} color={SPEND} />
              </View>
              <View style={styles.tiles}>
                <StatTile label="Received" value={formatINR(periodTotals.receivedPaise)} color={INCOME} />
                <StatTile label="Refunds" value={formatINR(periodTotals.refundPaise)} color={REFUND} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {periodLabel} · {periodTotals.txnCount} transaction
                {periodTotals.txnCount === 1 ? '' : 's'} · self-transfers excluded
              </ThemedText>

              {/* Monthly net-spend chart */}
              <View style={styles.sectionHead}>
                <ThemedText type="smallBold">Net spend by month · {activeYear}</ThemedText>
                {selectedMonth != null && (
                  <Pressable onPress={() => setSelectedMonth(null)} hitSlop={8}>
                    <ThemedText type="link" style={{ color: REFUND }}>
                      Whole year
                    </ThemedText>
                  </Pressable>
                )}
              </View>
              <ThemedView type="backgroundElement" style={styles.card}>
                <SpendBarChart
                  data={bars}
                  color={SPEND}
                  selectedIndex={selectedMonth != null ? selectedMonth - 1 : null}
                  onSelect={onBarSelect}
                  formatValue={formatINR}
                />
                <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                  Tap a month to see its breakdown. Bars are net spend (spending minus refunds).
                </ThemedText>
              </ThemedView>

              {/* Category breakdown for the selected period */}
              <ThemedText type="smallBold" style={styles.sectionTitle}>
                Where it went · {periodLabel}
              </ThemedText>
              <ThemedView type="backgroundElement" style={styles.card}>
                <CategoryBreakdown rows={catRows} total={periodTotals.spentPaise} color={SPEND} />
              </ThemedView>

              {/* Yearly overview */}
              {yearRows.length > 1 && (
                <>
                  <ThemedText type="smallBold" style={styles.sectionTitle}>
                    Net spend by year
                  </ThemedText>
                  <ThemedView type="backgroundElement" style={styles.card}>
                    <CategoryBreakdown rows={yearRows} total={allYearsNet} color={SPEND} />
                  </ThemedView>
                </>
              )}

              <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
                Totals in ₹. Transfers between your own accounts are left out; refunds and cashback
                are subtracted from spending, never counted as income.
              </ThemedText>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.tile}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold" style={{ color, fontSize: 20, lineHeight: 26 }} numberOfLines={1}>
        {value}
      </ThemedText>
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
  tiles: { flexDirection: 'row', gap: Spacing.two },
  tile: { flex: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: 2 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.three,
  },
  sectionTitle: { marginTop: Spacing.three },
  card: { borderRadius: Spacing.three, padding: Spacing.three, marginTop: Spacing.one },
  hint: { marginTop: Spacing.two },
  footer: { marginTop: Spacing.three },
});
