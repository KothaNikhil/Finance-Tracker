import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Opacity, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type CardTone = 'default' | 'subtle' | 'accent' | 'review' | 'danger';
export type CardPadding = 'none' | 'small' | 'default';

export interface CardProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: CardTone;
  padding?: CardPadding;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

/** Shared bordered surface used by summaries, grouped rows, and actionable cards. */
export function Card({
  children,
  style,
  tone = 'default',
  padding = 'default',
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: CardProps) {
  const theme = useTheme();
  const colors =
    tone === 'accent'
      ? { backgroundColor: theme.accentMuted, borderColor: theme.accent }
      : tone === 'review'
        ? { backgroundColor: theme.reviewMuted, borderColor: theme.review }
        : tone === 'danger'
          ? { backgroundColor: theme.spendMuted, borderColor: theme.spend }
          : tone === 'subtle'
            ? { backgroundColor: theme.backgroundSelected, borderColor: theme.border }
            : { backgroundColor: theme.backgroundElement, borderColor: theme.border };
  const paddingStyle =
    padding === 'none' ? styles.paddingNone : padding === 'small' ? styles.paddingSmall : styles.paddingDefault;
  const cardStyle = [styles.card, paddingStyle, colors, style];

  if (!onPress) {
    return (
      <View style={cardStyle} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={({ pressed }) => [cardStyle, { opacity: pressed ? Opacity.pressed : 1 }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
  },
  paddingNone: { padding: 0 },
  paddingSmall: { padding: Spacing.two },
  paddingDefault: { padding: Spacing.three },
});
