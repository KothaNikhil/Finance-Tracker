import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Variant = 'primary' | 'secondary' | 'danger';

/**
 * The app's single button. `primary` is the accent fill, `secondary` is a subtle fill, `danger`
 * tints the label with the spend/red colour. When `loading`, the label is swapped for a spinner
 * and the button is disabled. Colours come from the theme so light/dark both look right.
 */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled,
  loading,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const bg = variant === 'primary' ? theme.accent : theme.backgroundSelected;
  const fg = variant === 'primary' ? theme.onAccent : variant === 'danger' ? theme.spend : theme.text;
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: pressed || isDisabled ? 0.6 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <ThemedText type="smallBold" style={{ color: fg }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
