/**
 * A small centered modal that asks for one line of text (with a confirm/cancel). Used for
 * rename-on-export: the user edits the file name before saving/sharing. `Alert.prompt` is
 * iOS-only, so this is the cross-platform equivalent.
 */

import { useState } from 'react';
import { Modal, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface TextInputModalProps {
  visible: boolean;
  title: string;
  message?: string;
  /** The value the field is (re)seeded with each time it opens. */
  initialValue: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

export function TextInputModal({
  visible,
  title,
  message,
  initialValue,
  confirmLabel = 'OK',
  onCancel,
  onConfirm,
}: TextInputModalProps) {
  const theme = useTheme();
  const [value, setValue] = useState(initialValue);
  // Re-seed the field whenever it (re)opens; keying by initialValue+visible avoids a stale value.
  const [seed, setSeed] = useState<string | null>(null);
  const openKey = visible ? initialValue : null;
  if (openKey !== seed) {
    setSeed(openKey);
    setValue(initialValue);
  }

  const trimmed = value.trim();

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="subtitle">{title}</ThemedText>
          {message && (
            <ThemedText type="small" themeColor="textSecondary">
              {message}
            </ThemedText>
          )}
          <TextInput
            value={value}
            onChangeText={setValue}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}
          />
          <View style={styles.actions}>
            <Button label="Cancel" variant="secondary" onPress={onCancel} style={styles.grow} />
            <Button
              label={confirmLabel}
              variant="primary"
              onPress={() => onConfirm(trimmed)}
              disabled={trimmed === ''}
              style={styles.grow}
            />
          </View>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.four, backgroundColor: 'rgba(0,0,0,0.5)' },
  card: { width: '100%', maxWidth: 420, borderRadius: Spacing.four, padding: Spacing.four, gap: Spacing.two },
  input: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    marginTop: Spacing.one,
  },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  grow: { flex: 1 },
});
