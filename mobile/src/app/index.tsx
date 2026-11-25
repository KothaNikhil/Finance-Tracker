/**
 * Home: monthly, yearly, and all-time spending in ₹.
 *
 * The numbers come from the canonical SQL analytics layer: transfers, lending principal, and
 * linked card-payment legs are excluded; refunds offset spend instead of becoming income.
 *
 * "Net spent" (spent − refunds) is the headline metric and what the month/year bars plot; the
 * category breakdown shows gross spend composition (so its bars sum to the "Spent" tile).
 */

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '@/components/card';
import { CategoryBreakdown, type CategoryBreakdownRow } from '@/components/category-breakdown';
import { CategoryDetail } from '@/components/category-detail';
import { DriveLoadingState, useFirstDriveDownload } from '@/components/drive-loading-state';
import { EmptyState } from '@/components/empty-state';
import { FeedbackBanner } from '@/components/feedback-banner';
import {
  DEFAULT_HOME_PERIOD_MODE,
  HomePeriodSelector,
  type HomePeriodMode,
} from '@/components/home-period-selector';
import { InfoDisclosure } from '@/components/info-disclosure';
import { ScreenHeader } from '@/components/screen-header';
import { Skeleton } from '@/components/skeleton';
import { SpendBarChart, type BarDatum } from '@/components/spend-bar-chart';
import { StatStrip, StatTile } from '@/components/stat-tile';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { type TxnFilter } from '@/core/analytics';
import { formatINR } from '@/core/domain/money';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { useCategoryIndex } from '@/hooks/use-reference-data';
import {
  useCategoryBreakdown,
  useDimensions,
  useMonthly,
  usePeriodTotals,
  useSummary,
  useSubcategoryBreakdown,
  useYearlyTotals,
} from '@/hooks/use-analytics';
import { useTransactionCount } from '@/hooks/use-transactions';

const HOME_COUNTING_NOTE =
  'Individual credit-card statement purchases count as spending here and in the trend. ' +
  'Self-transfers, lending principal, and a card bill payment once it is linked to its statement ' +
  'are excluded from these totals, so a card bill is never counted twice. A bill payment that is ' +
  'not linked to a statement still counts. Refunds and cashback reduce net spent and never count ' +
  'as income. Amounts are stored as integer paise and shown in Indian Rupees.';
const MONTH_TREND_HINT =
  'Select a bar for that month; select it again to return to the whole year.';
const ALL_TREND_HINT = 'Select a year to open its monthly view.';
const CATEGORY_BREAKDOWN_NOTE =
  'Every category is shown. Select one for its sub-category breakdown.';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const auth = useAuth();
  // Semantic colours (theme-aware) — each is always paired with a text label, so the red↔green
  // pair is never distinguished by colour alone.
  const SPEND = theme.spend;
  const INCOME = theme.income;
  const REFUND = theme.accent;

  const index = useCategoryIndex();
  const { years, months } = useDimensions();
  const yearly = useYearlyTotals();
  const {
    count: totalCount,
    loading,
    error: countError,
    retry: retryCount,
  } = useTransactionCount();
  const firstDriveDownload = useFirstDriveDownload();

  // Start at the newest month that actually has data. The explicit Month / Year / All control
  // keeps every previous period scope available without making the default an empty calendar page.
  const now = new Date();
  const latestMonth = months[0] ?? {
    year: years[0] ?? now.getFullYear(),
    month: now.getMonth() + 1,
  };
  const [periodMode, setPeriodMode] = useState<HomePeriodMode>(DEFAULT_HOME_PERIOD_MODE);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  // The category whose sub-category drill-down sheet is open, if any.
  const [openCategoryId, setOpenCategoryId] = useState<number | null>(null);

  const isAll = periodMode === 'all';
  const activeYear = selectedYear ?? latestMonth.year;
  const latestMonthForActiveYear = months.find((month) => month.year === activeYear)?.month ?? latestMonth.month;
  const activeMonth = selectedMonth ?? latestMonthForActiveYear;

  // The active period as a TxnFilter for the SQL aggregates: all-time, a whole year, or one month.
  const periodFilter: TxnFilter = useMemo(
    () =>
      isAll
        ? {}
        : periodMode === 'month'
          ? { from: { year: activeYear, month: activeMonth }, to: { year: activeYear, month: activeMonth } }
          : { from: { year: activeYear, month: 1 }, to: { year: activeYear, month: 12 } },
    [isAll, periodMode, activeYear, activeMonth],
  );

  const monthly = useMonthly(activeYear);
  const periodTotals = usePeriodTotals(periodFilter);
  const periodSummary = useSummary(periodFilter);
  const catBreakdown = useCategoryBreakdown(periodFilter);
  const subBreakdown = useSubcategoryBreakdown(openCategoryId, periodFilter);
  const dataError = countError ?? periodSummary.error;
  const retryData = () => {
    retryCount();
    periodSummary.retry();
  };

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
        // to Activity (filtered to uncategorized) — with the same chevron as real rows.
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
      id: s.subcategoryId, // makes a real sub-category row tappable → deep-link to Activity
    }));
  }, [subBreakdown, openCategoryId, openCategory]);
  const subTotal = subRows.reduce((sum, r) => sum + r.value, 0);
  const subCount = subBreakdown.reduce((n, s) => n + s.txnCount, 0);

  const periodLabel = isAll
    ? 'All time'
    : periodMode === 'month'
      ? `${MONTH_NAMES[activeMonth - 1]} ${activeYear}`
      : `${activeYear}`;

  const selectYear = (y: number) => {
    setSelectedYear(y);
    setSelectedMonth(null);
    setPeriodMode('year');
  };
  const onBarSelect = (i: number) => {
    const month = i + 1;
    if (periodMode === 'month' && month === activeMonth) {
      setPeriodMode('year'); // tapping the selected month again resets to the whole year
      return;
    }
    setSelectedYear(activeYear);
    setSelectedMonth(month);
    setPeriodMode('month');
  };
  // In "All" mode the main chart is per-year; tapping a year drills into it.
  const onYearBarSelect = (i: number) => {
    const y = yearly[i]?.year;
    if (y != null) selectYear(y);
  };

  const oldestMonth = months[months.length - 1] ?? latestMonth;
  const activeMonthOrdinal = monthOrdinal(activeYear, activeMonth);
  const oldestMonthOrdinal = monthOrdinal(oldestMonth.year, oldestMonth.month);
  const latestMonthOrdinal = monthOrdinal(latestMonth.year, latestMonth.month);
  const yearIndex = years.indexOf(activeYear);
  const olderYear = yearIndex >= 0 ? years[yearIndex + 1] : years.find((year) => year < activeYear);
  const newerYear =
    yearIndex > 0
      ? years[yearIndex - 1]
      : yearIndex < 0
        ? [...years].reverse().find((year) => year > activeYear)
        : undefined;
  const canGoPrevious =
    periodMode === 'month'
      ? activeMonthOrdinal > oldestMonthOrdinal
      : periodMode === 'year'
        ? olderYear != null
        : false;
  const canGoNext =
    periodMode === 'month'
      ? activeMonthOrdinal < latestMonthOrdinal
      : periodMode === 'year'
        ? newerYear != null
        : false;

  const movePeriod = (direction: -1 | 1) => {
    if (periodMode === 'month') {
      const next = monthFromOrdinal(activeMonthOrdinal + direction);
      setSelectedYear(next.year);
      setSelectedMonth(next.month);
    } else if (periodMode === 'year') {
      const nextYear = direction < 0 ? olderYear : newerYear;
      if (nextYear != null) {
        setSelectedYear(nextYear);
        setSelectedMonth(null);
      }
    }
  };

  const displayName = preferredName(auth.session?.user?.user_metadata);
  const headerTitle = displayName ?? 'Home';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ScreenHeader title={headerTitle} />

          {dataError ? (
            <EmptyState
              style={styles.empty}
              icon={{ ios: 'exclamationmark.triangle', android: 'error', web: 'error' }}
              title="Couldn’t load Home"
              message="Your finance data is still safe. Try loading the overview again."
              actionLabel="Try again"
              onAction={retryData}
            />
          ) : loading ? (
            <HomeLoadingSkeleton />
          ) : totalCount === 0 && firstDriveDownload ? (
            <DriveLoadingState style={styles.empty} />
          ) : totalCount === 0 ? (
            <EmptyState
              style={styles.empty}
              icon={{ ios: 'tray.and.arrow.down', android: 'download', web: 'download' }}
              title="Your overview starts here"
              message="Import a bank or UPI statement to see net spending, trends, and every category in one place."
              actionLabel="Go to Import"
              onAction={() => router.navigate({ pathname: '/import' })}
            />
          ) : (
            <>
              <HomePeriodSelector
                mode={periodMode}
                label={periodLabel}
                canGoPrevious={canGoPrevious}
                canGoNext={canGoNext}
                onPrevious={() => movePeriod(-1)}
                onNext={() => movePeriod(1)}
                onModeChange={setPeriodMode}
              />

              {periodSummary.loading ? (
                <HomeSummarySkeleton />
              ) : (
                <>
                  <Card style={styles.hero}>
                    <ThemedText type="overline" themeColor="textSecondary">
                      NET SPENT
                    </ThemedText>
                    <ThemedText
                      type="amountLarge"
                      style={{ color: periodTotals.netSpentPaise < 0 ? INCOME : theme.text }}
                      accessibilityLabel={`Net spent ${formatINR(periodTotals.netSpentPaise)}`}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.72}
                    >
                      {formatINR(periodTotals.netSpentPaise)}
                    </ThemedText>
                    <InfoDisclosure label="How these totals are counted" text={HOME_COUNTING_NOTE}>
                      <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                        {periodLabel} · {periodTotals.txnCount} counted transaction
                        {periodTotals.txnCount === 1 ? '' : 's'}
                      </ThemedText>
                    </InfoDisclosure>

                    <View style={[styles.heroRule, { backgroundColor: theme.border }]} />

                    <StatStrip>
                      <StatTile
                        variant="column"
                        label="Spent"
                        value={formatINR(periodTotals.spentPaise)}
                        color={SPEND}
                        onPress={() => goToReports({ direction: 'out' })}
                      />
                      <StatTile
                        variant="column"
                        label="Received"
                        value={formatINR(periodTotals.receivedPaise)}
                        color={INCOME}
                        onPress={() => goToReports({ direction: 'in', refund: '0' })}
                      />
                      <StatTile
                        variant="column"
                        label="Refunds"
                        value={formatINR(periodTotals.refundPaise)}
                        color={REFUND}
                        onPress={() => goToReports({ refund: '1' })}
                      />
                    </StatStrip>
                  </Card>

                  <InfoDisclosure
                    label={isAll ? 'How to use the yearly trend' : 'How to use the monthly trend'}
                    text={isAll ? ALL_TREND_HINT : MONTH_TREND_HINT}
                    style={styles.sectionHead}
                  >
                    <View style={styles.sectionHeadRow}>
                      <ThemedText type="heading">{isAll ? 'Yearly trend' : 'Monthly trend'}</ThemedText>
                      {!isAll ? (
                        <ThemedText type="small" themeColor="textSecondary" style={styles.tabular}>
                          {activeYear}
                        </ThemedText>
                      ) : null}
                    </View>
                  </InfoDisclosure>
                  <Card padding="small">
                    {isAll ? (
                      <SpendBarChart
                        data={yearBars}
                        color={theme.accent}
                        selectedIndex={null}
                        onSelect={onYearBarSelect}
                        formatValue={formatINR}
                      />
                    ) : (
                      <SpendBarChart
                        data={bars}
                        color={theme.accent}
                        selectedIndex={periodMode === 'month' ? activeMonth - 1 : null}
                        onSelect={onBarSelect}
                        formatValue={formatINR}
                      />
                    )}
                  </Card>

                  {periodSummary.reviewCount > 0 ? (
                    <FeedbackBanner
                      tone="review"
                      title={`${periodSummary.reviewCount} transaction${periodSummary.reviewCount === 1 ? '' : 's'} need review`}
                      actionLabel="Review now"
                      onAction={() => goToReports({ review: '1' })}
                    />
                  ) : null}

                  <InfoDisclosure
                    label="About the category breakdown"
                    text={CATEGORY_BREAKDOWN_NOTE}
                    style={styles.sectionHead}
                  >
                    <View style={styles.sectionHeadRow}>
                      <ThemedText type="heading">Where it went</ThemedText>
                      <ThemedText type="caption" themeColor="textSecondary">
                        {catRows.length} categor{catRows.length === 1 ? 'y' : 'ies'} · {periodLabel}
                      </ThemedText>
                    </View>
                  </InfoDisclosure>
                  <Card padding="small">
                    <CategoryBreakdown
                      rows={catRows}
                      total={periodTotals.spentPaise}
                      color={theme.accent}
                      onRowPress={(row) => {
                        if (row.id != null) setOpenCategoryId(row.id);
                        else openInReports(null); // Uncategorized → straight to the Activity list
                      }}
                    />
                  </Card>
                </>
              )}
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

  // The current Home period as Activity deep-link params: nothing in All mode, else the year
  // (plus month when a single month is selected).
  function periodParams(): Record<string, string> {
    if (isAll) return {};
    const p: Record<string, string> = { year: String(activeYear) };
    if (periodMode === 'month') p.month = String(activeMonth);
    return p;
  }

  // Navigate to Activity with the current period plus the given extra filter params. `t` is a
  // per-tap nonce so re-tapping the same tile (even after a Clear all in Activity) re-applies it.
  function goToReports(extra: Record<string, string>) {
    router.navigate({ pathname: '/reports', params: { ...periodParams(), ...extra, t: String(Date.now()) } });
  }

  // Deep-link to Activity pre-filtered to this category (+ optional sub-category) and the period.
  // `categoryId === null` means the Uncategorized bucket.
  function openInReports(categoryId: number | null, subcategoryId?: number) {
    setOpenCategoryId(null);
    goToReports({
      ...(categoryId != null ? { categoryId: String(categoryId) } : { uncategorized: '1' }),
      ...(subcategoryId != null ? { subcategoryId: String(subcategoryId) } : {}),
    });
  }
}

function HomeLoadingSkeleton() {
  return (
    <View style={styles.loading} accessibilityLabel="Loading Home">
      <Skeleton width="100%" height={36} />
      <HomeSummarySkeleton />
    </View>
  );
}

function HomeSummarySkeleton() {
  return (
    <View style={styles.loading} accessibilityLabel="Loading summary">
      <Skeleton width="100%" height={132} />
      <Skeleton width="100%" height={168} />
      <Skeleton width="100%" height={120} />
    </View>
  );
}

function monthOrdinal(year: number, month: number): number {
  return year * 12 + month - 1;
}

function monthFromOrdinal(value: number): { year: number; month: number } {
  return { year: Math.floor(value / 12), month: (value % 12) + 1 };
}

function preferredName(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const values = metadata as Record<string, unknown>;
  const candidate = [values.given_name, values.name, values.full_name].find(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  );
  return candidate?.trim().split(/\s+/)[0] ?? null;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.two,
  },
  empty: { marginTop: Spacing.three },
  hero: { gap: Spacing.half },
  heroRule: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.two },
  tabular: { fontVariant: ['tabular-nums'] },
  sectionHead: { marginTop: Spacing.two },
  sectionHeadRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  loading: { gap: Spacing.two },
});
