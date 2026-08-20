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

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CategoryBreakdown, type CategoryBreakdownRow } from '@/components/category-breakdown';
import { CategoryDetail } from '@/components/category-detail';
import { Chip } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { SpendBarChart, type BarDatum } from '@/components/spend-bar-chart';
import { StatTile } from '@/components/stat-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { MONTH_LABELS, type TxnFilter } from '@/core/analytics';
import { formatINR } from '@/core/domain/money';
import { useTheme } from '@/hooks/use-theme';
import { useCategoryIndex } from '@/hooks/use-reference-data';
import {
  useCategoryBreakdown,
  useDimensions,
  useMonthly,
  usePeriodTotals,
  useSubcategoryBreakdown,
  useYearlyTotals,
} from '@/hooks/use-analytics';
import { useTransactionCount } from '@/hooks/use-transactions';

export default function DashboardScreen() {
  const theme = useTheme();
  const router = useRouter();
  // Semantic colours (theme-aware) — each is always paired with a text label, so the red↔green
  // pair is never distinguished by colour alone.
  const SPEND = theme.spend;
  const INCOME = theme.income;
  const REFUND = theme.accent;

  const index = useCategoryIndex();
  const { years } = useDimensions();
  const yearly = useYearlyTotals();
  const { count: totalCount, loading } = useTransactionCount();

  // Selected period: 'all' (all time), a year, or null (default → latest year). A year can be
  // narrowed to one month by tapping a bar.
  const [selectedYear, setSelectedYear] = useState<number | 'all' | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  // The category whose sub-category drill-down sheet is open, if any.
  const [openCategoryId, setOpenCategoryId] = useState<number | null>(null);

  const isAll = selectedYear === 'all';
  // Default to the most recent year that has data (falls back to the current calendar year).
  const activeYear = typeof selectedYear === 'number' ? selectedYear : (years[0] ?? new Date().getFullYear());

  // The active period as a TxnFilter for the SQL aggregates: all-time, a whole year, or one month.
  const periodFilter: TxnFilter = useMemo(
    () =>
      isAll
        ? {}
        : selectedMonth != null
          ? { from: { year: activeYear, month: selectedMonth }, to: { year: activeYear, month: selectedMonth } }
          : { from: { year: activeYear, month: 1 }, to: { year: activeYear, month: 12 } },
    [isAll, activeYear, selectedMonth],
  );

  const monthly = useMonthly(activeYear);
  const periodTotals = usePeriodTotals(periodFilter);
  const catBreakdown = useCategoryBreakdown(periodFilter);
  const subBreakdown = useSubcategoryBreakdown(openCategoryId, periodFilter);

  const bars: BarDatum[] = monthly.map((m) => ({
    key: m.label,
    label: m.label,
    value: m.totals.netSpentPaise,
  }));
  // Net-spend-by-year bars — the main chart when "All" is selected.
  const yearBars: BarDatum[] = yearly.map((y) => ({
    key: String(y.year),
    label: String(y.year),
    value: Math.max(0, y.totals.netSpentPaise),
  }));

  const catRows: CategoryBreakdownRow[] = useMemo(
    () =>
      catBreakdown.map((c) => {
        const cat = c.categoryId != null ? index.byId.get(c.categoryId) : null;
        const label = cat ? `${cat.emoji ? cat.emoji + ' ' : ''}${cat.name}` : 'Uncategorized';
        // Uncategorized has no sub-categories to drill into, so make it tappable straight through
        // to the Reports list (filtered to uncategorized) — with the same chevron as real rows.
        return { key: String(c.categoryId ?? 'none'), label, value: c.spentPaise, id: c.categoryId, drillable: c.categoryId == null };
      }),
    [catBreakdown, index],
  );

  // Sub-category split for the open category, within the current period (for the drill-down sheet).
  const openCategory = openCategoryId != null ? index.byId.get(openCategoryId) ?? null : null;
  const subRows: CategoryBreakdownRow[] = useMemo(() => {
    if (openCategoryId == null || !openCategory) return [];
    const subNames = new Map(openCategory.subcategories.map((s) => [s.id, s.name]));
    return subBreakdown.map((s) => ({
      key: String(s.subcategoryId ?? 'none'),
      label: s.subcategoryId != null ? (subNames.get(s.subcategoryId) ?? 'Sub-category') : 'No sub-category',
      value: s.spentPaise,
      id: s.subcategoryId, // makes a real sub-category row tappable → deep-link to Reports
    }));
  }, [subBreakdown, openCategoryId, openCategory]);
  const subTotal = subRows.reduce((sum, r) => sum + r.value, 0);
  const subCount = subBreakdown.reduce((n, s) => n + s.txnCount, 0);

  const yearRows: CategoryBreakdownRow[] = yearly.map((y) => ({
    key: String(y.year),
    label: String(y.year),
    value: Math.max(0, y.totals.netSpentPaise),
  }));
  const allYearsNet = yearly.reduce((s, y) => s + Math.max(0, y.totals.netSpentPaise), 0);

  const periodLabel = isAll
    ? 'All time'
    : selectedMonth != null
      ? `${MONTH_LABELS[selectedMonth - 1]} ${activeYear}`
      : `${activeYear}`;

  const selectYear = (y: number | 'all') => {
    setSelectedYear(y);
    setSelectedMonth(null); // a new period starts on its whole-period view
  };
  const onBarSelect = (i: number) => {
    const month = i + 1;
    setSelectedMonth((cur) => (cur === month ? null : month)); // tap again to zoom back out
  };
  // In "All" mode the main chart is per-year; tapping a year drills into it.
  const onYearBarSelect = (i: number) => {
    const y = yearly[i]?.year;
    if (y != null) selectYear(y);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedText type="subtitle">Dashboard</ThemedText>

          {loading ? null : totalCount === 0 ? (
            <EmptyState
              style={styles.empty}
              message="No transactions yet. Import a Paytm statement on the Import tab and your monthly and yearly spend will show up here."
            />
          ) : (
            <>
              {/* Period selector: All + each year */}
              <View style={styles.chipsRow}>
                <Chip label="All" selected={isAll} onPress={() => selectYear('all')} />
                {years.map((y) => (
                  <Chip key={y} label={String(y)} selected={!isAll && y === activeYear} onPress={() => selectYear(y)} />
                ))}
              </View>

              {/* Summary tiles for the selected period. Each (except the derived "Net spent") opens
                  Reports filtered to that slice of the same period. */}
              <View style={styles.tiles}>
                <StatTile label="Net spent" value={formatINR(periodTotals.netSpentPaise)} color={theme.text} />
                <StatTile
                  label="Spent"
                  value={formatINR(periodTotals.spentPaise)}
                  color={SPEND}
                  onPress={() => goToReports({ direction: 'out' })}
                />
              </View>
              <View style={styles.tiles}>
                <StatTile
                  label="Received"
                  value={formatINR(periodTotals.receivedPaise)}
                  color={INCOME}
                  onPress={() => goToReports({ direction: 'in', refund: '0' })}
                />
                <StatTile
                  label="Refunds"
                  value={formatINR(periodTotals.refundPaise)}
                  color={REFUND}
                  onPress={() => goToReports({ refund: '1' })}
                />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {periodLabel} · {periodTotals.txnCount} transaction
                {periodTotals.txnCount === 1 ? '' : 's'} · self-transfers excluded
              </ThemedText>

              {/* Net-spend chart: per-year in "All" mode, otherwise per-month for the active year. */}
              {isAll ? (
                <>
                  <View style={styles.sectionHead}>
                    <ThemedText type="smallBold">Net spend by year</ThemedText>
                  </View>
                  <ThemedView type="backgroundElement" style={styles.card}>
                    <SpendBarChart data={yearBars} color={SPEND} selectedIndex={null} onSelect={onYearBarSelect} formatValue={formatINR} />
                    <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                      Tap a year to drill into it. Bars are net spend (spending minus refunds).
                    </ThemedText>
                  </ThemedView>
                </>
              ) : (
                <>
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
                </>
              )}

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
                    else openInReports(null); // Uncategorized → straight to the Reports list
                  }}
                />
                {catRows.length > 0 && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                    Tap a category to see its sub-category breakdown.
                  </ThemedText>
                )}
              </ThemedView>

              {/* Yearly overview (hidden in All mode — the main chart already shows it) */}
              {!isAll && yearRows.length > 1 && (
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
        onViewTransactions={() => openInReports(openCategoryId)}
        onSubcategoryPress={(subId) => openInReports(openCategoryId, subId)}
      />
    </ThemedView>
  );

  // The current Dashboard period as Reports deep-link params: nothing in All mode, else the year
  // (plus month when a single month is selected).
  function periodParams(): Record<string, string> {
    if (isAll) return {};
    const p: Record<string, string> = { year: String(activeYear) };
    if (selectedMonth != null) p.month = String(selectedMonth);
    return p;
  }

  // Navigate to Reports with the current period plus the given extra filter params. `t` is a
  // per-tap nonce so re-tapping the same tile (even after a Clear all in Reports) re-applies it.
  function goToReports(extra: Record<string, string>) {
    router.navigate({ pathname: '/reports', params: { ...periodParams(), ...extra, t: String(Date.now()) } });
  }

  // Deep-link to Reports pre-filtered to this category (+ optional sub-category) and the period.
  // `categoryId === null` means the Uncategorized bucket.
  function openInReports(categoryId: number | null, subcategoryId?: number) {
    setOpenCategoryId(null);
    goToReports({
      ...(categoryId != null ? { categoryId: String(categoryId) } : { uncategorized: '1' }),
      ...(subcategoryId != null ? { subcategoryId: String(subcategoryId) } : {}),
    });
  }
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
