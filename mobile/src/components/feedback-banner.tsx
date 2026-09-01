import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Opacity, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type FeedbackTone = 'info' | 'success' | 'review' | 'danger';
type SymbolName = ComponentProps<typeof SymbolView>['name'];

export interface FeedbackBannerProps {
  title: string;
  message?: string;
  tone?: FeedbackTone;
  actionLabel?: string;
  onAction?: () => void;
  /** Let explanatory copy wrap in full instead of clamping to the compact one-line strip. */
  wrap?: boolean;
  style?: StyleProp<ViewStyle>;
}

const ICONS: Record<FeedbackTone, SymbolName> = {
  info: { ios: 'info.circle.fill', android: 'info', web: 'info' },
  success: { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' },
  review: { ios: 'exclamationmark.circle.fill', android: 'warning', web: 'warning' },
  danger: { ios: 'xmark.octagon.fill', android: 'error', web: 'error' },
};

/** Inline status and action feedback used instead of routine modal alerts. */
export function FeedbackBanner({
  title,
  message,
  tone = 'info',
  actionLabel,
  onAction,
  wrap = false,
  style,
}: FeedbackBannerProps) {
  const theme = useTheme();
  const colors =
    tone === 'success'
      ? { background: theme.incomeMuted, foreground: theme.income }
      : tone === 'review'
        ? { background: theme.reviewMuted, foreground: theme.review }
        : tone === 'danger'
          ? { background: theme.spendMuted, foreground: theme.spend }
          : { background: theme.accentMuted, foreground: theme.accent };

  return (
    <View
      accessibilityRole="summary"
      style={[
        styles.banner,
        wrap && styles.bannerWrap,
        { backgroundColor: colors.background, borderColor: colors.foreground },
        style,
      ]}
    >
      <SymbolView
        name={ICONS[tone]}
        size={wrap ? 14 : 16}
        tintColor={colors.foreground}
        style={[styles.icon, wrap && styles.iconWrap]}
      />
      <View style={styles.copy}>
        <ThemedText type="smallEmphasis" numberOfLines={wrap ? undefined : 1}>
          {title}
        </ThemedText>
        {message ? (
          <ThemedText
            type={wrap ? 'small' : 'caption'}
            themeColor="textSecondary"
            numberOfLines={wrap ? undefined : 2}
          >
            {message}
          </ThemedText>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          hitSlop={8}
          style={({ pressed }) => [styles.action, { opacity: pressed ? Opacity.pressed : 1 }]}
        >
          <ThemedText type="smallEmphasis" style={{ color: colors.foreground }}>
            {actionLabel}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
  },
  bannerWrap: { alignItems: 'flex-start', paddingVertical: Spacing.two },
  icon: { flexShrink: 0 },
  iconWrap: { marginTop: Spacing.half },
  copy: { flex: 1, minWidth: 0 },
  action: { minHeight: 28, justifyContent: 'center', paddingHorizontal: Spacing.one },
});
