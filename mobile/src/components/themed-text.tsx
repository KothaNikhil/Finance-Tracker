import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'display'
    | 'title'
    | 'heading'
    | 'label'
    | 'small'
    // One step up from `small` in weight only (500 vs 400) — the app caps every weight at 500, so
    // hierarchy is carried by size, colour and alignment rather than by boldness.
    | 'smallEmphasis'
    | 'subtitle'
    | 'link'
    | 'code'
    // Currency figures: `amount` for card/summary headlines, `amountLarge` for the big sheet figure.
    | 'amount'
    | 'amountLarge'
    // The value of a StatTile (e.g. "₹1,234").
    | 'stat'
    // An uppercase-ish section label (11px, tracked). Replaces the inline 12/letterSpacing pattern.
    | 'overline'
    // The smallest label: badges, chart value/axis labels.
    | 'caption';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        styles.base,
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'display' && styles.display,
        type === 'title' && styles.title,
        type === 'heading' && styles.heading,
        type === 'label' && styles.label,
        type === 'small' && styles.small,
        type === 'smallEmphasis' && styles.smallEmphasis,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'code' && styles.code,
        type === 'amount' && styles.amount,
        type === 'amountLarge' && styles.amountLarge,
        type === 'stat' && styles.stat,
        type === 'overline' && styles.overline,
        type === 'caption' && styles.caption,
        style,
      ]}
      {...rest}
    />
  );
}

/**
 * Nothing in the app is heavier than 500. Hierarchy comes from size, from `text` versus
 * `textSecondary`, and from the semantic spend/income colours — never from weight.
 */
export const MAX_FONT_WEIGHT = 500;

const styles = StyleSheet.create({
  base: {
    fontFamily: Fonts.sans,
  },
  display: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: 500,
    letterSpacing: -0.6,
  },
  small: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: 400,
  },
  smallEmphasis: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: 500,
  },
  default: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: 400,
  },
  title: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: 500,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: 500,
    letterSpacing: -0.3,
  },
  heading: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: 500,
  },
  label: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: 500,
  },
  link: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: 500,
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: 400,
    fontSize: 11,
  },
  amount: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: 500,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
  },
  amountLarge: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: 500,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.4,
  },
  stat: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: 500,
    fontVariant: ['tabular-nums'],
  },
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: 500,
    letterSpacing: 0.6,
  },
  caption: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: 400,
  },
});

export const TEXT_STYLES = styles;
