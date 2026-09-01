/**
 * A small centered modal that asks for one line of text (with a confirm/cancel). Used for
 * rename-on-export: the user edits the file name before saving/sharing. `Alert.prompt` is
 * iOS-only, so this is the cross-platform equivalent.
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface TextInputModalProps {
  visible: boolean;
  title: string;
  message?: string;
  /** The value the field is (re)seeded with each time it opens. */
  initialValue: string;
  confirmLabel?: string;
  /** Mask the input and don't trim it (for passwords). */
  secureTextEntry?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

export function TextInputModal({
  visible,
  title,
  message,
  initialValue,
  confirmLabel = 'OK',
  secureTextEntry = false,
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

  // Passwords aren't trimmed (they can contain spaces); everything else is.
  const submit = secureTextEntry ? value : value.trim();

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      {/* Lift the centered card above the keyboard. Both platforms: iOS never resizes for the
          keyboard, and this app is edge-to-edge so Android's Modal doesn't resize either. */}
      <KeyboardAvoidingView
        style={[styles.backdrop, { backgroundColor: theme.overlay }]}
        behavior="padding"
        accessibilityViewIsModal
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={`Cancel ${title}`}
        />
        <Card style={styles.card}>
          <ThemedText type="heading">{title}</ThemedText>
          {message && (
            <ThemedText type="small" themeColor="textSecondary">
              {message}
            </ThemedText>
          )}
          <TextField
            label={secureTextEntry ? 'Password' : 'File name'}
            value={value}
            onChangeText={setValue}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={secureTextEntry}
            selectTextOnFocus={!secureTextEntry}
            onSubmitEditing={() => submit !== '' && onConfirm(submit)}
          />
          <View style={styles.actions}>
            <Button label="Cancel" variant="secondary" onPress={onCancel} style={styles.grow} />
            <Button
              label={confirmLabel}
              variant="primary"
              onPress={() => onConfirm(submit)}
              disabled={submit === ''}
              style={styles.grow}
            />
          </View>
        </Card>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.four },
  card: { width: '100%', maxWidth: 420, borderRadius: Radius.lg, padding: Spacing.three, gap: Spacing.two },
  actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  grow: { flex: 1 },
});
