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
import { MIN_FONT_SCALE, TextRole } from '@/constants/typography';
import { formatINR } from '@/core/domain/money';
import { useTheme } from '@/hooks/use-theme';

export interface CategoryBreakdownRow {
  key: string;
  /** Display label, e.g. `🍽️ Food & Dining`. */
  label: string;
  /** Spend in paise. */
  value: number;
  /**
   * Optional id carried back to the caller on press (e.g. a category id). A row is tappable when
   * `onRowPress` is set AND (this is non-null OR {@link drillable} is true).
   */
  id?: number | null;
  /** Force a row tappable even when `id` is null (e.g. "Uncategorized" → deep-link to Reports). */
  drillable?: boolean;
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
      {rows.map((r, index) => {
        const pct = total > 0 ? Math.round((r.value / total) * 100) : 0;
        const fill: DimensionValue = `${Math.max(2, (r.value / max) * 100)}%`;
        const pressable = onRowPress != null && (r.id != null || r.drillable === true);
        const rowStyle = [
          styles.row,
          index < rows.length - 1 && { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
        ];
        const body = (
          <>
            <View style={styles.rowHeader}>
              <ThemedText type={TextRole.rowTitle} numberOfLines={1} style={styles.label}>
                {r.label}
              </ThemedText>
              <ThemedText
                type={TextRole.rowAmount}
                style={styles.amount}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={MIN_FONT_SCALE}
              >
                {formatINR(r.value)}
              </ThemedText>
              <ThemedText type="caption" themeColor="textSecondary" style={styles.pct}>
                {pct}%
              </ThemedText>
              {pressable ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.chevron}>
                  ›
                </ThemedText>
              ) : null}
            </View>
            <View style={styles.trackRow}>
              <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
                <View style={[styles.fill, { width: fill, backgroundColor: color }]} />
              </View>
            </View>
          </>
        );
        return pressable ? (
          <Pressable
            key={r.key}
            onPress={() => onRowPress!(r)}
            accessibilityRole="button"
            accessibilityLabel={`${r.label}, ${formatINR(r.value)}, ${pct}% of spend`}
            accessibilityHint="Opens this breakdown"
            hitSlop={{ top: 6, bottom: 6 }}
            style={({ pressed }) => [rowStyle, { opacity: pressed ? 0.6 : 1 }]}
          >
            {body}
          </Pressable>
        ) : (
          <View key={r.key} style={rowStyle}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 0 },
  row: { minHeight: 38, gap: Spacing.half, paddingVertical: Spacing.one },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  label: { flex: 1 },
  amount: { width: 92, flexShrink: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
  chevron: { width: 12, fontSize: 16, lineHeight: 18, textAlign: 'right' },
  trackRow: { flexDirection: 'row', alignItems: 'center' },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
  pct: { width: 30, textAlign: 'right' },
});
