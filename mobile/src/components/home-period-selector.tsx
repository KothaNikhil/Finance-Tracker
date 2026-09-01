import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { IconButton } from '@/components/icon-button';
import { SegmentedControl, type SegmentOption } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export type HomePeriodMode = 'month' | 'year' | 'all';

/** Home opens on the whole year; a month is a drill-down from there, not the starting point. */
export const DEFAULT_HOME_PERIOD_MODE: HomePeriodMode = 'year';

const PERIOD_OPTIONS: SegmentOption<HomePeriodMode>[] = [
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All' },
];

export interface HomePeriodSelectorProps {
  mode: HomePeriodMode;
  label: string;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onModeChange: (mode: HomePeriodMode) => void;
}

/**
 * Compact period navigation for Home: the stepper and the Month / Year / All control share one
 * row, wrapping to two only on very narrow layouts.
 */
export function HomePeriodSelector({
  mode,
  label,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
  onModeChange,
}: HomePeriodSelectorProps) {
  const periodName = mode === 'month' ? 'month' : mode === 'year' ? 'year' : 'period';

  return (
    <View style={styles.container}>
      <Card padding="none" style={styles.navigator}>
        <IconButton
          name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
          label={`Previous ${periodName}`}
          onPress={onPrevious}
          disabled={!canGoPrevious}
          variant="plain"
          size={32}
        />
        <ThemedText
          type="label"
          numberOfLines={1}
          style={styles.periodLabel}
          accessibilityLabel={`Selected period: ${label}`}
        >
          {label}
        </ThemedText>
        <IconButton
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          label={`Next ${periodName}`}
          onPress={onNext}
          disabled={!canGoNext}
          variant="plain"
          size={32}
        />
      </Card>

      <View style={styles.modes}>
        <SegmentedControl
          accessibilityLabel="Home period view"
          options={PERIOD_OPTIONS}
          value={mode}
          onChange={onModeChange}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: Spacing.two,
  },
  navigator: {
    minWidth: 140,
    flexBasis: 150,
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  periodLabel: {
    flex: 1,
    textAlign: 'center',
  },
  modes: {
    minWidth: 150,
    flexBasis: 150,
    flexGrow: 1,
    justifyContent: 'center',
  },
});
