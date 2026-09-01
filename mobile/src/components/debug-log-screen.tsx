/**
 * A full-screen debug-log viewer (a separate "page", rendered as a modal overlay so it needs no
 * router wiring). It tails the shared diagnostic buffer that `ilog(...)` writes to across the app
 * (import decrypt/parse, etc.) — see {@link ../core/import/import-log}. Kept out of the normal UI;
 * opened on demand from a small entry point (currently the Import screen).
 */

import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { resetImportLog, subscribeImportLog } from '@/core/import/import-log';
import { useTheme } from '@/hooks/use-theme';

export function DebugLogScreen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const [lines, setLines] = useState<string[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  // Only subscribe while open, so the log buffer isn't driving state updates in the background.
  useEffect(() => {
    if (!visible) return;
    return subscribeImportLog(setLines);
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ThemedView style={styles.fill}>
        <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
          <View style={[styles.header, { borderColor: theme.border }]}>
            <ThemedText type="heading">Debug logs</ThemedText>
            <View style={styles.headerActions}>
              <Pressable onPress={() => resetImportLog()} hitSlop={14} accessibilityRole="button">
                <ThemedText type="link" style={{ color: theme.spend }}>
                  Clear
                </ThemedText>
              </Pressable>
              <Pressable onPress={onClose} hitSlop={14} accessibilityRole="button">
                <ThemedText type="link" themeColor="textSecondary">
                  Close
                </ThemedText>
              </Pressable>
            </View>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.fill}
            contentContainerStyle={styles.body}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {lines.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No logs yet. Perform an action (e.g. an import) and its diagnostic trace appears here.
              </ThemedText>
            ) : (
              lines.map((line, i) => (
                <ThemedText key={i} type="caption" themeColor="textSecondary" style={styles.line}>
                  {line}
                </ThemedText>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerActions: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  body: { padding: Spacing.three, gap: 2 },
  line: { fontFamily: 'monospace', fontSize: 11 },
});
