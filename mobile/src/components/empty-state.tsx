import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/** A friendly "nothing here yet" message, optionally with a bold headline above it. */
export function EmptyState({
  message,
  title,
  style,
}: {
  message: string;
  title?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.wrap, style]}>
      {title ? (
        <ThemedText type="smallBold" style={styles.title}>
          {title}
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
        {message}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: Spacing.four, gap: Spacing.one, alignItems: 'center' },
  title: { textAlign: 'center' },
  message: { textAlign: 'center' },
});
