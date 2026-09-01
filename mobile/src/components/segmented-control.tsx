import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Opacity, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A small iOS-style segmented control: a bordered track holding N equal segments, the selected one
 * filled. Used for settings-style either/or choices (e.g. the Light / Dark / System theme picker).
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[styles.track, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="tab"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected }}
            hitSlop={SEGMENT_HIT_SLOP}
            style={({ pressed }) => [
              styles.segment,
              selected && { backgroundColor: theme.accent },
              { opacity: pressed && !selected ? Opacity.pressed : 1 },
            ]}
          >
            <ThemedText type="smallEmphasis" style={{ color: selected ? theme.onAccent : theme.textSecondary }}>
              {opt.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const SEGMENT_HEIGHT = 30;
// The segment box is deliberately shorter than the touch-target floor; extend the press area back.
const SEGMENT_HIT_SLOP = {
  top: Math.ceil((TouchTarget - SEGMENT_HEIGHT) / 2),
  bottom: Math.ceil((TouchTarget - SEGMENT_HEIGHT) / 2),
};

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.half,
    gap: Spacing.half,
  },
  segment: {
    flex: 1,
    minHeight: SEGMENT_HEIGHT,
    paddingVertical: Spacing.half,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
