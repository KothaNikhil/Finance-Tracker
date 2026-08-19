import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A labelled figure tile (e.g. "Spent  ₹1,234.00"). `color` tints the value; defaults to text.
 * When `onPress` is set the tile is tappable and shows a corner chevron.
 *
 * Every tile — pressable or not — uses the SAME outer wrapper (`flex: 1` > inner card), so tiles
 * in a row always get equal width. (A bare card vs. a Pressable-wrapped card distributed width
 * unequally.)
 */
export function StatTile({
  label,
  value,
  color,
  onPress,
}: {
  label: string;
  value: string;
  color?: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const inner = (
    <ThemedView type="backgroundElement" style={[styles.tile, { borderColor: theme.border }]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="stat" style={{ color: color ?? theme.text }} numberOfLines={1}>
        {value}
      </ThemedText>
      {onPress && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.chevron}>
          ›
        </ThemedText>
      )}
    </ThemedView>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value}. View transactions.`}
        style={({ pressed }) => [styles.wrap, { opacity: pressed ? 0.6 : 1 }]}
      >
        {inner}
      </Pressable>
    );
  }
  return <View style={styles.wrap}>{inner}</View>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  tile: {
    flex: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.half,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chevron: { position: 'absolute', top: Spacing.two, right: Spacing.three, fontSize: 18, lineHeight: 20 },
});
