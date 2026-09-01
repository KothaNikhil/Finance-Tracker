import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Opacity, Radius, TouchTarget } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type SymbolName = ComponentProps<typeof SymbolView>['name'];
export type IconButtonVariant = 'plain' | 'surface' | 'accent' | 'danger';

export interface IconButtonProps {
  name: SymbolName;
  label: string;
  onPress: () => void;
  variant?: IconButtonVariant;
  disabled?: boolean;
  selected?: boolean;
  /** For disclosure buttons: announces whether the content it controls is currently shown. */
  expanded?: boolean;
  size?: number;
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

/**
 * Icon-only action with a mandatory spoken label. The visual box is compact (36 by default) and
 * `hitSlop` makes up whatever it needs to keep the effective touch target at least 44×44.
 */
export function IconButton({
  name,
  label,
  onPress,
  variant = 'surface',
  disabled = false,
  selected = false,
  expanded,
  size = 36,
  iconSize = 18,
  style,
  accessibilityHint,
}: IconButtonProps) {
  const theme = useTheme();
  const backgroundColor =
    selected || variant === 'accent'
      ? theme.accent
      : variant === 'danger'
        ? theme.spendMuted
        : variant === 'plain'
          ? 'transparent'
          : theme.backgroundElement;
  const borderColor =
    selected || variant === 'accent'
      ? theme.accent
      : variant === 'danger'
        ? theme.spend
        : variant === 'plain'
          ? 'transparent'
          : theme.border;
  const tintColor =
    selected || variant === 'accent'
      ? theme.onAccent
      : variant === 'danger'
        ? theme.spend
        : variant === 'plain'
          ? theme.accent
          : theme.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={expanded == null ? { disabled, selected } : { disabled, selected, expanded }}
      hitSlop={Math.max(4, Math.ceil((TouchTarget - size) / 2))}
      style={({ pressed }) => [
        styles.button,
        {
          width: size,
          height: size,
          borderRadius: Math.min(Radius.md, size / 2),
          backgroundColor,
          borderColor,
          opacity: disabled ? Opacity.disabled : pressed ? Opacity.pressed : 1,
        },
        style,
      ]}
    >
      <SymbolView name={name} size={iconSize} tintColor={tintColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
