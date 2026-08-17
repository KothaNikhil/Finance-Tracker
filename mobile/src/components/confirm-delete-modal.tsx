/**
 * A deliberately-hard-to-trigger confirmation for the most destructive action in the app
 * (delete all data). The delete button stays disabled until the user types the exact word
 * `DELETE`, so it can't be fired by an accidental tap. Optionally offers a "Back up first"
 * shortcut so the user is one tap from safety before wiping.
 */

import { useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const CONFIRM_WORD = 'DELETE';

export interface ConfirmDeleteModalProps {
  visible: boolean;
  /** Number of transactions that will be removed (shown in the warning). */
  count: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** Optional "Back up first" affordance (e.g. to Google Drive) shown above the confirm input. */
  onBackupFirst?: () => void;
}

export function ConfirmDeleteModal({
  visible,
  count,
  busy = false,
  onCancel,
  onConfirm,
  onBackupFirst,
}: ConfirmDeleteModalProps) {
  const theme = useTheme();
  const [text, setText] = useState('');

  const confirmed = text.trim().toUpperCase() === CONFIRM_WORD;

  // Clear the typed word on every close path so it can never carry over to the next open (which
  // would leave the modal pre-confirmed). Done in the handlers rather than a visibility effect.
  const handleCancel = () => {
    setText('');
    onCancel();
  };
  const handleConfirm = () => {
    setText('');
    onConfirm();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={handleCancel}>
      <View style={styles.backdrop}>
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="subtitle">Delete all data?</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            This permanently removes all {count} transaction{count === 1 ? '' : 's'} on this device.
            Your categories and lists are kept. This can’t be undone.
          </ThemedText>

          {onBackupFirst && (
            <Button
              label="Back up to Drive first"
              variant="secondary"
              onPress={onBackupFirst}
              disabled={busy}
              style={styles.spaced}
            />
          )}

          <ThemedText type="small" themeColor="textSecondary" style={styles.spaced}>
            Type <ThemedText type="smallBold">{CONFIRM_WORD}</ThemedText> to confirm.
          </ThemedText>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={CONFIRM_WORD}
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
            style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected }]}
          />

          <View style={styles.actions}>
            <Button label="Cancel" variant="secondary" onPress={handleCancel} disabled={busy} style={styles.grow} />
            <Button
              label="Delete all"
              variant="danger"
              onPress={handleConfirm}
              disabled={!confirmed || busy}
              style={styles.grow}
            />
          </View>
          {busy && <ActivityIndicator style={styles.spaced} />}
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  spaced: { marginTop: Spacing.one },
  input: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  grow: { flex: 1 },
});
