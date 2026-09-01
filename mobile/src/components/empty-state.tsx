import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

/** A friendly "nothing here yet" message, optionally with a bold headline above it. */
export function EmptyState({
  message,
  title,
  style,
  icon,
  actionLabel,
  onAction,
}: {
  message: string;
  title?: string;
  style?: StyleProp<ViewStyle>;
  icon?: SymbolName;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.wrap, style]}>
      {icon ? (
        <View style={[styles.iconWrap, { backgroundColor: theme.accentMuted }]}>
          <SymbolView name={icon} size={18} tintColor={theme.accent} />
        </View>
      ) : null}
      {title ? (
        <ThemedText type="heading" style={styles.title}>
          {title}
        </ThemedText>
      ) : null}
      <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
        {message}
      </ThemedText>
      {actionLabel && onAction ? (
        <Button label={actionLabel} variant="primary" onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 440,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
    gap: Spacing.one,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.half,
  },
  title: { textAlign: 'center' },
  message: { textAlign: 'center' },
  action: { marginTop: Spacing.two, minWidth: 160 },
});
