import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A small selectable pill, used for the year / "All" filters on the dashboard and reports. */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <ThemedText type="smallBold" themeColor={selected ? 'text' : 'textSecondary'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: Spacing.four },
});
