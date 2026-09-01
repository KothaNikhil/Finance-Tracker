import { Children, Fragment, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface ListSectionProps {
  /** Small tracked label above the rows. */
  title?: string;
  /** Trailing content on the title row, e.g. a count or a link. */
  action?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Rows on the screen background, separated by hairlines — the list treatment used everywhere a
 * stack of one-item cards used to be. A `Card` is kept for summary surfaces, which genuinely are a
 * distinct block; a list of comparable things reads better as a continuous run of rows.
 */
export function ListSection({ title, action, children, style }: ListSectionProps) {
  const theme = useTheme();
  const rows = Children.toArray(children).filter(Boolean);

  return (
    <View style={style}>
      {title || action ? (
        <View style={styles.header}>
          {title ? (
            <ThemedText type="overline" themeColor="textSecondary">
              {title}
            </ThemedText>
          ) : null}
          {action}
        </View>
      ) : null}
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index > 0 ? <View style={[styles.divider, { backgroundColor: theme.border }]} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    marginBottom: Spacing.half,
  },
  divider: { height: StyleSheet.hairlineWidth },
});
