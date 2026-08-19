/**
 * A vertical bar chart drawn with plain Views — no native charting dependency, so it's safe on
 * this RN New-Architecture stack and needs no `expo run:android` rebuild to change.
 *
 * It shows one bar per period (e.g. the 12 months of a year). Bars are a single series, so there
 * is no legend; the selected bar is labelled directly (the dataviz rule: never a number on every
 * bar). Tapping a bar calls `onSelect` so the screen can drill into that period.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface BarDatum {
  /** Stable key. */
  key: string;
  /** Axis label under the bar (e.g. `May`). */
  label: string;
  /** Value in paise. Negative values (net refund) are drawn as an empty bar. */
  value: number;
}

export interface SpendBarChartProps {
  data: BarDatum[];
  /** Fill colour for the bars. */
  color: string;
  /** Index of the highlighted bar, or null when the whole range is selected. */
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  /** Formats the value shown above the selected bar. */
  formatValue: (paise: number) => string;
  /** Plot height in px (bars only; label sits below). */
  plotHeight?: number;
}

const MIN_BAR = 3; // keep a sliver visible for tiny/zero months so every bar is tappable

export function SpendBarChart({
  data,
  color,
  selectedIndex,
  onSelect,
  formatValue,
  plotHeight = 140,
}: SpendBarChartProps) {
  const theme = useTheme();
  const max = useMemo(() => Math.max(1, ...data.map((d) => Math.max(0, d.value))), [data]);
  const hasSelection = selectedIndex != null;

  return (
    <View>
      <View style={[styles.plot, { height: plotHeight }]}>
        {data.map((d, i) => {
          const isSelected = selectedIndex === i;
          const magnitude = Math.max(0, d.value);
          const barHeight = magnitude > 0 ? Math.max(MIN_BAR, (magnitude / max) * plotHeight) : MIN_BAR;
          // When a single bar is selected, dim the rest so the choice stands out.
          const dimmed = hasSelection && !isSelected;
          return (
            <Pressable
              key={d.key}
              onPress={() => onSelect(i)}
              style={styles.column}
              hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
              accessibilityRole="button"
              accessibilityLabel={`${d.label}: ${formatValue(d.value)}`}
              accessibilityState={{ selected: isSelected }}
            >
              {isSelected && (
                <ThemedText type="caption" style={styles.valueLabel} numberOfLines={1}>
                  {formatValue(d.value)}
                </ThemedText>
              )}
              <View
                style={[
                  styles.bar,
                  {
                    height: barHeight,
                    backgroundColor: magnitude > 0 ? color : theme.backgroundSelected,
                    opacity: dimmed ? 0.35 : 1,
                  },
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      {/* Baseline + month labels */}
      <View style={[styles.baseline, { backgroundColor: theme.backgroundSelected }]} />
      <View style={styles.labelsRow}>
        {data.map((d, i) => (
          <ThemedText
            key={d.key}
            type="caption"
            themeColor={selectedIndex === i ? 'text' : 'textSecondary'}
            style={styles.axisLabel}
            numberOfLines={1}
          >
            {d.label}
          </ThemedText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  plot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.half, // 2px surface gap between adjacent bars (marks spec)
  },
  column: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: '100%',
  },
  bar: {
    width: '100%',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  valueLabel: {
    position: 'absolute',
    top: -20,
    width: 80,
    textAlign: 'center',
  },
  baseline: { height: 1, marginTop: Spacing.half },
  labelsRow: { flexDirection: 'row', gap: Spacing.half, marginTop: Spacing.one },
  axisLabel: { flex: 1, textAlign: 'center' },
});
