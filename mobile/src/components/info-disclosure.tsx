import { SymbolView } from 'expo-symbols';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { IconButton } from '@/components/icon-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

const INFO_ICON: SymbolName = { ios: 'info.circle', android: 'info', web: 'info' };

export interface InfoDisclosureProps {
  /** Spoken name for the button, e.g. "How Activity totals are counted". */
  label: string;
  /** The explanation, revealed on tap. Held verbatim — this copy describes how money is counted. */
  text: string;
  /** The row the icon sits at the end of. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  rowStyle?: StyleProp<ViewStyle>;
}

/**
 * Puts an explanation behind a quiet inline "i" instead of spending a permanent line or three on
 * it. Tap reveals the copy beneath the row, tap again hides it.
 */
export function InfoDisclosure({ label, text, children, style, rowStyle }: InfoDisclosureProps) {
  const [open, setOpen] = useState(false);

  return (
    <View style={style}>
      <View style={[styles.row, rowStyle]}>
        {children != null ? <View style={styles.content}>{children}</View> : null}
        <IconButton
          name={INFO_ICON}
          label={label}
          onPress={() => setOpen((shown) => !shown)}
          variant="plain"
          size={24}
          iconSize={15}
          expanded={open}
          accessibilityHint={open ? 'Hides this explanation' : 'Shows this explanation'}
          style={styles.button}
        />
      </View>
      {open ? (
        <ThemedText
          type="caption"
          themeColor="textSecondary"
          accessibilityLiveRegion="polite"
          style={styles.text}
        >
          {text}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginRight: -Spacing.one,
  },
  content: { flex: 1, minWidth: 0 },
  button: { flexShrink: 0 },
  text: { marginTop: Spacing.half },
});
