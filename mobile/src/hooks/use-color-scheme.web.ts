import { useEffect, useState } from 'react';

import { useThemePreference } from '@/hooks/use-theme-preference';

/**
 * Web variant. Same source of truth as native (the theme preference), but guarded for static
 * rendering: the first client paint must match the server-rendered "light" default, so we only
 * switch to the resolved scheme after hydration.
 */
export function useColorScheme(): 'light' | 'dark' {
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const { scheme } = useThemePreference();
  return hasHydrated ? scheme : 'light';
}
