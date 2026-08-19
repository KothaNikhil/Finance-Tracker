import { useThemePreference } from '@/hooks/use-theme-preference';

/**
 * The app's colour scheme — resolved from the user's theme preference (System / Light / Dark),
 * not directly from the OS. `useTheme` and the navigation theme both read this, so a manual
 * override in Settings takes effect everywhere. Requires a `ThemePreferenceProvider` above.
 */
export function useColorScheme(): 'light' | 'dark' {
  return useThemePreference().scheme;
}
