import { SymbolView } from 'expo-symbols';
import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Opacity, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type StatTileVariant = 'tile' | 'column';

/**
 * A labelled figure (e.g. "Spent  ₹1,234.00"): an 11px label above a 16px value. `color` tints the
 * value; defaults to text. When `onPress` is set the tile is tappable and shows a corner chevron.
 *
 * `variant="tile"` is the standalone bordered card; `variant="column"` drops the surface so several
 * figures can share one {@link StatStrip} separated by hairlines instead of by whitespace.
 *
 * Every tile — pressable or not — uses the SAME outer wrapper (`flex: 1` > inner card), so tiles
 * in a row always get equal width. (A bare card vs. a Pressable-wrapped card distributed width
 * unequally.)
 */
export function StatTile({
  label,
  value,
  color,
  variant = 'tile',
  onPress,
}: {
  label: string;
  value: string;
  color?: string;
  variant?: StatTileVariant;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const column = variant === 'column';
  const body = (
    <>
      <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
        {label}
      </ThemedText>
      <ThemedText
        type="stat"
        style={{ color: color ?? theme.text }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {value}
      </ThemedText>
      {onPress && !column ? (
        <SymbolView
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          size={14}
          tintColor={theme.textSecondary}
          style={styles.chevron}
        />
      ) : null}
    </>
  );

  const inner = column ? (
    <View style={styles.column}>{body}</View>
  ) : (
    <View style={[styles.tile, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {body}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value}. View transactions.`}
        style={({ pressed }) => [styles.wrap, { opacity: pressed ? Opacity.pressed : 1 }]}
      >
        {inner}
      </Pressable>
    );
  }
  return <View style={styles.wrap}>{inner}</View>;
}

/**
 * Places 2–4 {@link StatTile}s with `variant="column"` in one row, separated by hairline rules.
 * Replaces the pattern of giving every single figure its own full-width card.
 */
export function StatStrip({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const items = Children.toArray(children);
  return (
    <View style={[styles.strip, style]}>
      {items.map((child, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <View style={[styles.stripDivider, { backgroundColor: theme.border }]} />
          ) : null}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  tile: {
    flex: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  column: { flex: 1, minWidth: 0, justifyContent: 'center', paddingHorizontal: Spacing.one },
  chevron: { position: 'absolute', top: Spacing.one, right: Spacing.one },
  strip: { flexDirection: 'row', alignItems: 'stretch' },
  stripDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: Spacing.two },
});
