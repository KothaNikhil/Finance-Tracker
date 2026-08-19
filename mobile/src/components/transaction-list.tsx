/**
 * The shared, virtualized transaction list used by Home and Reports. Rows are grouped under
 * STICKY month headers ("May 2026") so — even with thousands of rows paging in as you scroll —
 * you always see which month you're in, instead of an orientation-less infinite scroll.
 *
 * The list still pages via a growing LIMIT (see {@link useTransactionList}); `onEndReached` grows
 * the window and a small spinner shows while more is loading. Month grouping is derived from the
 * loaded rows (they're already sorted newest-first, so months are contiguous).
 */

import { FlashList } from '@shopify/flash-list';
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { TxnRow } from '@/components/txn-row';
import { Spacing } from '@/constants/theme';
import { MONTH_LABELS } from '@/core/analytics';
import type { TransactionRow } from '@/core/db/schema';
import { useTheme } from '@/hooks/use-theme';

type ListItem =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'row'; txn: TransactionRow };

/** 'YYYY-MM' → "May 2026". */
function monthLabel(ym: string): string {
  const month = parseInt(ym.slice(5, 7), 10);
  return `${MONTH_LABELS[month - 1] ?? ym.slice(5, 7)} ${ym.slice(0, 4)}`;
}

export interface TransactionListProps {
  rows: TransactionRow[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  onPressRow: (id: number) => void;
  categoryLabelFor: (txn: TransactionRow) => string | null;
  showReviewBadge?: boolean;
  ListHeaderComponent?: React.ReactElement | null;
  ListFooterComponent?: React.ReactElement | null;
  ListEmptyComponent?: React.ReactElement | null;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

export function TransactionList({
  rows,
  loading,
  hasMore,
  loadMore,
  onPressRow,
  categoryLabelFor,
  showReviewBadge,
  ListHeaderComponent,
  ListFooterComponent,
  ListEmptyComponent,
  contentContainerStyle,
}: TransactionListProps) {
  // Flatten rows into [monthHeader, ...rows, monthHeader, ...rows] and track the header positions.
  const { items, stickyHeaderIndices } = useMemo(() => {
    const out: ListItem[] = [];
    const sticky: number[] = [];
    let current = '';
    for (const txn of rows) {
      const ym = txn.isoDate.slice(0, 7);
      if (ym !== current) {
        current = ym;
        sticky.push(out.length);
        out.push({ kind: 'header', key: ym, label: monthLabel(ym) });
      }
      out.push({ kind: 'row', txn });
    }
    return { items: out, stickyHeaderIndices: sticky };
  }, [rows]);

  const footer = (
    <View>
      {hasMore && <ActivityIndicator style={styles.loadMore} />}
      {ListFooterComponent}
    </View>
  );

  return (
    <FlashList
      data={items}
      keyExtractor={(item) => (item.kind === 'header' ? `h:${item.key}` : `r:${item.txn.id}`)}
      getItemType={(item) => item.kind}
      stickyHeaderIndices={stickyHeaderIndices}
      renderItem={({ item }) =>
        item.kind === 'header' ? (
          <MonthHeader label={item.label} />
        ) : (
          <View style={styles.rowWrap}>
            <TxnRow
              txn={item.txn}
              categoryLabel={categoryLabelFor(item.txn)}
              onPress={onPressRow}
              showReviewBadge={showReviewBadge}
            />
          </View>
        )
      }
      ListHeaderComponent={ListHeaderComponent}
      ListFooterComponent={footer}
      ListEmptyComponent={loading ? null : ListEmptyComponent}
      onEndReached={hasMore ? loadMore : undefined}
      onEndReachedThreshold={0.6}
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator={false}
    />
  );
}

/** Opaque so it cleanly overlays scrolling rows while stuck to the top. */
function MonthHeader({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.monthHeader, { backgroundColor: theme.background }]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  monthHeader: { paddingTop: Spacing.three, paddingBottom: Spacing.one },
  rowWrap: { marginBottom: Spacing.two },
  loadMore: { marginVertical: Spacing.two },
});
