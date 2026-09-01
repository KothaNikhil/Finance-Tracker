import { forwardRef, useState, type ReactNode } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, TouchTarget } from '@/constants/theme';
import { TextRole } from '@/constants/typography';
import { useTheme } from '@/hooks/use-theme';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  hint?: string;
  error?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

/** Labelled text input with shared focus, error, disabled, and dark-theme treatment. */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    hint,
    error,
    leading,
    trailing,
    containerStyle,
    inputStyle,
    multiline,
    editable = true,
    onFocus,
    onBlur,
    placeholderTextColor,
    selectionColor,
    accessibilityLabel,
    ...inputProps
  },
  ref,
) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const borderColor = error ? theme.spend : focused ? theme.focus : theme.borderStrong;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <ThemedText type={TextRole.fieldLabel} style={styles.label}>
          {label}
        </ThemedText>
      ) : null}
      <View
        style={[
          styles.field,
          multiline && styles.multiline,
          {
            backgroundColor: theme.backgroundElement,
            borderColor,
            opacity: editable ? 1 : 0.55,
          },
        ]}
      >
        {leading}
        <TextInput
          ref={ref}
          {...inputProps}
          multiline={multiline}
          editable={editable}
          accessibilityLabel={accessibilityLabel ?? label ?? inputProps.placeholder}
          accessibilityState={{ disabled: !editable }}
          placeholderTextColor={placeholderTextColor ?? theme.textSecondary}
          selectionColor={selectionColor ?? theme.accent}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            styles.input,
            multiline && styles.multilineInput,
            { color: theme.text },
            inputStyle,
          ]}
        />
        {trailing}
      </View>
      {error ? (
        <ThemedText type="caption" style={{ color: theme.spend }} accessibilityLiveRegion="polite">
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText type="caption" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { gap: Spacing.half },
  label: { marginLeft: Spacing.half },
  // Inputs stay at the full touch-target height: they're the one control you aim at while typing.
  field: {
    minHeight: TouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
  },
  multiline: { minHeight: 76, alignItems: 'flex-start' },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: Spacing.one,
    fontSize: 14,
    lineHeight: 19,
  },
  multilineInput: {
    minHeight: 72,
    paddingTop: Spacing.two,
    textAlignVertical: 'top',
  },
});
