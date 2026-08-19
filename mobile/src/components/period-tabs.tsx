/**
 * Month-based navigation for a bounded set of transactions (e.g. the current import). Renders a
 * scrollable row of month "tabs" — "All" plus each month present, newest first. When the set spans
 * MORE THAN ONE year, a year row appears above it: pick a year, then a month within it.
 *
 * Selection is expressed as a {@link MonthKey} (one month) or `null` ("All"). The parent turns that
 * into a period filter.
 */

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/chip';
import { Spacing } from '@/constants/theme';
import { MONTH_LABELS, type MonthKey } from '@/core/analytics';

function sameMonth(a: MonthKey, b: MonthKey): boolean {
  return a.year === b.year && a.month === b.month;
}

export function PeriodTabs({
  months,
  selected,
  onSelect,
}: {
  /** Available months, newest first. */
  months: MonthKey[];
  /** The selected month, or `null` for "All". */
  selected: MonthKey | null;
  onSelect: (m: MonthKey | null) => void;
}) {
  const years = useMemo(() => [...new Set(months.map((m) => m.year))].sort((a, b) => b - a), [months]);
  const multiYear = years.length > 1;

  // Which year's months are shown in the month row (only relevant when multiYear). Defaults to the
  // selected month's year, else the most recent year.
  const [viewYear, setViewYear] = useState<number | null>(null);
  const activeYear = viewYear ?? selected?.year ?? years[0] ?? null;

  const monthsForRow = multiYear ? months.filter((m) => m.year === activeYear) : months;

  if (months.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {multiYear && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {years.map((y) => (
            <Chip key={y} label={String(y)} selected={y === activeYear} onPress={() => setViewYear(y)} />
          ))}
        </ScrollView>
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        <Chip label="All" selected={selected === null} onPress={() => onSelect(null)} />
        {monthsForRow.map((m) => (
          <Chip
            key={`${m.year}-${m.month}`}
            label={multiYear ? MONTH_LABELS[m.month - 1] : `${MONTH_LABELS[m.month - 1]} ${m.year}`}
            selected={selected !== null && sameMonth(selected, m)}
            onPress={() => onSelect(m)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  row: { gap: Spacing.one, paddingVertical: Spacing.half },
});
