/**
 * Full-screen login (Step 1): Continue with Google. Shown by the root layout whenever Supabase is
 * configured and there's no session. On native, a successful sign-in also pulls the latest Google
 * Drive backup if it's newer than this device's data (see `syncDownFromDrive`), so you pick up
 * where you left off on another device.
 */

import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedIcon } from '@/components/animated-icon';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useBusyAction } from '@/hooks/use-busy-action';
import { getCurrentSession, signInWithGoogleAccount } from '@/services/auth/auth';
import { setActiveDbAccount } from '@/services/db/database';
import { syncDownFromDrive } from '@/services/drive';

export function LoginScreen() {
  const { busy, run } = useBusyAction('Sign-in failed');

  const onGoogle = () =>
    run(
      async () => {
        const signedIn = await signInWithGoogleAccount();
        if (signedIn) {
          // Point the DB at THIS account's own file before restoring, so a newer Drive backup lands
          // in the right database (don't rely on the auth-change listener having fired yet).
          const session = await getCurrentSession();
          if (session) setActiveDbAccount(session.user.id);
          // Best-effort restore of a newer Drive backup: a Drive hiccup never blocks getting into
          // the app (they can still restore manually from Manage). The gate opens as soon as the
          // session lands; if a restore follows, the live queries refresh the screens.
          await syncDownFromDrive().catch(() => {});
        }
      },
      { errorTitle: 'Google sign-in failed' },
    );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <AnimatedIcon />
          <ThemedText type="title" style={styles.title}>
            Finance Tracker
          </ThemedText>
          <ThemedText type="label" themeColor="accent" style={styles.tagline}>
            Your money, clearly organized.
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.message}>
            Import statements, review transactions and keep your data backed up through your Google
            account.
          </ThemedText>

          <Button
            label="Continue with Google"
            variant="secondary"
            onPress={onGoogle}
            loading={busy}
            style={styles.btn}
          />
          <ThemedText type="caption" themeColor="textSecondary" style={styles.restore}>
            A newer Google Drive backup is restored automatically after sign-in.
          </ThemedText>
        </View>
        <View style={styles.footer}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.footerText}>
            Your finance data stays private to your account.
          </ThemedText>
          <ThemedText type="caption" themeColor="textSecondary" style={styles.footerText}>
            Finance Tracker · Secure local-first storage
          </ThemedText>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  title: { marginTop: Spacing.two, textAlign: 'center' },
  tagline: { textAlign: 'center' },
  message: { maxWidth: 520, textAlign: 'center' },
  btn: { width: '100%', maxWidth: 520, marginTop: Spacing.three },
  restore: { maxWidth: 520, textAlign: 'center', marginTop: Spacing.one },
  footer: { alignItems: 'center', gap: Spacing.half, paddingHorizontal: Spacing.four, paddingBottom: Spacing.four },
  footerText: { textAlign: 'center' },
});
