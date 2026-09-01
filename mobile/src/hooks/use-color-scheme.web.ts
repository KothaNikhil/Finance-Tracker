import { useSyncExternalStore } from 'react';

import { useThemePreference } from '@/hooks/use-theme-preference';

const subscribeToHydration = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Web variant. Same source of truth as native (the theme preference), but guarded for static
 * rendering: the first client paint must match the server-rendered "light" default, so we only
 * switch to the resolved scheme after hydration.
 */
export function useColorScheme(): 'light' | 'dark' {
  const hasHydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientSnapshot,
    getServerSnapshot,
  );
  const { scheme } = useThemePreference();
  return hasHydrated ? scheme : 'light';
}
