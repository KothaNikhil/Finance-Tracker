import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { LockScreen } from '@/components/lock-screen';
import { LoginScreen } from '@/components/login-screen';
import { AppLockProvider, useAppLock } from '@/hooks/use-app-lock';
import { AuthProvider, useAuth } from '@/hooks/use-auth';

SplashScreen.preventAutoHideAsync();

/**
 * Gate the app behind login (when Supabase is configured) and the device lock. `AppTabs` (the
 * router) stays mounted the whole time; the login/lock screens are opaque overlays on top, so
 * navigation state is never torn down.
 */
function Gate() {
  const auth = useAuth();
  const lock = useAppLock();

  // Keep the splash up while we read the persisted session.
  if (auth.loading) return null;
  if (auth.configured && !auth.session) return <LoginScreen />;
  if (lock.locked) return <LockScreen />;
  return <AppTabs />;
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
