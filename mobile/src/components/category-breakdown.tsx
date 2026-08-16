/**
 * Horizontal "spend by category" bars, drawn with plain Views. Each row names the category
 * (emoji + name — identity is never colour-alone) and shows its share of the period's spend.
 *
 * A single hue encodes magnitude (bar length), longest first; the bar sits on a faint track so
 * small categories are still visible. This is a spend-only view: the bar lengths sum to the
 * period's gross "Spent" total.
 */

import { type DimensionValue, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatINR } from '@/core/domain/money';
import { useTheme } from '@/hooks/use-theme';

export interface CategoryBreakdownRow {
  key: string;
  /** Display label, e.g. `🍽️ Food & Dining`. */
  label: string;
  /** Spend in paise. */
  value: number;
  /**
   * Optional id carried back to the caller on press (e.g. a category id). A row is only tappable
   * when `onRowPress` is set AND this is non-null, so rows like "Uncategorized" stay inert.
   */
  id?: number | null;
}

export interface CategoryBreakdownProps {
  rows: CategoryBreakdownRow[];
  /** Total spend for the period, used to show each row's percentage share. */
  total: number;
  color: string;
  /** When set, drillable rows (those with a non-null `id`) become tappable. */
  onRowPress?: (row: CategoryBreakdownRow) => void;
}

export function CategoryBreakdown({ rows, total, color, onRowPress }: CategoryBreakdownProps) {
  const theme = useTheme();
  if (rows.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No spending in this period.
      </ThemedText>
    );
  }
  // Bar length is relative to the biggest category so the top row fills the track.
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <View style={styles.list}>
      {rows.map((r) => {
        const pct = total > 0 ? Math.round((r.value / total) * 100) : 0;
        const fill: DimensionValue = `${Math.max(2, (r.value / max) * 100)}%`;
        const pressable = onRowPress != null && r.id != null;
        const body = (
          <>
            <View style={styles.rowHeader}>
              <ThemedText type="small" numberOfLines={1} style={styles.label}>
                {r.label}
              </ThemedText>
              <ThemedText type="smallBold" style={styles.amount}>
                {formatINR(r.value)}
              </ThemedText>
              {pressable && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.chevron}>
                  ›
                </ThemedText>
              )}
            </View>
            <View style={styles.trackRow}>
              <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
                <View style={[styles.fill, { width: fill, backgroundColor: color }]} />
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.pct}>
                {pct}%
              </ThemedText>
            </View>
          </>
        );
        return pressable ? (
          <Pressable
            key={r.key}
            onPress={() => onRowPress!(r)}
            accessibilityRole="button"
            accessibilityLabel={`${r.label}, ${formatINR(r.value)}, ${pct}% of spend`}
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
          >
            {body}
          </Pressable>
        ) : (
          <View key={r.key} style={styles.row}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  row: { gap: Spacing.half },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  label: { flex: 1 },
  amount: { flexShrink: 0 },
  chevron: { fontSize: 18, lineHeight: 20, marginLeft: -Spacing.one },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  track: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  pct: { width: 40, textAlign: 'right', fontSize: 12 },
});
