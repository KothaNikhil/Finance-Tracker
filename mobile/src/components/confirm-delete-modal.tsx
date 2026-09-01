/**
 * A deliberately-hard-to-trigger confirmation for the most destructive action in the app
 * (delete all data). The delete button stays disabled until the user types the exact word
 * `DELETE`, so it can't be fired by an accidental tap. Optionally offers a "Back up first"
 * shortcut so the user is one tap from safety before wiping.
 */

import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
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
      {/* Lift the centered card above the keyboard. Both platforms: iOS never resizes for the
          keyboard, and this app is edge-to-edge so Android's Modal doesn't resize either. */}
      <KeyboardAvoidingView
        style={[styles.backdrop, { backgroundColor: theme.overlay }]}
        behavior="padding"
      >
        <ThemedView type="backgroundElement" style={styles.card} accessibilityViewIsModal>
          <ThemedText type="heading">Delete all data?</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            This permanently removes all {count} transaction{count === 1 ? '' : 's'} on this device.
            Your categories and lists are kept. This can’t be undone.
          </ThemedText>

          {onBackupFirst && (
            <Button
              label="Back up to Drive first"
              variant="secondary"
              size="small"
              onPress={onBackupFirst}
              disabled={busy}
              style={styles.spaced}
            />
          )}

          <ThemedText type="small" themeColor="textSecondary" style={styles.spaced}>
            Type <ThemedText type="smallEmphasis">{CONFIRM_WORD}</ThemedText> to confirm.
          </ThemedText>
          <TextField
            value={text}
            onChangeText={setText}
            placeholder={CONFIRM_WORD}
            accessibilityLabel={`Type ${CONFIRM_WORD} to confirm deletion`}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
          />

          <View style={styles.actions}>
            <Button
              label="Cancel"
              variant="secondary"
              size="small"
              onPress={handleCancel}
              disabled={busy}
              style={styles.grow}
            />
            <Button
              label="Delete all"
              variant="danger"
              size="small"
              onPress={handleConfirm}
              disabled={!confirmed || busy}
              style={styles.grow}
            />
          </View>
          {busy && <ActivityIndicator style={styles.spaced} />}
        </ThemedView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.three,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Radius.lg,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  spaced: { marginTop: Spacing.half },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  grow: { flex: 1 },
});
