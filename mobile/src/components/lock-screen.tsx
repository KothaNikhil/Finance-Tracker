/**
 * Full-screen lock (Step 1): shown when the app is locked, auto-prompting biometrics on mount and
 * offering a manual "Unlock" retry.
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAppLock } from '@/hooks/use-app-lock';

export function LockScreen() {
  const { unlock } = useAppLock();

  // Prompt as soon as the lock screen appears.
  useEffect(() => {
    unlock();
  }, [unlock]);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.center}>
        <ThemedText style={styles.emoji}>🔒</ThemedText>
        <ThemedText type="smallBold">Finance Tracker is locked</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.msg}>
          Unlock with your fingerprint, face, or device PIN.
        </ThemedText>
        <Button label="Unlock" variant="primary" onPress={unlock} style={styles.btn} />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center' },
  center: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  emoji: { fontSize: 40, lineHeight: 48 },
  msg: { textAlign: 'center' },
  btn: { marginTop: Spacing.three, minWidth: 160, flexGrow: 0 },
});
