import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { LockScreen } from '@/components/lock-screen';
import { LoginScreen } from '@/components/login-screen';
import { AppLockProvider, useAppLock } from '@/hooks/use-app-lock';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { warmUpDatabaseAsync } from '@/services/db/database';

SplashScreen.preventAutoHideAsync();

/**
 * On web the SQLite worker must compile its wasm before any synchronous DB call, or the first
 * `openDatabaseSync` times out. Warm it up here and don't mount DB-backed screens until it's ready.
 * On native this is instantly true (no worker), so behavior is unchanged.
 */
function useDatabaseReady(): boolean {
  const [ready, setReady] = useState(Platform.OS !== 'web');
  useEffect(() => {
    if (ready) return;
    let active = true;
    warmUpDatabaseAsync()
      .catch((e) => console.error('SQLite web warm-up failed', e))
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [ready]);
  return ready;
}

/**
 * Gate the app behind login (when Supabase is configured) and the device lock. `AppTabs` (the
 * router) stays mounted the whole time; the login/lock screens are opaque overlays on top, so
 * navigation state is never torn down.
 */
function Gate() {
  const auth = useAuth();
  const lock = useAppLock();
  const dbReady = useDatabaseReady();

  // Keep the splash up while we read the persisted session.
  if (auth.loading) return null;
  if (auth.configured && !auth.session) return <LoginScreen />;
  // Wait for the SQLite worker (web) before mounting any screen that reads the DB.
  if (!dbReady) return null;
  if (lock.locked) return <LockScreen />;
  // Key the DB-backed app on the account id: switching accounts remounts every screen so their
  // live queries re-bind to that account's own database (AuthProvider already pointed the DB at it).
  const accountKey = auth.configured ? (auth.session?.user?.id ?? null) : null;
  return <AppTabs key={accountKey ?? 'default'} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    // Required for react-native-gesture-handler (drag-to-reorder on the Manage screen).
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AuthProvider>
          <AppLockProvider>
            <AnimatedSplashOverlay />
            <Gate />
          </AppLockProvider>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
