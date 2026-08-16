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
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { CategoryBreakdown, type CategoryBreakdownRow } from '@/components/category-breakdown';
import { CategoryDetail } from '@/components/category-detail';
import { Chip } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { SpendBarChart, type BarDatum } from '@/components/spend-bar-chart';
import { StatTile } from '@/components/stat-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  categoryBreakdown,
  listYears,
  monthlyForYear,
  MONTH_LABELS,
  subcategoryBreakdown,
  totalsForPeriod,
  yearlyTotals,
  type AnalyticsTxn,
} from '@/core/analytics';
import { transactions } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { useBusyAction } from '@/hooks/use-busy-action';
import { useTheme } from '@/hooks/use-theme';
import { useCategoryIndex } from '@/hooks/use-reference-data';
import { getDb } from '@/services/db/database';
import { saveYearToFolder, shareYearToExcel } from '@/services/export';

export default function DashboardScreen() {
  const theme = useTheme();
  const db = getDb();
  // Semantic colours (theme-aware) — each is always paired with a text label, so the red↔green
  // pair is never distinguished by colour alone.
  const SPEND = theme.spend;
  const INCOME = theme.income;
  const REFUND = theme.accent;

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

  const index = useCategoryIndex();

  const years = useMemo(() => listYears(txns), [txns]);
  const yearly = useMemo(() => yearlyTotals(txns), [txns]);

  // Selected period: a year, optionally narrowed to one month (set by tapping a bar).
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  // The category whose sub-category drill-down sheet is open, if any.
  const [openCategoryId, setOpenCategoryId] = useState<number | null>(null);

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
      return { key: String(c.categoryId ?? 'none'), label, value: c.spentPaise, id: c.categoryId };
    });
  }, [txns, period, index]);

  // Sub-category split for the open category, within the current period (for the drill-down sheet).
  const openCategory = openCategoryId != null ? index.byId.get(openCategoryId) ?? null : null;
  const subRows: CategoryBreakdownRow[] = useMemo(() => {
    if (openCategoryId == null || !openCategory) return [];
    const subNames = new Map(openCategory.subcategories.map((s) => [s.id, s.name]));
    return subcategoryBreakdown(txns, openCategoryId, period).map((s) => ({
      key: String(s.subcategoryId ?? 'none'),
      label: s.subcategoryId != null ? (subNames.get(s.subcategoryId) ?? 'Sub-category') : 'No sub-category',
      value: s.spentPaise,
    }));
  }, [txns, openCategoryId, openCategory, period]);
  const subTotal = subRows.reduce((sum, r) => sum + r.value, 0);
  const subCount = useMemo(
    () =>
      openCategoryId == null
        ? 0
        : subcategoryBreakdown(txns, openCategoryId, period).reduce((n, s) => n + s.txnCount, 0),
    [txns, openCategoryId, period],
  );

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

  // Save the whole active year (one workbook = one year, a sheet per month + a summary).
  const { busy: exporting, run: runExport } = useBusyAction('Could not export');

  const saveToFolder = useCallback(
    () =>
      runExport(async () => {
        const res = await saveYearToFolder(activeYear);
        if (res.saved) Alert.alert('Saved', `${res.fileName} was saved to the folder you chose.`);
      }),
    [runExport, activeYear],
  );

  const shareFile = useCallback(
    () =>
      runExport(async () => {
        const res = await shareYearToExcel(activeYear);
        if (!res.shared) {
          Alert.alert('Saved', `Sharing isn’t available here. The workbook was saved as ${res.fileName}.`);
        }
      }),
    [runExport, activeYear],
  );

  const onExport = useCallback(() => {
    Alert.alert(`Export ${activeYear}`, 'Save the Excel workbook to your device, or share it.', [
      { text: 'Save to a folder', onPress: saveToFolder },
      { text: 'Share…', onPress: shareFile },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [activeYear, saveToFolder, shareFile]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedText type="subtitle">Dashboard</ThemedText>

          {txns.length === 0 ? (
            <EmptyState
              style={styles.empty}
              message="No transactions yet. Import a Paytm statement (or add the sample) on the Home tab and your monthly and yearly spend will show up here."
            />
          ) : (
            <>
              {/* Year selector */}
              {years.length > 1 && (
                <View style={styles.chipsRow}>
                  {years.map((y) => (
                    <Chip
                      key={y}
                      label={String(y)}
                      selected={y === activeYear}
                      onPress={() => selectYear(y)}
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

              {/* Export the whole active year to Excel */}
              <Button
                label={`⤓  Export ${activeYear} to Excel`}
                accessibilityLabel={`Export ${activeYear} to Excel`}
                onPress={onExport}
                loading={exporting}
                style={styles.exportBtn}
              />

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
                <CategoryBreakdown
                  rows={catRows}
                  total={periodTotals.spentPaise}
                  color={SPEND}
                  onRowPress={(row) => {
                    if (row.id != null) setOpenCategoryId(row.id);
                  }}
                />
                {catRows.length > 0 && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                    Tap a category to see its sub-category breakdown.
                  </ThemedText>
                )}
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

      <CategoryDetail
        visible={openCategory !== null}
        title={openCategory ? `${openCategory.emoji ? openCategory.emoji + ' ' : ''}${openCategory.name}` : null}
        periodLabel={periodLabel}
        totalPaise={subTotal}
        txnCount={subCount}
        rows={subRows}
        color={SPEND}
        onClose={() => setOpenCategoryId(null)}
      />
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
  empty: { marginTop: Spacing.three },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.one },
  tiles: { flexDirection: 'row', gap: Spacing.two },
  exportBtn: { marginTop: Spacing.two },
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
