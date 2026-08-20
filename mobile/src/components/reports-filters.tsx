/**
 * The Reports filter sheet (Block B): edit a draft {@link TxnFilter} — month range, category +
 * sub-category, account, "For" person, and direction — then Apply. One filter drives both the
 * Reports view and the Excel export, so this is the single place those constraints are chosen.
 *
 * Values are edited as a draft and only committed on Apply, so backing out changes nothing.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { OptionSheet, type Option } from '@/components/option-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { MONTH_LABELS, type MonthKey, type TxnFilter } from '@/core/analytics';
import type { Direction } from '@/core/domain/money';
import { useTheme } from '@/hooks/use-theme';

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
  /** Months present in the data, newest first — the From/To range pickers. */
  months: MonthKey[];
  categories: FilterCategory[];
  /** Distinct funding-account names present in the data. */
  accounts: string[];
  people: { id: number; name: string }[];
  onApply: (filter: TxnFilter) => void;
  onClose: () => void;
}

type Picker = null | 'from' | 'to' | 'category' | 'subcategory' | 'account' | 'person';

const monthLabel = (m: MonthKey): string => `${MONTH_LABELS[m.month - 1]} ${m.year}`;
const monthToken = (m: MonthKey): string => `${m.year}-${m.month}`;
const tokenToMonth = (t: string): MonthKey => {
  const [y, mo] = t.split('-').map((n) => parseInt(n, 10));
  return { year: y, month: mo };
};

export function ReportsFilters({
  visible,
  initial,
  years,
  months,
  categories,
  accounts,
  people,
  onApply,
  onClose,
}: ReportsFiltersProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState<TxnFilter>(initial);
  const [picker, setPicker] = useState<Picker>(null);

  // Re-seed the draft from `initial` each time the sheet (re)opens.
  const [seedKey, setSeedKey] = useState<boolean | null>(null);
  if (visible !== (seedKey ?? false) && visible) {
    setSeedKey(true);
    setDraft(initial);
  } else if (!visible && seedKey) {
    setSeedKey(false);
  }

  const set = (patch: Partial<TxnFilter>) => setDraft((d) => ({ ...d, ...patch }));

  // ---- labels for the current draft ----
  const catName = (id: number) => categories.find((c) => c.id === id)?.name ?? 'Category';
  const activeCat = draft.categoryId != null ? categories.find((c) => c.id === draft.categoryId) : undefined;
  const subName = (id: number) => activeCat?.subcategories.find((s) => s.id === id)?.name ?? 'Sub-category';
  const personName = (id: number) => people.find((p) => p.id === id)?.name ?? 'Person';

  const fromLabel = draft.from ? monthLabel(draft.from) : 'Earliest';
  const toLabel = draft.to ? monthLabel(draft.to) : 'Latest';
  const categoryLabel =
    draft.categoryId === undefined ? 'Any' : draft.categoryId === null ? 'Uncategorized' : catName(draft.categoryId);
  const subLabel =
    draft.subcategoryId === undefined ? 'Any' : draft.subcategoryId === null ? 'No sub-category' : subName(draft.subcategoryId);
  const accountLabel = draft.account === undefined ? 'Any' : draft.account;
  const personLabelText =
    draft.personId === undefined ? 'Any' : draft.personId === null ? 'Not assigned' : personName(draft.personId);

  // A whole-year chip is "on" when the range is exactly Jan–Dec of that year.
  const yearActive = (y: number) =>
    draft.from?.year === y && draft.from.month === 1 && draft.to?.year === y && draft.to.month === 12;
  const allTimeActive = draft.from === undefined && draft.to === undefined;

  // ---- option lists for the active picker ----
  const monthOptions = (openLabel: string): Option<string>[] => [
    { label: openLabel, value: 'open' },
    ...months.map((m) => ({ label: monthLabel(m), value: monthToken(m) })),
  ];
  const categoryOptions: Option<string>[] = [
    { label: 'Any', value: 'any' },
    { label: 'Uncategorized', value: 'none' },
    ...categories.map((c) => ({ label: `${c.emoji ? c.emoji + ' ' : ''}${c.name}`, value: String(c.id) })),
  ];
  const subOptions: Option<string>[] = [
    { label: 'Any', value: 'any' },
    { label: 'No sub-category', value: 'none' },
    ...(activeCat?.subcategories ?? []).map((s) => ({ label: s.name, value: String(s.id) })),
  ];
  const accountOptions: Option<string>[] = [
    { label: 'Any', value: 'any' },
    ...accounts.map((a) => ({ label: a, value: a })),
  ];
  const personOptions: Option<string>[] = [
    { label: 'Any', value: 'any' },
    { label: 'Not assigned', value: 'none' },
    ...people.map((p) => ({ label: p.name, value: String(p.id) })),
  ];

  const directions: { label: string; value: Direction | undefined }[] = [
    { label: 'Any', value: undefined },
    { label: 'Spent', value: 'out' },
    { label: 'Received', value: 'in' },
    { label: 'Transfer', value: 'self' },
  ];

  return (
    <>
      <BottomSheet visible={visible} onClose={onClose}>
        <SafeAreaView edges={['bottom']} style={styles.flexible}>
          <View style={styles.header}>
            <ThemedText type="subtitle">Filters</ThemedText>
            <Pressable onPress={onClose} hitSlop={8}>
              <ThemedText type="link" themeColor="textSecondary">Close</ThemedText>
            </Pressable>
          </View>

          <ScrollView style={styles.flexible} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
              {/* Period */}
              <Field label="Period">
                <View style={styles.chipsRow}>
                  <Chip label="All time" selected={allTimeActive} onPress={() => set({ from: undefined, to: undefined })} />
                  {years.map((y) => (
                    <Chip
                      key={y}
                      label={String(y)}
                      selected={yearActive(y)}
                      onPress={() => set({ from: { year: y, month: 1 }, to: { year: y, month: 12 } })}
                    />
                  ))}
                </View>
                <View style={styles.rangeRow}>
                  <PickerButton label="From" value={fromLabel} onPress={() => setPicker('from')} theme={theme} />
                  <PickerButton label="To" value={toLabel} onPress={() => setPicker('to')} theme={theme} />
                </View>
              </Field>

              {/* Category + sub-category */}
              <Field label="Category">
                <PickerButton value={categoryLabel} onPress={() => setPicker('category')} theme={theme} />
                {draft.categoryId != null && (
                  <PickerButton label="Sub-category" value={subLabel} onPress={() => setPicker('subcategory')} theme={theme} />
                )}
              </Field>

              {/* Account */}
              <Field label="Account">
                <PickerButton value={accountLabel} onPress={() => setPicker('account')} theme={theme} />
              </Field>

              {/* Person */}
              <Field label="For (person)">
                <PickerButton value={personLabelText} onPress={() => setPicker('person')} theme={theme} />
              </Field>

              {/* Direction */}
              <Field label="Direction">
                <View style={styles.chipsRow}>
                  {directions.map((d) => (
                    <Chip
                      key={d.label}
                      label={d.label}
                      selected={draft.direction === d.value}
                      onPress={() => set({ direction: d.value })}
                    />
                  ))}
                </View>
              </Field>

              {/* Status — the review queue lives here so it's reachable any time (not just from the
                  Import banner). Stays flagged until you categorize each row or accept the guesses. */}
              <Field label="Status">
                <View style={styles.chipsRow}>
                  <Chip label="Any" selected={draft.needsReview === undefined} onPress={() => set({ needsReview: undefined })} />
                  <Chip label="Needs review" selected={draft.needsReview === true} onPress={() => set({ needsReview: true })} />
                </View>
              </Field>
            </ScrollView>

            <View style={styles.footer}>
              <Button label="Reset" variant="secondary" onPress={() => setDraft({})} style={styles.grow} />
              <Button label="Apply" variant="primary" onPress={() => { onApply(draft); onClose(); }} style={styles.grow} />
            </View>
        </SafeAreaView>
      </BottomSheet>

      {/* Pickers (one at a time) */}
      <OptionSheet
        visible={picker === 'from'}
        title="From month"
        options={monthOptions('Earliest')}
        selected={draft.from ? monthToken(draft.from) : 'open'}
        onSelect={(v) => { set({ from: v === 'open' ? undefined : tokenToMonth(v) }); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
      <OptionSheet
        visible={picker === 'to'}
        title="To month"
        options={monthOptions('Latest')}
        selected={draft.to ? monthToken(draft.to) : 'open'}
        onSelect={(v) => { set({ to: v === 'open' ? undefined : tokenToMonth(v) }); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
      <OptionSheet
        visible={picker === 'category'}
        title="Category"
        options={categoryOptions}
        selected={draft.categoryId === undefined ? 'any' : draft.categoryId === null ? 'none' : String(draft.categoryId)}
        onSelect={(v) => {
          const categoryId = v === 'any' ? undefined : v === 'none' ? null : parseInt(v, 10);
          set({ categoryId, subcategoryId: undefined }); // reset sub-category when category changes
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
      <OptionSheet
        visible={picker === 'subcategory'}
        title="Sub-category"
        options={subOptions}
        selected={draft.subcategoryId === undefined ? 'any' : draft.subcategoryId === null ? 'none' : String(draft.subcategoryId)}
        onSelect={(v) => { set({ subcategoryId: v === 'any' ? undefined : v === 'none' ? null : parseInt(v, 10) }); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
      <OptionSheet
        visible={picker === 'account'}
        title="Account"
        options={accountOptions}
        selected={draft.account === undefined ? 'any' : draft.account}
        onSelect={(v) => { set({ account: v === 'any' ? undefined : v }); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
      <OptionSheet
        visible={picker === 'person'}
        title="For (person)"
        options={personOptions}
        selected={draft.personId === undefined ? 'any' : draft.personId === null ? 'none' : String(draft.personId)}
        onSelect={(v) => { set({ personId: v === 'any' ? undefined : v === 'none' ? null : parseInt(v, 10) }); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText type="overline" themeColor="textSecondary">
        {label.toUpperCase()}
      </ThemedText>
      {children}
    </View>
  );
}

function PickerButton({
  label,
  value,
  onPress,
  theme,
}: {
  label?: string;
  value: string;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.pickerBtn, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}
    >
      {label && <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>}
      <ThemedText type="default" numberOfLines={1} style={styles.pickerValue}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">▾</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flexible: { flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.two },
  body: { paddingBottom: Spacing.three, gap: Spacing.three },
  field: { gap: Spacing.one },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  rangeRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  pickerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  pickerValue: { flex: 1 },
  footer: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.two },
  grow: { flex: 1 },
});
