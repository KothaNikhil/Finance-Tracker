import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { IMPORT_FORMATS } from '@/core/import/formats';
import { useTheme } from '@/hooks/use-theme';

/**
 * A small round "ⓘ" button that opens the {@link SupportedFormatsSheet}. Sits inline in the Import
 * header title row so the legend costs no vertical space until the user asks for it.
 */
export function SupportedFormatsButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Which statements can I import?"
      hitSlop={10}
      style={({ pressed }) => [
        styles.infoBtn,
        { borderColor: theme.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <ThemedText type="smallEmphasis" themeColor="textSecondary">
        ⓘ
      </ThemedText>
    </Pressable>
  );
}

/** Reusable read-only list for the landing page and the supporting details sheet. */
export function SupportedFormatsList() {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={[styles.card, { borderColor: theme.border }]}>
      {IMPORT_FORMATS.map((format, index) => (
        <View
          key={format.id}
          accessible
          accessibilityLabel={`${format.name}, ${format.fileTypes}${
            format.locked ? ', password protected files supported' : ''
          }`}
          style={[
            styles.row,
            index > 0 && {
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.border,
            },
          ]}
        >
          <ThemedText style={styles.icon}>{format.icon}</ThemedText>
          <ThemedText type="label" style={styles.name} numberOfLines={1}>
            {format.name}
          </ThemedText>
          <View style={styles.formatMeta}>
            {format.locked ? (
              <ThemedText type="caption" themeColor="textSecondary">
                Locked PDF supported
              </ThemedText>
            ) : null}
            <ThemedText type="caption" themeColor="textSecondary" style={styles.fileTypes}>
              {format.fileTypes}
            </ThemedText>
          </View>
        </View>
      ))}
    </ThemedView>
  );
}

/**
 * A read-only bottom sheet listing the statement formats the importer supports (see
 * {@link IMPORT_FORMATS}). Purely informational — nothing here is tappable beyond Close. It tells
 * the user which banks / UPI sources and file types are recognized; detection itself is automatic,
 * so they never have to choose a format.
 */
export function SupportedFormatsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SafeAreaView edges={['bottom']} style={styles.flexible}>
        <View style={styles.header}>
          <ThemedText type="smallEmphasis">Supported statements</ThemedText>
          <Pressable
            onPress={onClose}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel="Close supported statements"
          >
            <ThemedText type="link" themeColor="textSecondary">
              Close
            </ThemedText>
          </Pressable>
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.intro}>
          Choose any of these files and the app detects the format automatically.
        </ThemedText>
        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          <SupportedFormatsList />
          <ThemedText type="small" themeColor="textSecondary" style={styles.privacy}>
            Passwords and statement contents are processed on this device.
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  infoBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flexible: { flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.one },
  intro: { marginBottom: Spacing.two },
  list: { flexGrow: 0, flexShrink: 1 },
  card: { borderRadius: Radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  icon: { fontSize: 15 },
  name: { flex: 1 },
  formatMeta: { alignItems: 'flex-end', flexShrink: 1 },
  fileTypes: { fontVariant: ['tabular-nums'] },
  privacy: { marginTop: Spacing.two, marginBottom: Spacing.three },
});
