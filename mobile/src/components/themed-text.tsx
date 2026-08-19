import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'title'
    | 'small'
    | 'smallBold'
    | 'subtitle'
    | 'link'
    | 'code'
    // Currency figures: `amount` for card/summary headlines, `amountLarge` for the big sheet figure.
    | 'amount'
    | 'amountLarge'
    // The value of a StatTile (e.g. "₹1,234").
    | 'stat'
    // An uppercase-ish section label (12px, tracked). Replaces the inline 12/letterSpacing pattern.
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
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
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

const styles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  title: {
    fontSize: 48,
    fontWeight: 600,
    lineHeight: 52,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 44,
    fontWeight: 600,
  },
  link: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: 600,
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
  amount: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: 700,
  },
  amountLarge: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: 700,
  },
  stat: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 700,
  },
  overline: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: 700,
    letterSpacing: 0.5,
  },
  caption: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: 700,
  },
});
