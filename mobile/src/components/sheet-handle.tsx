import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The small rounded "grabber" bar shown at the top of a bottom sheet. It signals that the sheet
 * is dismissible (tap outside, or swipe/back). Purely decorative — `pointerEvents="none"` so it
 * never eats a touch.
 */
export function SheetHandle() {
  const theme = useTheme();
  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={[styles.bar, { backgroundColor: theme.backgroundSelected }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingBottom: Spacing.two },
  bar: { width: 40, height: 5, borderRadius: 3 },
});
