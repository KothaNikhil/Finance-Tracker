import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Opacity, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'small' | 'default';
type SymbolName = ComponentProps<typeof SymbolView>['name'];

/**
 * The app's single action primitive. Every variant has a visible shape or semantic label and keeps
 * a minimum touch target in light and dark themes.
 */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  size = 'default',
  disabled,
  loading,
  style,
  accessibilityLabel,
  accessibilityHint,
  icon,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  icon?: SymbolName;
  testID?: string;
}) {
  const theme = useTheme();
  const bg =
    variant === 'primary'
      ? theme.accent
      : variant === 'danger'
        ? theme.spendMuted
        : variant === 'ghost'
          ? 'transparent'
          : theme.backgroundElement;
  const fg =
    variant === 'primary'
      ? theme.onAccent
      : variant === 'danger'
        ? theme.spend
        : variant === 'ghost'
          ? theme.accent
          : theme.text;
  const border =
    variant === 'primary'
      ? theme.accent
      : variant === 'danger'
        ? theme.spend
        : variant === 'ghost'
          ? 'transparent'
          : theme.borderStrong;
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      testID={testID}
      // Both boxes are under 44px tall, so extend the touch area back up to the floor.
      hitSlop={size === 'small' ? SMALL_HIT_SLOP : DEFAULT_HIT_SLOP}
      style={({ pressed }) => [
        styles.button,
        size === 'small' ? styles.small : styles.default,
        {
          backgroundColor: bg,
          borderColor: border,
          opacity: isDisabled ? Opacity.disabled : pressed ? Opacity.pressed : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <SymbolView name={icon} size={size === 'small' ? 14 : 16} tintColor={fg} /> : null}
          <ThemedText type="smallEmphasis" style={{ color: fg }}>
            {label}
          </ThemedText>
        </>
      )}
    </Pressable>
  );
}

const DEFAULT_BUTTON_HEIGHT = 40;
const SMALL_BUTTON_HEIGHT = 32;
const hitSlopFor = (height: number) => ({
  top: Math.ceil((TouchTarget - height) / 2),
  bottom: Math.ceil((TouchTarget - height) / 2),
  left: Spacing.one,
  right: Spacing.one,
});
const DEFAULT_HIT_SLOP = hitSlopFor(DEFAULT_BUTTON_HEIGHT);
const SMALL_HIT_SLOP = hitSlopFor(SMALL_BUTTON_HEIGHT);

const styles = StyleSheet.create({
  // No `flex: 1` here — in a column it collapses the label's layout. Callers in a row pass
  // `style={{ flex: 1 }}` for equal widths; in a column the button fills width via align-stretch.
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
  },
  default: {
    minHeight: DEFAULT_BUTTON_HEIGHT,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  small: {
    minHeight: SMALL_BUTTON_HEIGHT,
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two,
  },
});
