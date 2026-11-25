import { SymbolView } from 'expo-symbols';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { VIEW_ONLY_HINT } from '@/components/edit-session-banner';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** The "View only. Take over to edit." caption shown next to controls disabled in view only. */
export function ViewOnlyHint({
  align = 'center',
  style,
}: {
  align?: 'center' | 'start';
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View
      style={[styles.row, align === 'start' ? styles.start : styles.center, style]}
      accessibilityRole="text"
      accessibilityLabel={VIEW_ONLY_HINT}
    >
      <SymbolView
        name={{ ios: 'eye', android: 'visibility', web: 'visibility' }}
        size={12}
        tintColor={theme.textSecondary}
      />
      <ThemedText type="caption" themeColor="textSecondary">
        {VIEW_ONLY_HINT}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  center: { justifyContent: 'center' },
  start: { justifyContent: 'flex-start' },
});
