/**
 * Reports (Block B): a list-first workspace. One {@link TxnFilter} — month range, category +
 * sub-category, account, "For" person, direction — drives everything: the summary, the filtered
 * transaction list (tap a row to edit its category), the collapsible breakdown cards, AND the
 * Excel export. So what you see is exactly what you export.
 *
 * The filter can be seeded by a deep link from the Dashboard (e.g. tap a category → land here
 * pre-filtered to it). Self-transfers are excluded from the money totals as everywhere else.
 */

import { desc } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  accountSpend,
  cashbackTotals,
  listYears,
  matchesFilter,
  MONTH_LABELS,
  merchantSpend,
  monthKeyOf,
  personSpend,
  totalsFor,
  type AnalyticsTxn,
  type FilterableTxn,
  type GroupSpend,
  type MonthKey,
  type TxnFilter,
} from '@/core/analytics';
import { transactions, type TransactionRow } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { useBusyAction } from '@/hooks/use-busy-action';
import { useTheme } from '@/hooks/use-theme';
import { useCategoryIndex, useLists } from '@/hooks/use-reference-data';
import { getDb } from '@/services/db/database';
import { addCategory, addSubcategory, clearTransactionCategory, deleteTransaction, setTransactionCategory } from '@/services/db/repository';
import { saveFilteredToFolder, shareFilteredToExcel } from '@/services/export';

const TOP_MERCHANTS = 12;
const DIRECTION_META = {
  out: { sign: '−', color: 'spend', label: 'Spent' },
  in: { sign: '+', color: 'income', label: 'Received' },
  self: { sign: '⇄', color: 'review', label: 'Transfer' },
} as const;

/** Month range → chronological ordinal, for comparing/labelling. */
const ord = (m: MonthKey) => m.year * 12 + m.month;

export default function ReportsScreen() {
  const theme = useTheme();
  const SPEND = theme.spend;
  const REFUND = theme.accent;
  const db = getDb();

  // Full rows: needed for the transaction list + detail sheet; the aggregates use a subset view.
  const query = useMemo(
    () => db.select().from(transactions).orderBy(desc(transactions.isoDate), desc(transactions.id)),
    [db],
  );
  const { data } = useLiveQuery(query);
  const rows = (data ?? []) as TransactionRow[];

  const index = useCategoryIndex();
  const lists = useLists();

  const subNames = useMemo(() => {
    const m = new Map<number, string>();
    index.categories.forEach((c) => c.subcategories.forEach((s) => m.set(s.id, s.name)));
    return m;
  }, [index]);
  const pmNames = useMemo(() => new Map(lists.paymentModes.map((p) => [p.id, p.name])), [lists.paymentModes]);
  const personNames = useMemo(() => new Map(lists.people.map((p) => [p.id, p.name])), [lists.people]);

  // Available filter dimensions, derived from the data.
  const analyticsAll = rows as unknown as AnalyticsTxn[]; // TransactionRow ⊇ AnalyticsTxn (direction is a plain text column)
  const years = useMemo(() => listYears(analyticsAll), [analyticsAll]);
  const months = useMemo(() => {
    const seen = new Map<number, MonthKey>();
    for (const r of rows) {
      const mk = monthKeyOf(r.isoDate);
      seen.set(ord(mk), mk);
    }
    return [...seen.values()].sort((a, b) => ord(b) - ord(a));
  }, [rows]);
  const accounts = useMemo(
    () => [...new Set(rows.map((r) => r.accountName).filter((a): a is string => !!a))].sort(),
    [rows],
  );

  // Filter state. A deep link (params) seeds it; otherwise default to the most recent year.
  const params = useLocalSearchParams<{ categoryId?: string; subcategoryId?: string; year?: string }>();
  const paramFilter = buildParamFilter(params); // cheap; compiler memoizes as needed
  const defaultFilter: TxnFilter = years[0] != null ? { from: { year: years[0], month: 1 }, to: { year: years[0], month: 12 } } : {};

  const [filter, setFilter] = useState<TxnFilter | null>(null);
  // Seed from an incoming deep link (once per distinct param set).
  const [paramSig, setParamSig] = useState<string | null>(null);
  const sig = params.categoryId || params.subcategoryId || params.year ? JSON.stringify(paramFilter) : '';
  if (sig !== '' && sig !== paramSig) {
    setParamSig(sig);
    setFilter(paramFilter);
  }
  const activeFilter = filter ?? defaultFilter;
  const update = (patch: Partial<TxnFilter>) => setFilter({ ...activeFilter, ...patch });

  const [filtersOpen, setFiltersOpen] = useState(false);

  // The filtered set drives the list, the summary and (with a null period) the breakdowns.
  const filtered = useMemo(
    () => rows.filter((r) => matchesFilter(r as unknown as FilterableTxn, activeFilter)),
    [rows, activeFilter],
  );
  const analytics = filtered as unknown as AnalyticsTxn[];
  const totals = useMemo(() => totalsFor(analytics), [analytics]);

  // Labels for the active-filter chips.
  const catLabel = labelForCategory(activeFilter.categoryId, index);
  const subLabel = labelForSub(activeFilter.subcategoryId, subNames);
  const periodLabel = labelForPeriod(activeFilter);
  const chips = buildChips(activeFilter, { periodLabel, catLabel, subLabel, personNames }, update);

  // Transaction detail + category editing (same flow as Home).
  const [detailId, setDetailId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const detailTxn = detailId != null ? (rows.find((t) => t.id === detailId) ?? null) : null;

  // Collapsible breakdowns.
  const [showBreakdowns, setShowBreakdowns] = useState(false);
  const merchants = useMemo(() => merchantSpend(analytics, null), [analytics]);
  const accountsSpend = useMemo(() => accountSpend(analytics, null), [analytics]);
  const peopleSpend = useMemo(() => personSpend(analytics, null), [analytics]);
  const cashback = useMemo(() => cashbackTotals(analytics, null), [analytics]);

  // Export the filtered set (with a rename step).
  const { busy: exporting, run: runExport } = useBusyAction('Could not export');
  const [renameOpen, setRenameOpen] = useState(false);
  // Cheap to derive; the React Compiler memoizes as needed (manual memo tripped its dep check here).
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

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <ThemedText type="subtitle">Reports</ThemedText>
            {rows.length > 0 && (
              <Button label="⤓ Export" onPress={onExport} loading={exporting} style={styles.exportBtn} />
            )}
          </View>

          {rows.length === 0 ? (
            <EmptyState
              style={styles.empty}
              message="No transactions yet. Import a Paytm statement on the Home tab, then filter and export them here."
            />
          ) : (
            <>
              {/* Filter bar */}
              <View style={styles.filterBar}>
                <Button label="Filters ▾" variant="secondary" onPress={() => setFiltersOpen(true)} />
                {filter !== null && (
                  <Pressable onPress={() => setFilter({})} hitSlop={8} accessibilityRole="button">
                    <ThemedText type="small" style={{ color: REFUND }}>Clear all</ThemedText>
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
                <ThemedText type="title" style={{ color: SPEND, fontSize: 28, lineHeight: 34 }}>
                  {formatINR(totals.spentPaise)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  spent · {formatINR(totals.receivedPaise)} received · {filtered.length} transaction
                  {filtered.length === 1 ? '' : 's'} · self-transfers excluded from totals
                </ThemedText>
              </View>

              {/* Transaction list */}
              {filtered.length === 0 ? (
                <EmptyState style={styles.empty} message="No transactions match these filters." />
              ) : (
                filtered.slice(0, 200).map((t) => (
                  <TxnRow
                    key={t.id}
                    txn={t}
                    categoryLabel={rowCategoryLabel(t, index.byId, subNames)}
                    onPress={() => {
                      setDetailId(t.id);
                      setPickerOpen(false);
                    }}
                  />
                ))
              )}
              {filtered.length > 200 && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                  Showing the first 200 of {filtered.length}. Narrow the filters or export to see them all.
                </ThemedText>
              )}

              {/* Collapsible breakdowns */}
              <Pressable onPress={() => setShowBreakdowns((v) => !v)} style={styles.breakdownToggle} accessibilityRole="button">
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
                    <ThemedText type="title" style={{ color: REFUND, fontSize: 24, lineHeight: 30 }}>
                      {formatINR(cashback.totalPaise)}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {cashback.count} received · subtracted from spending
                    </ThemedText>
                  </Card>
                </>
              )}
            </>
          )}
        </ScrollView>
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

// --- helpers -----------------------------------------------------------------

function buildParamFilter(params: { categoryId?: string; subcategoryId?: string; year?: string }): TxnFilter {
  const f: TxnFilter = {};
  if (params.year) {
    const y = parseInt(params.year, 10);
    if (!Number.isNaN(y)) {
      f.from = { year: y, month: 1 };
      f.to = { year: y, month: 12 };
    }
  }
  if (params.categoryId) {
    const c = parseInt(params.categoryId, 10);
    if (!Number.isNaN(c)) f.categoryId = c;
  }
  if (params.subcategoryId) {
    const s = parseInt(params.subcategoryId, 10);
    if (!Number.isNaN(s)) f.subcategoryId = s;
  }
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
  return (
    <>
      <ThemedText type="smallBold" style={styles.sectionTitle}>{title}</ThemedText>
      <ThemedView type="backgroundElement" style={styles.card}>{children}</ThemedView>
    </>
  );
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
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      <ThemedView type="backgroundElement" style={styles.txnRow}>
        <View style={styles.txnLeft}>
          <ThemedText type="default" numberOfLines={1}>
            {txn.counterpartyName ?? txn.rawDetails ?? '—'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {categoryLabel ?? (txn.direction === 'self' || txn.kind === 'received' ? 'Transfer' : 'Uncategorized')}
            {' · '}
            {txn.isoDate}
          </ThemedText>
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
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exportBtn: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  empty: { marginTop: Spacing.three },
  filterBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.one },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  summary: { marginTop: Spacing.two, marginBottom: Spacing.one },
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
  breakdownToggle: { marginTop: Spacing.three, paddingVertical: Spacing.one },
  sectionTitle: { marginTop: Spacing.two },
  card: { borderRadius: Spacing.three, padding: Spacing.three, marginTop: Spacing.one, gap: Spacing.half },
  hint: { marginTop: Spacing.one },
});
