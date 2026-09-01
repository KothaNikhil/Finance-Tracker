import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { Spacing } from '@/constants/theme';

export interface ActivityFilterChip {
  key: string;
  label: string;
  clear: () => void;
}

export interface ActivityFilterBarProps {
  chips: ActivityFilterChip[];
  /** Rendered inline to the left of the Filters button — Activity passes its search box here. */
  search?: ReactNode;
  /** How many dimensions are constrained, shown on the button so the state survives a scrolled chip row. */
  activeCount?: number;
  onOpenFilters: () => void;
  onClearAll: () => void;
  showClearAll: boolean;
}

/** Activity's always-visible filter entry point and horizontally scrollable removable chips. */
export function ActivityFilterBar({
  chips,
  search,
  activeCount = 0,
  onOpenFilters,
  onClearAll,
  showClearAll,
}: ActivityFilterBarProps) {
  return (
    <View style={styles.container}>
      <View style={styles.actions}>
        {search ? <View style={styles.search}>{search}</View> : null}
        <Button
          label={activeCount > 0 ? `Filters · ${activeCount}` : 'Filters'}
          accessibilityLabel={activeCount > 0 ? `Filters, ${activeCount} active` : 'Filters'}
          icon={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }}
          size="small"
          variant="secondary"
          onPress={onOpenFilters}
          accessibilityHint="Opens all Activity filters"
        />
      </View>

      {chips.length > 0 || showClearAll ? (
        <View style={styles.chipRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chips}
            accessibilityLabel="Active filters"
          >
            {chips.map((chip) => (
              <Chip
                key={chip.key}
                label={`${chip.label}  ×`}
                selected
                onPress={chip.clear}
                accessibilityLabel={`Remove ${chip.label} filter`}
              />
            ))}
          </ScrollView>
          {showClearAll ? (
            <Button label="Clear all" size="small" variant="ghost" onPress={onClearAll} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.one },
  // `stretch` lets the Filters button fill the height the search field sets, so the two controls
  // match without shrinking the input below its typing-accuracy minimum.
  actions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing.two,
  },
  search: { flex: 1, minWidth: 0 },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  chipScroll: { flex: 1, minWidth: 0 },
  chips: {
    gap: Spacing.one,
    paddingVertical: Spacing.half,
    paddingHorizontal: 1,
  },
});
