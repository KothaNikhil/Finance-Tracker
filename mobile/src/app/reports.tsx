/**
 * Reports (Block B): a list-first workspace. One {@link TxnFilter} — month range, category +
 * sub-category, account, "For" person, direction, free-text search — drives everything: the
 * summary, the (virtualized, paged) transaction list, the collapsible breakdown cards, AND the
 * Excel export. So what you see is exactly what you export.
 *
 * Everything is server-side now: the list pages in via {@link useTransactionList} (growing LIMIT),
 * the summary/breakdowns are SQL aggregates, and the filter dimensions come from DISTINCT queries —
 * so the screen stays fast at tens of thousands of rows. The filter can be seeded by a deep link
 * from the Dashboard (tap a category → land here pre-filtered).
 */

import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { CategoryBreakdown, type CategoryBreakdownRow } from '@/components/category-breakdown';
import { CategoryPicker } from '@/components/category-picker';
import { Chip } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { ReportsFilters } from '@/components/reports-filters';
import { TextInputModal } from '@/components/text-input-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TransactionDetail } from '@/components/transaction-detail';
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
import { useCategoryIndex, useLists } from '@/hooks/use-reference-data';
import { useDimensions, usePeriodTotals, useReportsBreakdowns } from '@/hooks/use-analytics';
import { useTransactionCount, useTransactionList } from '@/hooks/use-transactions';
import { addCategory, addSubcategory, clearTransactionCategory, deleteTransaction, setTransactionCategory } from '@/services/db/repository';
import { saveFilteredToFolder, shareFilteredToExcel } from '@/services/export';

const TOP_MERCHANTS = 12;
const DIRECTION_META = {
  out: { sign: '−', color: 'spend', label: 'Spent' },
  in: { sign: '+', color: 'income', label: 'Received' },
  self: { sign: '⇄', color: 'review', label: 'Transfer' },
} as const;

export default function ReportsScreen() {
  const theme = useTheme();
  const SPEND = theme.spend;
  const REFUND = theme.accent;

  const index = useCategoryIndex();
  const lists = useLists();
  const { years, months, accounts } = useDimensions();
  // Unfiltered total — distinguishes "no data at all" (import first) from "no match for filters".
  const { count: totalCount, loading: totalLoading } = useTransactionCount();

  const subNames = useMemo(() => {
    const m = new Map<number, string>();
    index.categories.forEach((c) => c.subcategories.forEach((s) => m.set(s.id, s.name)));
    return m;
  }, [index]);
  const pmNames = useMemo(() => new Map(lists.paymentModes.map((p) => [p.id, p.name])), [lists.paymentModes]);
  const personNames = useMemo(() => new Map(lists.people.map((p) => [p.id, p.name])), [lists.people]);

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
  }>();
  const paramFilter = buildParamFilter(params);
  const defaultFilter: TxnFilter = years[0] != null ? { from: { year: years[0], month: 1 }, to: { year: years[0], month: 12 } } : {};

  const [filter, setFilter] = useState<TxnFilter | null>(null);
  // Seed from an incoming deep link (once per distinct param set).
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
  const sig = hasParams ? JSON.stringify(paramFilter) : '';
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
  const { rows: filtered, count: filteredCount, hasMore, loadMore, loading } = useTransactionList(activeFilter);
  const totals = usePeriodTotals(activeFilter);
  const { merchants, accounts: accountsSpend, people: peopleSpend, cashback } = useReportsBreakdowns(activeFilter);

  // Labels for the active-filter chips.
  const catLabel = labelForCategory(activeFilter.categoryId, index);
  const subLabel = labelForSub(activeFilter.subcategoryId, subNames);
  const periodLabel = labelForPeriod(activeFilter);
  const chips = buildChips(activeFilter, { periodLabel, catLabel, subLabel, personNames }, update);

  // Transaction detail + category editing (same flow as Home).
  const [detailId, setDetailId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const detailTxn = detailId != null ? (filtered.find((t) => t.id === detailId) ?? null) : null;
  const openDetail = (id: number) => {
    setDetailId(id);
    setPickerOpen(false);
  };

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

  const onPickCategory = (categoryId: number, subcategoryId: number | null) => {
    if (detailId != null) setTransactionCategory(detailId, categoryId, subcategoryId, { learn: true });
    setPickerOpen(false);
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
      <View style={styles.headerRow}>
        <ThemedText type="subtitle">Reports</ThemedText>
        <Button label="⤓ Export" onPress={onExport} loading={exporting} style={styles.exportBtn} />
      </View>

      {/* Search — keyed on searchReset so "Clear all" remounts (clears) it. */}
      <SearchBox key={searchReset} onSearch={onSearch} />

      {/* Filter bar */}
      <View style={styles.filterBar}>
        <Button label="Filters ▾" variant="secondary" onPress={() => setFiltersOpen(true)} />
        {(filter !== null || search !== '') && (
          <Pressable onPress={clearAll} hitSlop={12} accessibilityRole="button">
            <ThemedText type="small" style={{ color: REFUND }}>
              Clear all
            </ThemedText>
          </Pressable>
        )}
      </View>
      <View style={styles.chipsRow}>
        {chips.map((c) => (
          <Chip key={c.key} label={`${c.label}  ✕`} selected onPress={c.clear} />
        ))}
      </View>

      {/* Summary */}
      <View style={styles.summary}>
        <ThemedText type="amount" style={{ color: SPEND }}>
          {formatINR(totals.spentPaise)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          spent · {formatINR(totals.receivedPaise)} received · {filteredCount} transaction
          {filteredCount === 1 ? '' : 's'} · self-transfers excluded from totals
        </ThemedText>
      </View>
    </View>
  );

  const footer = (
    <View>
      {/* Collapsible breakdowns */}
      <Pressable
        onPress={() => setShowBreakdowns((v) => !v)}
        hitSlop={8}
        style={styles.breakdownToggle}
        accessibilityRole="button"
      >
        <ThemedText type="smallBold" style={{ color: REFUND }}>
          {showBreakdowns ? '▾ Hide breakdowns' : '▸ Show breakdowns (merchant / account / person)'}
        </ThemedText>
      </Pressable>
      {showBreakdowns && (
        <>
          <Card title="Top merchants">
            <CategoryBreakdown
              rows={toRows(merchants.slice(0, TOP_MERCHANTS))}
              total={merchants.reduce((s, m) => s + m.spentPaise, 0)}
              color={SPEND}
            />
          </Card>
          <Card title="By account">
            <CategoryBreakdown
              rows={toRows(accountsSpend)}
              total={accountsSpend.reduce((s, a) => s + a.spentPaise, 0)}
              color={SPEND}
            />
          </Card>
          <Card title="By person (For)">
            <CategoryBreakdown
              rows={personRows}
              total={peopleSpend.reduce((s, p) => s + p.spentPaise, 0)}
              color={SPEND}
            />
          </Card>
          <Card title="Cashback & refunds">
            <ThemedText type="amount" style={{ color: REFUND }}>
              {formatINR(cashback.totalPaise)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {cashback.count} received · subtracted from spending
            </ThemedText>
          </Card>
        </>
      )}
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {!totalLoading && totalCount === 0 ? (
          <View style={styles.content}>
            <ThemedText type="subtitle">Reports</ThemedText>
            <EmptyState
              style={styles.empty}
              title="No transactions yet"
              message="Import a Paytm statement on the Import tab, then filter and export them here."
            />
          </View>
        ) : (
          <TransactionList
            rows={filtered}
            loading={loading}
            hasMore={hasMore}
            loadMore={loadMore}
            onPressRow={openDetail}
            categoryLabelFor={(t) => rowCategoryLabel(t, index.byId, subNames)}
            ListHeaderComponent={header}
            ListFooterComponent={footer}
            ListEmptyComponent={
              <EmptyState
                style={styles.empty}
                title="No matches"
                message="No transactions match these filters. Try clearing or widening them."
              />
            }
            contentContainerStyle={styles.content}
          />
        )}
      </SafeAreaView>

      <ReportsFilters
        visible={filtersOpen}
        initial={activeFilter}
        years={years}
        months={months}
        categories={index.categories}
        accounts={accounts}
        people={lists.people}
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

      <TransactionDetail
        visible={detailTxn !== null && !pickerOpen}
        txn={detailTxn}
        categoryLabel={detailTxn ? rowCategoryLabel(detailTxn, index.byId, subNames) : null}
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
        onAddCategory={(name, emoji) => addCategory(name, emoji)}
        onAddSubcategory={(categoryId, name) => addSubcategory(categoryId, name)}
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
    <TextInput
      value={text}
      onChangeText={setText}
      placeholder="Search merchant, note, UPI id…"
      placeholderTextColor={theme.textSecondary}
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="search"
      style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
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
  return chips;
}

function defaultFileName(f: TxnFilter, catLabel: string): string {
  const parts = ['Finance-Tracker'];
  if (f.categoryId != null) parts.push(catLabel.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, ''));
  const mk = (m: MonthKey) => `${m.year}-${String(m.month).padStart(2, '0')}`;
  if (f.from && f.to && f.from.year === f.to.year && f.from.month === 1 && f.to.month === 12) parts.push(String(f.from.year));
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <>
      <ThemedText type="smallBold" style={styles.sectionTitle}>{title}</ThemedText>
      <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.border }]}>
        {children}
      </ThemedView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
  headerGroup: { gap: Spacing.two, marginBottom: Spacing.two },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exportBtn: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  empty: { marginTop: Spacing.three },
  search: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  filterBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  summary: { marginTop: Spacing.one },
  breakdownToggle: { marginTop: Spacing.three, paddingVertical: Spacing.one },
  sectionTitle: { marginTop: Spacing.two },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    marginTop: Spacing.one,
    gap: Spacing.half,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
