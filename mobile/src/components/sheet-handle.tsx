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
      <View style={[styles.bar, { backgroundColor: theme.borderStrong }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingBottom: Spacing.one },
  bar: { width: 32, height: 4, borderRadius: 2 },
});
