/**
 * Full-screen login (Step 1): Continue-with-Google (native → Supabase) or an email 6-digit code.
 * Shown as an opaque overlay by the root layout whenever Supabase is configured and there's no
 * session.
 */

import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useBusyAction } from '@/hooks/use-busy-action';
import { useTheme } from '@/hooks/use-theme';
import { sendEmailOtp, signInWithGoogleAccount, verifyEmailOtp } from '@/services/auth/auth';

export function LoginScreen() {
  const theme = useTheme();
  const { busy, run } = useBusyAction('Sign-in failed');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);

  const onGoogle = () =>
    run(async () => {
      await signInWithGoogleAccount();
    }, { errorTitle: 'Google sign-in failed' });

  const onSendCode = () =>
    run(async () => {
      if (email.trim() === '') throw new Error('Enter your email address first.');
      await sendEmailOtp(email);
      setCodeSent(true);
    }, { errorTitle: 'Could not send code' });

  const onVerify = () =>
    run(async () => {
      await verifyEmailOtp(email, code);
    }, { errorTitle: 'Could not verify code' });

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <ThemedText type="subtitle">Finance Tracker</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.tagline}>
            Sign in to keep your data yours.
          </ThemedText>

          <Button label="Continue with Google" variant="primary" onPress={onGoogle} disabled={busy} style={styles.btn} />

          <View style={styles.divider}>
            <View style={[styles.line, { backgroundColor: theme.backgroundSelected }]} />
            <ThemedText type="small" themeColor="textSecondary">or</ThemedText>
            <View style={[styles.line, { backgroundColor: theme.backgroundSelected }]} />
          </View>

          {!codeSent ? (
            <>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@email.com"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                style={inputStyle}
              />
              <Button label="Email me a code" onPress={onSendCode} disabled={busy} style={styles.btn} />
            </>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                Enter the 6-digit code sent to {email.trim()}.
              </ThemedText>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                maxLength={6}
                style={inputStyle}
              />
              <Button label="Verify & sign in" variant="primary" onPress={onVerify} disabled={busy} style={styles.btn} />
              <Button
                label="Use a different email"
                onPress={() => {
                  setCodeSent(false);
                  setCode('');
                }}
                disabled={busy}
                style={styles.btn}
              />
            </>
          )}

          {busy && <ActivityIndicator style={styles.spinner} />}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth, justifyContent: 'center' },
  content: { paddingHorizontal: Spacing.four, gap: Spacing.two },
  tagline: { marginBottom: Spacing.two },
  btn: { marginTop: Spacing.one },
  divider: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginVertical: Spacing.two },
  line: { flex: 1, height: 1 },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  spinner: { marginTop: Spacing.two },
});
