/**
 * A generic single-select bottom sheet: a titled, scrollable list of options with a checkmark on
 * the current one. Used by the Reports filters (pick a month / category / account / person). Keeps
 * the filter UI free of ad-hoc dropdown code.
 */

import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface Option<T> {
  label: string;
  value: T;
}

export interface OptionSheetProps<T> {
  visible: boolean;
  title: string;
  options: Option<T>[];
  /** The currently-selected value (compared with ===), for the checkmark. */
  selected?: T;
  onSelect: (value: T) => void;
  onClose: () => void;
}

export function OptionSheet<T>({ visible, title, options, selected, onSelect, onClose }: OptionSheetProps<T>) {
  const theme = useTheme();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ThemedView style={styles.sheet}>
          <SafeAreaView edges={['bottom']}>
            <View style={styles.header}>
              <ThemedText type="smallBold">{title}</ThemedText>
              <Pressable onPress={onClose} hitSlop={8}>
                <ThemedText type="link" themeColor="textSecondary">Close</ThemedText>
              </Pressable>
            </View>
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {options.map((opt, i) => {
                const isSel = opt.value === selected;
                return (
                  <Pressable
                    key={i}
                    onPress={() => onSelect(opt.value)}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.row,
                      { backgroundColor: isSel ? theme.backgroundSelected : 'transparent', opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <ThemedText type="default" style={styles.rowLabel} numberOfLines={1}>
                      {opt.label}
                    </ThemedText>
                    {isSel && <ThemedText type="smallBold" style={{ color: theme.accent }}>✓</ThemedText>}
                  </Pressable>
                );
              })}
            </ScrollView>
          </SafeAreaView>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    maxHeight: '80%',
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.two },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
  },
  rowLabel: { flex: 1 },
});
