import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { Motion } from '@/constants/theme';
import { useAppLock } from '@/hooks/use-app-lock';
import { useAuth } from '@/hooks/use-auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';

/**
 * Matches the configured native splash, then fades away after the first React layout. Keeping the
 * native and React layers visually identical prevents a flash while auth/session state is read.
 */
export function AnimatedSplashOverlay() {
  const theme = useTheme();
  const scheme = useColorScheme();
  const reducedMotion = useReducedMotion();
  const { loading: authLoading } = useAuth();
  const { ready: lockReady } = useAppLock();
  const [visible, setVisible] = useState(true);
  const [layoutReady, setLayoutReady] = useState(false);
  const hideStarted = useRef(false);

  useEffect(() => {
    if (!layoutReady || authLoading || !lockReady || hideStarted.current) return;
    hideStarted.current = true;
    let active = true;
    SplashScreen.hideAsync().finally(() => {
      if (active) setVisible(false);
    });
    return () => {
      active = false;
    };
  }, [authLoading, layoutReady, lockReady]);

  if (!visible) return null;

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      exiting={reducedMotion ? undefined : FadeOut.duration(Motion.slow)}
      onLayout={() => setLayoutReady(true)}
      style={[styles.splashOverlay, { backgroundColor: theme.background }]}
    >
      <Image
        style={styles.splashMark}
        contentFit="contain"
        source={
          scheme === 'dark'
            ? require('@/assets/images/brand-mark-dark.png')
            : require('@/assets/images/brand-mark.png')
        }
      />
    </Animated.View>
  );
}

/** Reusable static brand mark for authentication and lock screens. */
export function AnimatedIcon() {
  const scheme = useColorScheme();

  return (
    <View style={styles.iconContainer}>
      <Image
        style={styles.iconMark}
        contentFit="contain"
        source={
          scheme === 'dark'
            ? require('@/assets/images/brand-mark-dark.png')
            : require('@/assets/images/brand-mark.png')
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // The mark is its own rounded teal tile, so no extra container chrome.
  iconContainer: { justifyContent: 'center', alignItems: 'center', width: 112, height: 112 },
  iconMark: { width: 112, height: 112 },
  splashMark: { width: 128, height: 128 },
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
});
