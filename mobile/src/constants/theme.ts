import '@/global.css';

import { Platform } from 'react-native';

/**
 * Calm-fintech semantic palette.
 *
 * Existing token names are kept so current screens can move onto the new design system without a
 * flag day. New components should prefer meaning over raw colour values: `accent`, `spend`,
 * `income`, `review`, the surface tokens, and their muted counterparts.
 */
export const Colors = {
  light: {
    text: '#142321',
    textSecondary: '#64726E',
    background: '#F5F7F6',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E7EFEC',
    border: '#DDE5E2',
    borderStrong: '#C7D3CF',
    accent: '#0F766E',
    accentMuted: '#DFF1ED',
    onAccent: '#FFFFFF',
    spend: '#D14D47',
    spendMuted: '#FBE9E7',
    income: '#247B58',
    incomeMuted: '#E4F3EB',
    review: '#B66A00',
    reviewMuted: '#FFF2D8',
    onReview: '#2C1B00',
    overlay: 'rgba(8, 18, 16, 0.48)',
    shadow: '#0B1714',
    skeleton: '#DCE6E2',
    focus: '#0F766E',
  },
  dark: {
    text: '#F2F6F4',
    textSecondary: '#9EADA8',
    background: '#0C1211',
    backgroundElement: '#151E1B',
    backgroundSelected: '#1C2824',
    border: '#2A3934',
    borderStrong: '#3A4A45',
    accent: '#4DC2B6',
    accentMuted: '#173A35',
    onAccent: '#061412',
    spend: '#FF746D',
    spendMuted: '#3B211F',
    income: '#5BD19A',
    incomeMuted: '#17372A',
    review: '#F2BA52',
    reviewMuted: '#3A2E17',
    onReview: '#241900',
    overlay: 'rgba(0, 0, 0, 0.66)',
    shadow: '#000000',
    skeleton: '#24322E',
    focus: '#70D4CA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
export type ThemePalette = { [K in ThemeColor]: string };

export const Fonts = Platform.select({
  ios: {
    sans: 'System',
    serif: 'New York',
    rounded: 'System',
    mono: 'Menlo',
  },
  android: {
    sans: 'sans-serif',
    serif: 'serif',
    rounded: 'sans-serif',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
  default: {
    sans: 'sans-serif',
    serif: 'serif',
    rounded: 'sans-serif',
    mono: 'monospace',
  },
});

/**
 * The original numeric names remain for compatibility. Semantic aliases make new layouts easier
 * to read while keeping the same compact 4/8/12/16/20 rhythm used by the approved mockups.
 */
export const Spacing = {
  none: 0,
  half: 2,
  one: 4,
  two: 8,
  three: 12,
  four: 16,
  five: 20,
  six: 40,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

export const Radius = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

export const Motion = {
  fast: 120,
  normal: 180,
  slow: 280,
  sheet: 220,
} as const;

export const Opacity = {
  pressed: 0.72,
  disabled: 0.45,
} as const;

export const TouchTarget = 44;
export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
