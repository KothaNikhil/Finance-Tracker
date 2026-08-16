import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StyleSheet, useColorScheme, View } from 'react-native';
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

  const showLogin = auth.configured && !auth.loading && !auth.session;
  const showLock = !showLogin && lock.locked;

  return (
    <View style={styles.root}>
      <AppTabs />
      {showLogin && (
        <View style={StyleSheet.absoluteFill}>
          <LoginScreen />
        </View>
      )}
      {showLock && (
        <View style={StyleSheet.absoluteFill}>
          <LockScreen />
        </View>
      )}
    </View>
  );
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
