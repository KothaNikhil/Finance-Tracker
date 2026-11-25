export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_KEY = 'finance-tracker-theme';

export function getStoredTheme(): ThemePreference {
  const value = localStorage.getItem(THEME_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

// Mirrors the mocks: no attribute follows the OS; data-theme forces light or dark.
export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
}
