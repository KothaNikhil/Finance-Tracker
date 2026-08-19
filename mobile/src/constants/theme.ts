/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#11181C', // near-black — softer than pure #000 on a bright field
    background: '#FFFFFF',
    backgroundElement: '#F1F3F5', // cards / tiles / unselected chips
    backgroundSelected: '#DFE3E8', // pressed / selected fill (darker than element, so it stands out)
    border: '#E6E8EB', // hairline around cards, chips, dividers
    textSecondary: '#5B6570',
    // Semantic palette (money direction + UI accents). Every use is text-labeled elsewhere,
    // so colour is reinforcement, not the sole signal (keeps the red/green pair CVD-safe).
    spend: '#E5484D', // money out
    income: '#2FA968', // money in
    accent: '#2E6BF0', // primary actions, refunds, links
    review: '#E08600', // "needs review" amber (darkened for contrast on light)
    onAccent: '#FFFFFF', // text/icons on top of `accent`
    onReview: '#1A1200', // text on top of `review` (badge)
  },
  dark: {
    text: '#ECEDEE',
    background: '#0C0E12', // near-black with a hint of blue, not a harsh pure black
    backgroundElement: '#181B21', // raised surface for cards / tiles
    backgroundSelected: '#262A32', // pressed / selected fill
    border: '#282C34', // hairline that separates surfaces on dark
    textSecondary: '#9BA1AC',
    // Brighter variants so they stay legible on the near-black dark background.
    spend: '#FF6369',
    income: '#3DD68C',
    accent: '#6AA1FF',
    review: '#FFCA16',
    onAccent: '#0C0E12',
    onReview: '#1A1200',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
