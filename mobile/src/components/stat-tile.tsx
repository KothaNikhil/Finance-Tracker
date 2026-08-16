import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A labelled figure tile (e.g. "Spent  ₹1,234.00"). `color` tints the value; defaults to text. */
export function StatTile({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={styles.tile}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText
        type="smallBold"
        style={{ color: color ?? theme.text, fontSize: 20, lineHeight: 26 }}
        numberOfLines={1}
      >
        {value}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: 2 },
});
