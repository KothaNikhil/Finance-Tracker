/**
 * The Activity filter sheet: edit a draft {@link TxnFilter} — month range, classification, account,
 * person, direction, refund state, amount, and review status — then Apply. One filter drives the
 * Activity view and the Excel export, so this is the single place those constraints live.
 *
 * Every dimension is one row that states its current value, so the whole filter reads at a glance
 * and only the dimension being changed spends vertical space. Rows expand in place: no second sheet
 * is ever stacked over this one, so the rest of the filter never disappears while you pick, and the
 * long lists (categories, accounts, people) gain a search box once scanning them stops working.
 *
 * Values are edited as a draft and only committed on Apply, so backing out changes nothing. The
 * live match count above the footer says what Apply will show, so an empty result is visible before
 * it is applied rather than after.
 */

import { SymbolView } from 'expo-symbols';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { IconButton } from '@/components/icon-button';
import { ListSection } from '@/components/list-section';
import { ScreenHeader } from '@/components/screen-header';
import { SegmentedControl } from '@/components/segmented-control';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Opacity, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { TextRole } from '@/constants/typography';
import { isEmptyFilter, MONTH_LABELS, type MonthKey, type TxnFilter } from '@/core/analytics';
import { formatINR, type Direction } from '@/core/domain/money';
import { useTheme } from '@/hooks/use-theme';
import { useTransactionCount } from '@/hooks/use-transactions';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

const ICONS = {
  close: { ios: 'xmark', android: 'close', web: 'close' },
  expand: { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' },
  collapse: { ios: 'chevron.up', android: 'expand_less', web: 'expand_less' },
  clear: { ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' },
  selected: { ios: 'checkmark', android: 'check', web: 'check' },
  checked: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' },
  unchecked: { ios: 'circle', android: 'radio_button_unchecked', web: 'radio_button_unchecked' },
  previousYear: { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' },
  nextYear: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
} satisfies Record<string, SymbolName>;

export interface FilterCategory {
  id: number;
  name: string;
  emoji: string | null;
  subcategories: { id: number; name: string }[];
}

export interface ReportsFiltersProps {
  visible: boolean;
  initial: TxnFilter;
  /** Years present in the data, newest first — the quick "whole year" chips. */
  years: number[];
  /** Months present in the data, newest first — the relative presets and the month grid's data hints. */
  months: MonthKey[];
  categories: FilterCategory[];
  /** Distinct funding-account names present in the data. */
  accounts: string[];
  people: { id: number; name: string }[];
  /**
   * The committed free-text search. Folded into the match count so the preview matches what Activity
   * will actually list; the sheet never edits it and never applies it.
   */
  search?: string;
  onApply: (filter: TxnFilter) => void;
  onClose: () => void;
}

/** The one expanded row. Only one opens at a time, so the sheet stays as short as its content. */
type OpenRow =
  | null
  | 'from'
  | 'to'
  | 'category'
  | 'subcategory'
  | 'direction'
  | 'refund'
  | 'account'
  | 'person'
  | 'amount';

/** Above this many options a list stops being scannable and earns a search box. */
const SEARCH_THRESHOLD = 8;
const ROW_HEIGHT = 40;
const MONTH_CELL_HEIGHT = 34;
const OPTION_HEIGHT = 36;
const slopFor = (height: number) => {
  const pad = Math.max(2, Math.ceil((TouchTarget - height) / 2));
  return { top: pad, bottom: pad };
};
const ROW_SLOP = slopFor(ROW_HEIGHT);
const CELL_SLOP = { ...slopFor(MONTH_CELL_HEIGHT), left: Spacing.half, right: Spacing.half };
const OPTION_SLOP = slopFor(OPTION_HEIGHT);

const DIRECTIONS: { value: Direction | 'any'; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'out', label: 'Spent' },
  { value: 'in', label: 'Received' },
  { value: 'self', label: 'Transfer' },
];
const REFUNDS: { value: 'any' | 'only' | 'exclude'; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'only', label: 'Refunds only' },
  { value: 'exclude', label: 'Exclude' },
];

/** Paise → a plain rupee string for an input (5000000 → "50000"), or '' for undefined. */
const paiseToText = (paise: number | undefined): string => (paise == null ? '' : String(paise / 100));
/** A rupee-string input → paise, or undefined when empty / not a number. */
const textToPaise = (text: string): number | undefined => {
  const t = text.trim().replace(/[,\s₹]/g, '');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};

const monthLabel = (m: MonthKey): string => `${MONTH_LABELS[m.month - 1]} ${m.year}`;
/** A month as one comparable integer, so range compares are plain arithmetic. */
const ordinal = (m: MonthKey): number => m.year * 12 + (m.month - 1);
const shiftMonths = (m: MonthKey, delta: number): MonthKey => {
  const o = ordinal(m) + delta;
  return { year: Math.floor(o / 12), month: (o % 12) + 1 };
};
const sameMonth = (a: MonthKey | undefined, b: MonthKey | undefined): boolean =>
  a == null || b == null ? a == null && b == null : a.year === b.year && a.month === b.month;

/** The row value for an amount range, e.g. "₹500.00 – ₹2,000.00" / "₹500.00 and above". */
const amountLabel = (minPaise: number | undefined, maxPaise: number | undefined): string => {
  if (minPaise != null && maxPaise != null) return `${formatINR(minPaise)} – ${formatINR(maxPaise)}`;
  if (minPaise != null) return `${formatINR(minPaise)} and above`;
  if (maxPaise != null) return `Up to ${formatINR(maxPaise)}`;
  return 'Any';
};

export function ReportsFilters({
  visible,
  initial,
  years,
  months,
  categories,
  accounts,
  people,
  search,
  onApply,
  onClose,
}: ReportsFiltersProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState<TxnFilter>(initial);
  const [open, setOpen] = useState<OpenRow>(null);
  // Amount inputs hold their own rupee text (so partial typing like "50" isn't reformatted).
  const [minText, setMinText] = useState(paiseToText(initial.minPaise));
  const [maxText, setMaxText] = useState(paiseToText(initial.maxPaise));
  const [gridYear, setGridYear] = useState(
    () => initial.from?.year ?? initial.to?.year ?? years[0] ?? new Date().getFullYear(),
  );

  // Re-seed the draft from `initial` each time the sheet (re)opens.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setDraft(initial);
      setMinText(paiseToText(initial.minPaise));
      setMaxText(paiseToText(initial.maxPaise));
      setGridYear(initial.from?.year ?? initial.to?.year ?? years[0] ?? new Date().getFullYear());
      setOpen(null);
    }
  }

  const set = (patch: Partial<TxnFilter>) => setDraft((d) => ({ ...d, ...patch }));
  const toggle = (row: Exclude<OpenRow, null>) => setOpen((current) => (current === row ? null : row));

  // The count trails the draft by a beat so holding down a key or sweeping the month grid doesn't
  // queue a query per keystroke. While closed it collapses onto `initial`, which the screen is
  // already counting, so an idle sheet costs nothing extra.
  const [counted, setCounted] = useState<TxnFilter>(draft);
  useEffect(() => {
    const id = setTimeout(() => setCounted(draft), 200);
    return () => clearTimeout(id);
  }, [draft]);
  const preview = useTransactionCount(visible ? { ...counted, search: search || undefined } : initial);

  // ---- labels for the current draft ----
  const activeCat = draft.categoryId != null ? categories.find((c) => c.id === draft.categoryId) : undefined;
  const catLabel = (c: FilterCategory) => `${c.emoji ? `${c.emoji} ` : ''}${c.name}`;
  const categoryValue =
    draft.categoryId === undefined
      ? 'Any'
      : draft.categoryId === null
        ? 'Uncategorized'
        : activeCat
          ? catLabel(activeCat)
          : 'Category';
  const subValue =
    draft.subcategoryId === undefined
      ? 'Any'
      : draft.subcategoryId === null
        ? 'No sub-category'
        : (activeCat?.subcategories.find((s) => s.id === draft.subcategoryId)?.name ?? 'Sub-category');
  const accountValue = draft.account ?? 'Any';
  const personValue =
    draft.personId === undefined
      ? 'Any'
      : draft.personId === null
        ? 'Not assigned'
        : (people.find((p) => p.id === draft.personId)?.name ?? 'Person');
  const directionKey = draft.direction ?? 'any';
  const directionValue = DIRECTIONS.find((d) => d.value === directionKey)?.label ?? 'Any';
  const refundKey = draft.isRefund === undefined ? 'any' : draft.isRefund ? 'only' : 'exclude';
  const refundValue = REFUNDS.find((r) => r.value === refundKey)?.label ?? 'Any';

  // ---- period ----
  const latest = months[0];
  const presets: { key: string; label: string; from?: MonthKey; to?: MonthKey }[] = [
    { key: 'all', label: 'All time' },
  ];
  if (latest && months.length >= 3) {
    presets.push({ key: 'last3', label: 'Last 3 months', from: shiftMonths(latest, -2), to: latest });
  }
  if (latest && months.length >= 12) {
    presets.push({ key: 'last12', label: 'Last 12 months', from: shiftMonths(latest, -11), to: latest });
  }
  const rangeIs = (from: MonthKey | undefined, to: MonthKey | undefined) =>
    sameMonth(draft.from, from) && sameMonth(draft.to, to);

  const monthsWithData = new Set(months.map((m) => `${m.year}-${m.month}`));
  const knownYears = [...years, draft.from?.year, draft.to?.year].filter((y): y is number => y != null);
  const minYear = knownYears.length > 0 ? Math.min(...knownYears) : gridYear;
  const maxYear = knownYears.length > 0 ? Math.max(...knownYears) : gridYear;

  // Picking a bound past the other one drags that one along, so an inverted range is unreachable.
  const pickMonth = (month: number) => {
    const picked: MonthKey = { year: gridYear, month };
    if (open === 'from') {
      set({ from: picked, to: draft.to != null && ordinal(draft.to) < ordinal(picked) ? picked : draft.to });
    } else {
      set({ from: draft.from != null && ordinal(draft.from) > ordinal(picked) ? picked : draft.from, to: picked });
    }
  };

  const periodError =
    draft.from != null && draft.to != null && ordinal(draft.from) > ordinal(draft.to)
      ? 'The first month must not be after the last.'
      : undefined;
  const amountError =
    draft.minPaise != null && draft.maxPaise != null && draft.minPaise > draft.maxPaise
      ? 'Minimum must not exceed maximum.'
      : undefined;
  const blocked = periodError != null || amountError != null;

  // ---- option lists (same encoding the filter itself uses: any / the empty bucket / an id) ----
  const categoryOptions = [
    { value: 'any', label: 'Any' },
    { value: 'none', label: 'Uncategorized' },
    ...categories.map((c) => ({ value: String(c.id), label: catLabel(c) })),
  ];
  const subOptions = [
    { value: 'any', label: 'Any' },
    { value: 'none', label: 'No sub-category' },
    ...(activeCat?.subcategories ?? []).map((s) => ({ value: String(s.id), label: s.name })),
  ];
  const accountOptions = [
    { value: 'any', label: 'Any' },
    ...accounts.map((a) => ({ value: a, label: a })),
  ];
  const personOptions = [
    { value: 'any', label: 'Any' },
    { value: 'none', label: 'Not assigned' },
    ...people.map((p) => ({ value: String(p.id), label: p.name })),
  ];

  const clearAmount = () => {
    set({ minPaise: undefined, maxPaise: undefined });
    setMinText('');
    setMaxText('');
  };
  const clearAll = () => {
    setDraft({});
    setMinText('');
    setMaxText('');
    setOpen(null);
  };

  const matchLabel =
    counted !== draft || preview.loading
      ? 'Counting matches…'
      : preview.error != null
        ? 'Match count unavailable.'
        : preview.count === 0
          ? 'No transactions match these filters.'
          : preview.count === 1
            ? '1 transaction matches.'
            : `${preview.count.toLocaleString('en-IN')} transactions match.`;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <ScreenHeader
          compact
          title="Filters"
          action={
            <IconButton name={ICONS.close} label="Close filters" onPress={onClose} variant="plain" />
          }
        />

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <ListSection title="PERIOD">
            <View style={styles.presets}>
              {presets.map((p) => (
                <Chip
                  key={p.key}
                  label={p.label}
                  selected={rangeIs(p.from, p.to)}
                  onPress={() => set({ from: p.from, to: p.to })}
                />
              ))}
              {years.map((y) => (
                <Chip
                  key={y}
                  label={String(y)}
                  selected={rangeIs({ year: y, month: 1 }, { year: y, month: 12 })}
                  onPress={() => set({ from: { year: y, month: 1 }, to: { year: y, month: 12 } })}
                />
              ))}
            </View>

            <FilterRow
              label="From"
              value={draft.from ? monthLabel(draft.from) : 'Earliest'}
              active={draft.from != null}
              expanded={open === 'from'}
              onToggle={() => toggle('from')}
              onClear={() => set({ from: undefined })}
              clearLabel="Clear the first month"
              hint="Opens a month picker for the first month in range"
            >
              <MonthGrid
                caption="Choose the first month"
                year={gridYear}
                canGoPrevious={gridYear > minYear}
                canGoNext={gridYear < maxYear}
                onYearChange={setGridYear}
                from={draft.from}
                to={draft.to}
                monthsWithData={monthsWithData}
                onPick={pickMonth}
              />
            </FilterRow>

            <FilterRow
              label="To"
              value={draft.to ? monthLabel(draft.to) : 'Latest'}
              active={draft.to != null}
              expanded={open === 'to'}
              onToggle={() => toggle('to')}
              onClear={() => set({ to: undefined })}
              clearLabel="Clear the last month"
              hint="Opens a month picker for the last month in range"
            >
              <MonthGrid
                caption="Choose the last month"
                year={gridYear}
                canGoPrevious={gridYear > minYear}
                canGoNext={gridYear < maxYear}
                onYearChange={setGridYear}
                from={draft.from}
                to={draft.to}
                monthsWithData={monthsWithData}
                onPick={pickMonth}
              />
            </FilterRow>

            {periodError ? <ErrorLine text={periodError} /> : null}
          </ListSection>

          <ListSection title="WHAT">
            <FilterRow
              label="Category"
              value={categoryValue}
              active={draft.categoryId !== undefined}
              expanded={open === 'category'}
              onToggle={() => toggle('category')}
              onClear={() => set({ categoryId: undefined, subcategoryId: undefined })}
            >
              <OptionList
                name="Category"
                options={categoryOptions}
                selected={
                  draft.categoryId === undefined ? 'any' : draft.categoryId === null ? 'none' : String(draft.categoryId)
                }
                onSelect={(v) => {
                  // A different category invalidates the sub-category under it.
                  set({
                    categoryId: v === 'any' ? undefined : v === 'none' ? null : parseInt(v, 10),
                    subcategoryId: undefined,
                  });
                  setOpen(null);
                }}
              />
            </FilterRow>

            {draft.categoryId != null ? (
              <FilterRow
                label="Sub-category"
                value={subValue}
                active={draft.subcategoryId !== undefined}
                expanded={open === 'subcategory'}
                onToggle={() => toggle('subcategory')}
                onClear={() => set({ subcategoryId: undefined })}
              >
                <OptionList
                  name="Sub-category"
                  options={subOptions}
                  selected={
                    draft.subcategoryId === undefined
                      ? 'any'
                      : draft.subcategoryId === null
                        ? 'none'
                        : String(draft.subcategoryId)
                  }
                  onSelect={(v) => {
                    set({ subcategoryId: v === 'any' ? undefined : v === 'none' ? null : parseInt(v, 10) });
                    setOpen(null);
                  }}
                />
              </FilterRow>
            ) : null}

            <FilterRow
              label="Direction"
              value={directionValue}
              active={draft.direction !== undefined}
              expanded={open === 'direction'}
              onToggle={() => toggle('direction')}
              onClear={() => set({ direction: undefined })}
            >
              <SegmentedControl
                accessibilityLabel="Direction"
                options={DIRECTIONS}
                value={directionKey}
                onChange={(v) => set({ direction: v === 'any' ? undefined : v })}
              />
            </FilterRow>

            <FilterRow
              label="Refunds"
              value={refundValue}
              active={draft.isRefund !== undefined}
              expanded={open === 'refund'}
              onToggle={() => toggle('refund')}
              onClear={() => set({ isRefund: undefined })}
            >
              <SegmentedControl
                accessibilityLabel="Refunds"
                options={REFUNDS}
                value={refundKey}
                onChange={(v) => set({ isRefund: v === 'any' ? undefined : v === 'only' })}
              />
            </FilterRow>
          </ListSection>

          <ListSection title="WHERE AND WHO">
            <FilterRow
              label="Account"
              value={accountValue}
              active={draft.account !== undefined}
              expanded={open === 'account'}
              onToggle={() => toggle('account')}
              onClear={() => set({ account: undefined })}
            >
              <OptionList
                name="Account"
                options={accountOptions}
                selected={draft.account ?? 'any'}
                onSelect={(v) => {
                  set({ account: v === 'any' ? undefined : v });
                  setOpen(null);
                }}
              />
            </FilterRow>

            <FilterRow
              label="For (person)"
              value={personValue}
              active={draft.personId !== undefined}
              expanded={open === 'person'}
              onToggle={() => toggle('person')}
              onClear={() => set({ personId: undefined })}
            >
              <OptionList
                name="Person"
                options={personOptions}
                selected={
                  draft.personId === undefined ? 'any' : draft.personId === null ? 'none' : String(draft.personId)
                }
                onSelect={(v) => {
                  set({ personId: v === 'any' ? undefined : v === 'none' ? null : parseInt(v, 10) });
                  setOpen(null);
                }}
              />
            </FilterRow>
          </ListSection>

          <ListSection title="AMOUNT AND REVIEW">
            <FilterRow
              label="Amount"
              value={amountLabel(draft.minPaise, draft.maxPaise)}
              active={draft.minPaise !== undefined || draft.maxPaise !== undefined}
              expanded={open === 'amount'}
              onToggle={() => toggle('amount')}
              onClear={clearAmount}
              clearLabel="Clear the amount range"
            >
              <View style={styles.amountRow}>
                <TextField
                  label="Minimum"
                  accessibilityLabel="Minimum amount in rupees"
                  value={minText}
                  onChangeText={(v) => {
                    setMinText(v);
                    set({ minPaise: textToPaise(v) });
                  }}
                  placeholder="No minimum"
                  keyboardType="decimal-pad"
                  containerStyle={styles.grow}
                />
                <TextField
                  label="Maximum"
                  accessibilityLabel="Maximum amount in rupees"
                  value={maxText}
                  onChangeText={(v) => {
                    setMaxText(v);
                    set({ maxPaise: textToPaise(v) });
                  }}
                  placeholder="No maximum"
                  keyboardType="decimal-pad"
                  error={amountError}
                  containerStyle={styles.grow}
                />
              </View>
            </FilterRow>

            <Pressable
              onPress={() => set({ needsReview: draft.needsReview ? undefined : true })}
              accessibilityRole="switch"
              accessibilityLabel="Needs review only"
              accessibilityState={{ checked: draft.needsReview === true }}
              hitSlop={ROW_SLOP}
              style={({ pressed }) => [styles.reviewRow, { opacity: pressed ? Opacity.pressed : 1 }]}
            >
              <ThemedText type={TextRole.rowTitle} numberOfLines={1} style={styles.reviewLabel}>
                Needs review only
              </ThemedText>
              <SymbolView
                name={draft.needsReview ? ICONS.checked : ICONS.unchecked}
                size={20}
                tintColor={draft.needsReview ? theme.accent : theme.textSecondary}
              />
            </Pressable>
          </ListSection>
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: theme.border }]}>
          <ThemedText
            type={TextRole.helper}
            themeColor="textSecondary"
            accessibilityLiveRegion="polite"
            numberOfLines={1}
          >
            {matchLabel}
          </ThemedText>
          <View style={styles.footerActions}>
            <Button
              label="Clear all"
              variant="secondary"
              disabled={isEmptyFilter(draft)}
              onPress={clearAll}
              accessibilityHint="Removes every filter from this draft"
              style={styles.grow}
            />
            <Button
              label="Apply filters"
              variant="primary"
              disabled={blocked}
              onPress={() => {
                onApply(draft);
                onClose();
              }}
              style={styles.grow}
            />
          </View>
        </View>
      </SafeAreaView>
    </BottomSheet>
  );
}

/**
 * One filter dimension: its name, the value it currently holds, and — only when it holds one — a
 * button that clears just this dimension. Tapping the row reveals its control in place.
 */
function FilterRow({
  label,
  value,
  active,
  expanded,
  onToggle,
  onClear,
  clearLabel,
  hint,
  children,
}: {
  label: string;
  value: string;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
  onClear: () => void;
  clearLabel?: string;
  hint?: string;
  children: ReactNode;
}) {
  const theme = useTheme();

  return (
    <View>
      <View style={styles.row}>
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${value}`}
          accessibilityState={{ expanded }}
          accessibilityHint={hint ?? `Opens the ${label.toLowerCase()} options`}
          hitSlop={ROW_SLOP}
          style={({ pressed }) => [styles.rowMain, { opacity: pressed ? Opacity.pressed : 1 }]}
        >
          <ThemedText type={TextRole.rowTitle} numberOfLines={1} style={styles.rowLabel}>
            {label}
          </ThemedText>
          <ThemedText
            type={TextRole.detailValue}
            numberOfLines={1}
            style={[styles.rowValue, { color: active ? theme.accent : theme.textSecondary }]}
          >
            {value}
          </ThemedText>
          <SymbolView
            name={expanded ? ICONS.collapse : ICONS.expand}
            size={14}
            tintColor={theme.textSecondary}
          />
        </Pressable>
        {active ? (
          <IconButton
            name={ICONS.clear}
            label={clearLabel ?? `Clear the ${label.toLowerCase()} filter`}
            onPress={onClear}
            variant="plain"
            size={28}
            iconSize={16}
            style={styles.rowClear}
          />
        ) : null}
      </View>
      {expanded ? <View style={styles.rowBody}>{children}</View> : null}
    </View>
  );
}

/** A single-select list, with a search box once it is long enough to need one. */
function OptionList({
  name,
  options,
  selected,
  onSelect,
}: {
  name: string;
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle === '' ? options : options.filter((o) => o.label.toLowerCase().includes(needle));

  return (
    <View style={styles.options}>
      {options.length > SEARCH_THRESHOLD ? (
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${name.toLowerCase()}`}
          accessibilityLabel={`Search ${name.toLowerCase()} options`}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      ) : null}
      {shown.length === 0 ? (
        <ThemedText type={TextRole.helper} themeColor="textSecondary" style={styles.optionsEmpty}>
          Nothing matches “{query.trim()}”.
        </ThemedText>
      ) : (
        shown.map((option) => {
          const isSelected = option.value === selected;
          return (
            <Pressable
              key={option.value}
              onPress={() => onSelect(option.value)}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: isSelected }}
              hitSlop={OPTION_SLOP}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: isSelected ? theme.backgroundSelected : 'transparent',
                  opacity: pressed ? Opacity.pressed : 1,
                },
              ]}
            >
              <ThemedText
                type={TextRole.nestedRowTitle}
                themeColor={isSelected ? 'text' : 'textSecondary'}
                numberOfLines={1}
                style={styles.optionLabel}
              >
                {option.label}
              </ThemedText>
              {isSelected ? <SymbolView name={ICONS.selected} size={14} tintColor={theme.accent} /> : null}
            </Pressable>
          );
        })
      )}
    </View>
  );
}

/** A year of months as a grid, so a range is picked rather than scrolled for or typed. */
function MonthGrid({
  caption,
  year,
  canGoPrevious,
  canGoNext,
  onYearChange,
  from,
  to,
  monthsWithData,
  onPick,
}: {
  caption: string;
  year: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onYearChange: (year: number) => void;
  from: MonthKey | undefined;
  to: MonthKey | undefined;
  monthsWithData: Set<string>;
  onPick: (month: number) => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.grid}>
      <View style={styles.gridHeader}>
        <IconButton
          name={ICONS.previousYear}
          label="Previous year"
          onPress={() => onYearChange(year - 1)}
          disabled={!canGoPrevious}
          variant="plain"
          size={28}
          iconSize={16}
        />
        <ThemedText type={TextRole.rowTitle} accessibilityLiveRegion="polite">
          {year}
        </ThemedText>
        <IconButton
          name={ICONS.nextYear}
          label="Next year"
          onPress={() => onYearChange(year + 1)}
          disabled={!canGoNext}
          variant="plain"
          size={28}
          iconSize={16}
        />
      </View>

      {[0, 4, 8].map((start) => (
        <View key={start} style={styles.gridRow}>
          {MONTH_LABELS.slice(start, start + 4).map((label, index) => {
            const month = start + index + 1;
            const endpoint =
              sameMonth(from, { year, month }) || sameMonth(to, { year, month });
            const between =
              from != null &&
              to != null &&
              ordinal({ year, month }) > ordinal(from) &&
              ordinal({ year, month }) < ordinal(to);
            const hasData = monthsWithData.has(`${year}-${month}`);

            return (
              <Pressable
                key={month}
                onPress={() => onPick(month)}
                accessibilityRole="button"
                accessibilityLabel={`${label} ${year}`}
                accessibilityState={{ selected: endpoint }}
                hitSlop={CELL_SLOP}
                style={({ pressed }) => [
                  styles.cell,
                  {
                    backgroundColor: endpoint
                      ? theme.accent
                      : between
                        ? theme.backgroundSelected
                        : theme.backgroundElement,
                    borderColor: endpoint ? theme.accent : theme.border,
                    opacity: pressed ? Opacity.pressed : 1,
                  },
                ]}
              >
                <ThemedText
                  type={TextRole.nestedRowTitle}
                  style={{ color: endpoint ? theme.onAccent : hasData ? theme.text : theme.textSecondary }}
                >
                  {label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      ))}

      <ThemedText type={TextRole.helper} themeColor="textSecondary">
        {caption}
      </ThemedText>
    </View>
  );
}

function ErrorLine({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <ThemedText
      type={TextRole.helper}
      accessibilityLiveRegion="polite"
      style={[styles.errorLine, { color: theme.spend }]}
    >
      {text}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  // `flexShrink` (not `flex: 1`) so the sheet stays sized to its content and still clamps and
  // scrolls when the filter is fully expanded.
  sheet: { flexShrink: 1 },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { paddingTop: Spacing.two, paddingBottom: Spacing.two, gap: Spacing.three },

  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.two,
  },

  row: { flexDirection: 'row', alignItems: 'center' },
  rowMain: {
    flex: 1,
    minWidth: 0,
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  rowLabel: { flexShrink: 0 },
  rowValue: { flex: 1, minWidth: 0, textAlign: 'right' },
  rowClear: { flexShrink: 0, marginRight: Spacing.half },
  rowBody: { gap: Spacing.two, paddingHorizontal: Spacing.two, paddingBottom: Spacing.two },

  // A row of its own rather than `rowMain`, whose `flex: 1` claims width inside `row` and would
  // claim height here.
  reviewRow: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  reviewLabel: { flex: 1, minWidth: 0 },

  options: { gap: Spacing.half },
  option: {
    minHeight: OPTION_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.sm,
  },
  optionLabel: { flex: 1, minWidth: 0 },
  optionsEmpty: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },

  grid: { gap: Spacing.one },
  gridHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  gridRow: { flexDirection: 'row', gap: Spacing.one },
  cell: {
    flex: 1,
    minHeight: MONTH_CELL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },

  amountRow: { flexDirection: 'row', gap: Spacing.two },
  errorLine: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },

  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
    gap: Spacing.two,
  },
  footerActions: { flexDirection: 'row', gap: Spacing.two },
  grow: { flex: 1 },
});
