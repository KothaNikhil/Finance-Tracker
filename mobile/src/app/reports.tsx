/**
 * Activity: a list-first workspace. One {@link TxnFilter} — month range, category +
 * sub-category, account, "For" person, direction, free-text search — drives everything: the
 * summary, the (virtualized, paged) transaction list, the collapsible breakdown cards, AND the
 * Excel export. So what you see is exactly what you export.
 *
 * Everything is server-side now: the list pages in via {@link useTransactionList} (growing LIMIT),
 * the summary/breakdowns are SQL aggregates, and the filter dimensions come from DISTINCT queries —
 * so the screen stays fast at tens of thousands of rows. The filter can be seeded by a deep link
 * from Home (tap a category → land here pre-filtered).
 */

import { SymbolView } from 'expo-symbols';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActivityFilterBar } from '@/components/activity-filter-bar';
import { ActivitySummary } from '@/components/activity-summary';
import { Button } from '@/components/button';
import { CategoryBreakdown, type CategoryBreakdownRow } from '@/components/category-breakdown';
import { EmptyState } from '@/components/empty-state';
import { FeedbackBanner } from '@/components/feedback-banner';
import { IconButton } from '@/components/icon-button';
import { lendingRowLabel, type LendingLoanRef } from '@/components/lending-row-label';
import { ListSection } from '@/components/list-section';
import { ReportsFilters } from '@/components/reports-filters';
import { ScreenHeader } from '@/components/screen-header';
import { Skeleton } from '@/components/skeleton';
import { TextField } from '@/components/text-field';
import { TextInputModal } from '@/components/text-input-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TransactionList } from '@/components/transaction-list';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  MONTH_LABELS,
  type GroupSpend,
  type MonthKey,
  type TxnFilter,
} from '@/core/analytics';
import type { TransactionRow } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { useBusyAction } from '@/hooks/use-busy-action';
import { useTheme } from '@/hooks/use-theme';
import { useLoans } from '@/hooks/use-lending';
import { useTransactionDetail } from '@/hooks/use-transaction-detail';
import { useCategoryIndex, useLists } from '@/hooks/use-reference-data';
import { useDimensions, usePeriodTotals, useReportsBreakdowns, useSummary } from '@/hooks/use-analytics';
import { useTransactionCount, useTransactionList } from '@/hooks/use-transactions';
import { saveFilteredToFolder, shareFilteredToExcel } from '@/services/export';

const TOP_MERCHANTS = 12;
const DIRECTION_META = {
  out: { sign: '−', color: 'spend', label: 'Spent' },
  in: { sign: '+', color: 'income', label: 'Received' },
  self: { sign: '⇄', color: 'review', label: 'Transfer' },
} as const;

export default function ActivityScreen() {
  const theme = useTheme();
  const router = useRouter();
  const REFUND = theme.accent;

  const index = useCategoryIndex();
  const lists = useLists();
  const { years, months, accounts } = useDimensions();
  // Unfiltered total — distinguishes "no data at all" (import first) from "no match for filters".
  const {
    count: totalCount,
    loading: totalLoading,
    error: totalError,
    retry: retryTotal,
  } = useTransactionCount();

  const subNames = useMemo(() => {
    const m = new Map<number, string>();
    index.categories.forEach((c) => c.subcategories.forEach((s) => m.set(s.id, s.name)));
    return m;
  }, [index]);
  const personNames = useMemo(() => new Map(lists.people.map((p) => [p.id, p.name])), [lists.people]);

  // Lending rows added in-app carry no merchant, so their identity comes from the loan they belong
  // to (or the loans a split is spread across).
  const { active: activeLoans, closed: closedLoans } = useLoans();
  const loanRefs = useMemo(() => {
    const byId = new Map<number, LendingLoanRef>();
    const byTxn = new Map<number, LendingLoanRef[]>();
    for (const loan of [...activeLoans, ...closedLoans]) {
      const ref: LendingLoanRef = { id: loan.id, name: loan.name, personName: loan.personName };
      byId.set(loan.id, ref);
      // Two slices on one loan (part repayment, part interest) are still one loan.
      for (const txnId of new Set(loan.allocations.map((allocation) => allocation.txnId))) {
        byTxn.set(txnId, [...(byTxn.get(txnId) ?? []), ref]);
      }
    }
    return { byId, byTxn };
  }, [activeLoans, closedLoans]);

  const lendingLabelFor = (txn: TransactionRow) =>
    lendingRowLabel(txn, {
      personName: txn.personId != null ? (personNames.get(txn.personId) ?? null) : null,
      loan: txn.loanId != null ? (loanRefs.byId.get(txn.loanId) ?? null) : null,
      splitLoans: loanRefs.byTxn.get(txn.id) ?? [],
    });

  // Filter state. A deep link (params) seeds it; otherwise default to the most recent year.
  const params = useLocalSearchParams<{
    categoryId?: string;
    subcategoryId?: string;
    year?: string;
    month?: string;
    uncategorized?: string;
    review?: string;
    direction?: string;
    refund?: string;
    // A per-tap nonce so every deep link is a fresh one-shot command — even when it repeats the
    // exact same filter (e.g. tapping "Needs review" again after a Clear all). Without it, an
    // identical param set is deduped and the filter silently isn't re-applied.
    t?: string;
  }>();
  const paramFilter = buildParamFilter(params);
  const defaultFilter: TxnFilter = years[0] != null ? { from: { year: years[0], month: 1 }, to: { year: years[0], month: 12 } } : {};

  const [filter, setFilter] = useState<TxnFilter | null>(null);
  // Seed from an incoming deep link (once per distinct navigation — keyed on the nonce, so a
  // repeated identical filter still re-applies).
  const [paramSig, setParamSig] = useState<string | null>(null);
  const hasParams = !!(
    params.categoryId ||
    params.subcategoryId ||
    params.year ||
    params.uncategorized ||
    params.review ||
    params.direction ||
    params.refund
  );
  const sig = hasParams ? `${JSON.stringify(paramFilter)}|${params.t ?? ''}` : '';
  if (sig !== '' && sig !== paramSig) {
    setParamSig(sig);
    setFilter(paramFilter);
  }

  // Free-text search lives in its own committed state (the box debounces into it). `searchReset`
  // is used as the box's React key, so incrementing it remounts the box (clearing its text) when
  // the user clears all filters — no setState-in-effect needed.
  const [search, setSearch] = useState('');
  const [searchReset, setSearchReset] = useState(0);
  // Plain functions — the React Compiler auto-memoizes them (manual useCallback here made the
  // compiler bail on optimizing this component).
  const onSearch = (q: string) => setSearch(q);

  const baseFilter = filter ?? defaultFilter;
  // Identity churn is harmless: the list/summary/breakdown hooks key on JSON.stringify(filter).
  const activeFilter: TxnFilter = { ...baseFilter, search: search || undefined };
  const update = (patch: Partial<TxnFilter>) => setFilter({ ...baseFilter, ...patch });

  const clearAll = () => {
    setFilter({});
    setSearch('');
    setSearchReset((n) => n + 1);
  };

  const [filtersOpen, setFiltersOpen] = useState(false);

  // Server-side: paged list + total + summary + breakdowns for the active filter.
  const {
    rows: filtered,
    count: filteredCount,
    hasMore,
    loadMore,
    loading,
    error: listError,
    retry: retryList,
  } = useTransactionList(activeFilter);
  const totals = usePeriodTotals(activeFilter);
  const summary = useSummary(activeFilter);
  const { merchants, accounts: accountsSpend, people: peopleSpend, cashback } = useReportsBreakdowns(activeFilter);
  const dataError = totalError ?? listError ?? summary.error;
  const retryData = () => {
    retryTotal();
    retryList();
    summary.retry();
  };

  // Labels for the active-filter chips.
  const catLabel = labelForCategory(activeFilter.categoryId, index);
  const subLabel = labelForSub(activeFilter.subcategoryId, subNames);
  const periodLabel = labelForPeriod(activeFilter);
  const chips = buildChips(activeFilter, { periodLabel, catLabel, subLabel, personNames }, update);

  // The transaction detail sheet (category edit, money-lent, delete) is app-wide — mounted once at
  // the root — so a row tap just opens it by id.
  const { openTxn } = useTransactionDetail();

  // Collapsible breakdowns.
  const [showBreakdowns, setShowBreakdowns] = useState(false);

  // Export the filtered set (with a rename step).
  const { busy: exporting, run: runExport } = useBusyAction('Could not export');
  const [renameOpen, setRenameOpen] = useState(false);
  const defaultName = defaultFileName(activeFilter, catLabel);

  const onExport = () => setRenameOpen(true);
  const doExport = (fileName: string) => {
    setRenameOpen(false);
    Alert.alert('Export', 'Save the workbook to a folder, or share it.', [
      {
        text: 'Save to a folder',
        onPress: () =>
          runExport(async () => {
            const res = await saveFilteredToFolder(activeFilter, fileName);
            if (res.saved) Alert.alert('Saved', `${res.fileName} was saved to the folder you chose.`);
          }),
      },
      {
        text: 'Share…',
        onPress: () =>
          runExport(async () => {
            const res = await shareFilteredToExcel(activeFilter, fileName);
            if (!res.shared) Alert.alert('Saved', `Sharing isn’t available here. Saved as ${res.fileName}.`);
          }),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const toRows = (groups: GroupSpend[]): CategoryBreakdownRow[] =>
    groups.map((g) => ({ key: g.key, label: g.key, value: g.spentPaise }));
  const personRows: CategoryBreakdownRow[] = peopleSpend.map((p) => ({
    key: String(p.personId ?? 'none'),
    label: p.personId != null ? (personNames.get(p.personId) ?? 'Unknown') : 'Not assigned',
    value: p.spentPaise,
  }));

  const header = (
    <View style={styles.headerGroup}>
      <ScreenHeader
        title="Activity"
        action={
          <IconButton
            name={{ ios: 'square.and.arrow.up', android: 'ios_share', web: 'ios_share' }}
            label={exporting ? 'Exporting filtered transactions' : 'Export filtered transactions'}
            onPress={onExport}
            disabled={exporting}
            accessibilityHint="Names the workbook, then offers save or share"
          />
        }
      />

      {/* Search — keyed on searchReset so "Clear all" remounts (clears) it. */}
      <ActivityFilterBar
        chips={chips}
        search={<SearchBox key={searchReset} onSearch={onSearch} />}
        activeCount={chips.length}
        onOpenFilters={() => setFiltersOpen(true)}
        onClearAll={clearAll}
        showClearAll={filter !== null || search !== ''}
      />

      <ActivitySummary
        loading={loading}
        spentPaise={totals.spentPaise}
        receivedPaise={totals.receivedPaise}
      />

      {!summary.loading && summary.reviewCount > 0 ? (
        <FeedbackBanner
          tone="review"
          title={`${summary.reviewCount} transaction${summary.reviewCount === 1 ? '' : 's'} need review`}
          actionLabel={activeFilter.needsReview ? undefined : 'Review'}
          onAction={activeFilter.needsReview ? undefined : () => update({ needsReview: true })}
        />
      ) : null}

      <Button
        label={showBreakdowns ? 'Hide breakdowns' : 'Show breakdowns'}
        icon={{ ios: 'chart.bar.xaxis', android: 'bar_chart', web: 'bar_chart' }}
        variant="ghost"
        size="small"
        onPress={() => setShowBreakdowns((visible) => !visible)}
        accessibilityHint="Shows merchant, account, person, and refund totals"
        style={styles.breakdownToggle}
      />

      {showBreakdowns ? (
        <View style={styles.breakdowns}>
          <ListSection title="TOP MERCHANTS">
            <CategoryBreakdown
              rows={toRows(merchants.slice(0, TOP_MERCHANTS))}
              total={merchants.reduce((sum, merchant) => sum + merchant.spentPaise, 0)}
              color={theme.accent}
            />
          </ListSection>
          <ListSection title="BY ACCOUNT">
            <CategoryBreakdown
              rows={toRows(accountsSpend)}
              total={accountsSpend.reduce((sum, account) => sum + account.spentPaise, 0)}
              color={theme.accent}
            />
          </ListSection>
          <ListSection title="BY PERSON">
            <CategoryBreakdown
              rows={personRows}
              total={peopleSpend.reduce((sum, person) => sum + person.spentPaise, 0)}
              color={theme.accent}
            />
          </ListSection>
          <ListSection title="CASHBACK AND REFUNDS">
            <View style={styles.cashbackRow}>
              <ThemedText type="small" themeColor="textSecondary">
                {cashback.count} received · subtracted from spending
              </ThemedText>
              <ThemedText type="stat" style={[styles.tabular, { color: REFUND }]}>
                {formatINR(cashback.totalPaise)}
              </ThemedText>
            </View>
          </ListSection>
        </View>
      ) : null}

      <View style={styles.listHeading}>
        <ThemedText type="heading">Transactions</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {filteredCount} result{filteredCount === 1 ? '' : 's'}
        </ThemedText>
      </View>
    </View>
  );

  const footer = (
    <ThemedText type="caption" themeColor="textSecondary" style={styles.listFooter}>
      You’ve reached the end of this Activity view.
    </ThemedText>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {dataError ? (
          <View style={styles.content}>
            <ScreenHeader title="Activity" />
            <EmptyState
              style={styles.empty}
              icon={{ ios: 'exclamationmark.triangle', android: 'error', web: 'error' }}
              title="Couldn’t load Activity"
              message="Your transactions are still safe. Try loading this view again."
              actionLabel="Try again"
              onAction={retryData}
            />
          </View>
        ) : totalLoading ? (
          <View style={styles.content}>
            <ScreenHeader title="Activity" />
            <ActivityScreenSkeleton />
          </View>
        ) : totalCount === 0 ? (
          <View style={styles.content}>
            <ScreenHeader title="Activity" />
            <EmptyState
              style={styles.empty}
              icon={{ ios: 'clock.arrow.circlepath', android: 'history', web: 'history' }}
              title="No transactions yet"
              message="Import a bank or UPI statement to search, filter, review, and export your activity."
              actionLabel="Go to Import"
              onAction={() => router.navigate({ pathname: '/import' })}
            />
          </View>
        ) : (
          <TransactionList
            rows={filtered}
            loading={loading}
            hasMore={hasMore}
            loadMore={loadMore}
            onPressRow={openTxn}
            categoryLabelFor={(t) => rowCategoryLabel(t, index.byId, subNames)}
            lendingLabelFor={lendingLabelFor}
            showReviewBadge
            groupBy="month-day"
            rowVariant="activity"
            ListHeaderComponent={header}
            ListFooterComponent={hasMore ? null : footer}
            ListLoadingComponent={<ActivityRowsSkeleton />}
            ListEmptyComponent={
              <EmptyState
                style={styles.empty}
                icon={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
                title="No matches"
                message="No transactions match these filters. Try clearing or widening them."
                actionLabel="Clear filters"
                onAction={clearAll}
              />
            }
            contentContainerStyle={styles.content}
          />
        )}
      </SafeAreaView>

      <ReportsFilters
        visible={filtersOpen}
        initial={baseFilter}
        years={years}
        months={months}
        categories={index.categories}
        accounts={accounts}
        people={lists.people}
        search={search}
        onApply={setFilter}
        onClose={() => setFiltersOpen(false)}
      />

      <TextInputModal
        visible={renameOpen}
        title="Export to Excel"
        message="Name the file, then choose where to save it."
        initialValue={defaultName}
        confirmLabel="Next"
        onCancel={() => setRenameOpen(false)}
        onConfirm={doExport}
      />
    </ThemedView>
  );
}

// --- Search box --------------------------------------------------------------

/**
 * Free-text search input. Holds its OWN text state and debounces (250ms) into `onSearch`, so each
 * keystroke doesn't re-render the parent list — which is what would remount the input and drop
 * focus mid-typing. The parent clears the box by changing its React `key` (remount).
 */
const SearchBox = React.memo(function SearchBox({ onSearch }: { onSearch: (q: string) => void }) {
  const theme = useTheme();
  const [text, setText] = useState('');

  useEffect(() => {
    const id = setTimeout(() => onSearch(text.trim()), 250);
    return () => clearTimeout(id);
  }, [text, onSearch]);

  return (
    <TextField
      value={text}
      onChangeText={setText}
      placeholder="Search merchant, note, or UPI ID"
      accessibilityLabel="Search Activity"
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="search"
      leading={
        <SymbolView
          name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
          size={20}
          tintColor={theme.textSecondary}
        />
      }
      trailing={
        text ? (
          <IconButton
            name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
            label="Clear search"
            onPress={() => setText('')}
            variant="plain"
            iconSize={18}
          />
        ) : undefined
      }
    />
  );
});

// --- helpers -----------------------------------------------------------------

function buildParamFilter(params: {
  categoryId?: string;
  subcategoryId?: string;
  year?: string;
  month?: string;
  uncategorized?: string;
  review?: string;
  direction?: string;
  refund?: string;
}): TxnFilter {
  const f: TxnFilter = {};
  if (params.year) {
    const y = parseInt(params.year, 10);
    if (!Number.isNaN(y)) {
      const m = params.month ? parseInt(params.month, 10) : NaN;
      if (!Number.isNaN(m)) {
        f.from = { year: y, month: m };
        f.to = { year: y, month: m };
      } else {
        f.from = { year: y, month: 1 };
        f.to = { year: y, month: 12 };
      }
    }
  }
  if (params.uncategorized) {
    f.categoryId = null; // the Uncategorized bucket
  } else if (params.categoryId) {
    const c = parseInt(params.categoryId, 10);
    if (!Number.isNaN(c)) f.categoryId = c;
  }
  if (params.subcategoryId) {
    const s = parseInt(params.subcategoryId, 10);
    if (!Number.isNaN(s)) f.subcategoryId = s;
  }
  if (params.direction === 'in' || params.direction === 'out' || params.direction === 'self') {
    f.direction = params.direction;
  }
  if (params.refund === '1') f.isRefund = true;
  else if (params.refund === '0') f.isRefund = false;
  if (params.review) f.needsReview = true;
  return f;
}

function labelForCategory(categoryId: number | null | undefined, index: ReturnType<typeof useCategoryIndex>): string {
  if (categoryId === undefined) return 'Any';
  if (categoryId === null) return 'Uncategorized';
  const c = index.byId.get(categoryId);
  return c ? `${c.emoji ? c.emoji + ' ' : ''}${c.name}` : 'Category';
}

function labelForSub(subId: number | null | undefined, subNames: Map<number, string>): string {
  if (subId === undefined) return 'Any';
  if (subId === null) return 'No sub-category';
  return subNames.get(subId) ?? 'Sub-category';
}

function labelForPeriod(f: TxnFilter): string {
  const ml = (m: MonthKey) => `${MONTH_LABELS[m.month - 1]} ${m.year}`;
  if (f.from && f.to) {
    if (f.from.year === f.to.year && f.from.month === 1 && f.to.month === 12) return String(f.from.year);
    if (f.from.year === f.to.year && f.from.month === f.to.month) return ml(f.from);
    return `${ml(f.from)} – ${ml(f.to)}`;
  }
  if (f.from) return `from ${ml(f.from)}`;
  if (f.to) return `up to ${ml(f.to)}`;
  return 'All time';
}

interface FilterChip {
  key: string;
  label: string;
  clear: () => void;
}

function buildChips(
  f: TxnFilter,
  labels: { periodLabel: string; catLabel: string; subLabel: string; personNames: Map<number, string> },
  update: (patch: Partial<TxnFilter>) => void,
): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.from || f.to) chips.push({ key: 'period', label: labels.periodLabel, clear: () => update({ from: undefined, to: undefined }) });
  if (f.categoryId !== undefined) chips.push({ key: 'cat', label: labels.catLabel, clear: () => update({ categoryId: undefined, subcategoryId: undefined }) });
  if (f.subcategoryId !== undefined) chips.push({ key: 'sub', label: labels.subLabel, clear: () => update({ subcategoryId: undefined }) });
  if (f.account !== undefined) chips.push({ key: 'acct', label: f.account, clear: () => update({ account: undefined }) });
  if (f.personId !== undefined) {
    const label = f.personId === null ? 'Not assigned' : (labels.personNames.get(f.personId) ?? 'Person');
    chips.push({ key: 'person', label, clear: () => update({ personId: undefined }) });
  }
  if (f.direction !== undefined) {
    chips.push({ key: 'dir', label: DIRECTION_META[f.direction]?.label ?? f.direction, clear: () => update({ direction: undefined }) });
  }
  if (f.isRefund !== undefined) {
    chips.push({ key: 'refund', label: f.isRefund ? 'Refunds' : 'Excl. refunds', clear: () => update({ isRefund: undefined }) });
  }
  if (f.needsReview !== undefined) {
    chips.push({ key: 'review', label: 'Needs review', clear: () => update({ needsReview: undefined }) });
  }
  if (f.minPaise !== undefined || f.maxPaise !== undefined) {
    chips.push({ key: 'amount', label: amountRangeLabel(f.minPaise, f.maxPaise), clear: () => update({ minPaise: undefined, maxPaise: undefined }) });
  }
  return chips;
}

/** A short label for the amount range chip, e.g. "₹50,000–₹10,00,000" / "≥ ₹50,000" / "≤ ₹1,000". */
function amountRangeLabel(minPaise: number | undefined, maxPaise: number | undefined): string {
  if (minPaise !== undefined && maxPaise !== undefined) return `${formatINR(minPaise)}–${formatINR(maxPaise)}`;
  if (minPaise !== undefined) return `≥ ${formatINR(minPaise)}`;
  return `≤ ${formatINR(maxPaise ?? 0)}`;
}

function defaultFileName(f: TxnFilter, catLabel: string): string {
  const parts = ['Finance-Tracker'];
  if (f.categoryId != null) parts.push(catLabel.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, ''));
  const mk = (m: MonthKey) => `${m.year}-${String(m.month).padStart(2, '0')}`;
  if (f.from && f.to && f.from.year === f.to.year && f.from.month === 1 && f.to.month === 12) parts.push(String(f.from.year));
  else if (f.from && f.to && f.from.year === f.to.year && f.from.month === f.to.month) parts.push(mk(f.from));
  else if (f.from && f.to) parts.push(`${mk(f.from)}_${mk(f.to)}`);
  else if (f.from) parts.push(`from-${mk(f.from)}`);
  else if (f.to) parts.push(`upto-${mk(f.to)}`);
  return parts.join('-');
}

function rowCategoryLabel(
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

function ActivityScreenSkeleton() {
  return (
    <View style={styles.loading} accessibilityLabel="Loading Activity">
      <Skeleton width="100%" height={44} />
      <Skeleton width="100%" height={62} />
      <ActivityRowsSkeleton />
    </View>
  );
}

function ActivityRowsSkeleton() {
  return (
    <View style={styles.rowsLoading} accessibilityLabel="Loading transactions">
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <View key={row} style={styles.loadingRow}>
          <Skeleton width={28} height={28} radius={14} />
          <View style={styles.loadingCopy}>
            <Skeleton width="68%" height={14} />
            <Skeleton width="46%" height={11} />
          </View>
          <Skeleton width={78} height={16} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  headerGroup: { gap: Spacing.two, marginBottom: Spacing.one },
  empty: { marginTop: Spacing.three },
  breakdownToggle: { alignSelf: 'flex-start' },
  breakdowns: { gap: Spacing.three },
  tabular: { fontVariant: ['tabular-nums'] },
  cashbackRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  listHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  listFooter: { paddingVertical: Spacing.three, textAlign: 'center' },
  loading: { gap: Spacing.two, marginTop: Spacing.two },
  rowsLoading: { gap: 0 },
  loadingRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  loadingCopy: { flex: 1, gap: Spacing.half },
});
