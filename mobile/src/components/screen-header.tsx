import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export interface ScreenHeaderProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  action?: ReactNode;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Consistent screen title block with an optional trailing action. The default is a single line:
 * title on the left, action on the right. `eyebrow` and `subtitle` remain available for the few
 * places that genuinely need extra context, and each stays to one line.
 */
export function ScreenHeader({
  title,
  eyebrow,
  subtitle,
  action,
  compact = false,
  style,
}: ScreenHeaderProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.row}>
        <View style={styles.copy}>
          {eyebrow ? (
            <ThemedText type="overline" themeColor="textSecondary">
              {eyebrow}
            </ThemedText>
          ) : null}
          <ThemedText
            type={compact ? 'heading' : 'subtitle'}
            accessibilityRole="header"
            numberOfLines={1}
          >
            {title}
          </ThemedText>
        </View>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
      {subtitle ? (
        <ThemedText
          type="small"
          themeColor="textSecondary"
          numberOfLines={1}
          style={styles.subtitle}
        >
          {subtitle}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.half },
  row: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  copy: { flex: 1, minWidth: 0 },
  action: { flexShrink: 0 },
  subtitle: { maxWidth: 620 },
});
