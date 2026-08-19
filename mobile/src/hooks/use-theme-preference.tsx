/**
 * The app's theme preference: "system" (follow the OS), "light", or "dark". Persisted so the choice
 * survives restarts. This is the single source of truth for the resolved colour scheme — the app's
 * `useColorScheme` reads the resolved value from here (NOT from react-native directly), so a manual
 * override in Settings flows to every `useTheme()` consumer, the navigation theme, and the status bar.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedScheme = 'light' | 'dark';

const STORAGE_KEY = 'theme-mode';

interface ThemePreference {
  /** The user's choice. */
  mode: ThemeMode;
  /** The scheme actually in effect (system choice resolved against the OS). */
  scheme: ResolvedScheme;
  /** Persist a new choice. */
  setMode: (mode: ThemeMode) => void;
}

const ThemePreferenceContext = createContext<ThemePreference>({
  mode: 'system',
  scheme: 'light',
  setMode: () => {},
});

function isThemeMode(v: string | null): v is ThemeMode {
  return v === 'system' || v === 'light' || v === 'dark';
}

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const system = useSystemColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Load the persisted choice once. Async, so it's not a synchronous set-state-in-effect.
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (active && isThemeMode(v)) setModeState(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  };

  const scheme: ResolvedScheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;

  return (
    <ThemePreferenceContext.Provider value={{ mode, scheme, setMode }}>{children}</ThemePreferenceContext.Provider>
  );
}

export function useThemePreference(): ThemePreference {
  return useContext(ThemePreferenceContext);
}
