/**
 * The shared, virtualized transaction list used by Import and Activity. Import keeps sticky month
 * headers; Activity can add day headings beneath those sticky month boundaries. Even with
 * thousands of rows paging in, the current period remains visible.
 *
 * The list still pages via a growing LIMIT (see {@link useTransactionList}); `onEndReached` grows
 * the window and a small spinner shows while more is loading. Grouping is derived from the loaded
 * rows (they're already sorted newest-first, so periods are contiguous).
 */

import { FlashList } from '@shopify/flash-list';
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { LendingRowLabel } from '@/components/lending-row-label';
import { ThemedText } from '@/components/themed-text';
import { TxnRow, type TxnRowVariant } from '@/components/txn-row';
import { Spacing } from '@/constants/theme';
import { MONTH_LABELS } from '@/core/analytics';
import type { TransactionRow } from '@/core/db/schema';
import { useTheme } from '@/hooks/use-theme';

type ListItem =
  | { kind: 'header'; key: string; label: string; level: 'month' | 'day' }
  | { kind: 'row'; txn: TransactionRow };

/** 'YYYY-MM' → "May 2026". */
function monthLabel(ym: string): string {
  const month = parseInt(ym.slice(5, 7), 10);
  return `${MONTH_LABELS[month - 1] ?? ym.slice(5, 7)} ${ym.slice(0, 4)}`;
}

/** `YYYY-MM-DD` → a compact day heading, with Today/Yesterday when applicable. */
export function dayLabel(isoDate: string, now = new Date()): string {
  const month = parseInt(isoDate.slice(5, 7), 10);
  const day = parseInt(isoDate.slice(8, 10), 10);
  const year = parseInt(isoDate.slice(0, 4), 10);
  const today = dateKey(now);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const date = `${day} ${MONTH_LABELS[month - 1] ?? isoDate.slice(5, 7)}${year === now.getFullYear() ? '' : ` ${year}`}`;
  if (isoDate === today) return `Today · ${date}`;
  if (isoDate === dateKey(yesterday)) return `Yesterday · ${date}`;
  return date;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export interface TransactionListProps {
  rows: TransactionRow[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  onPressRow: (id: number) => void;
  categoryLabelFor: (txn: TransactionRow) => string | null;
  /** Resolves person / loan identity for lending rows; omitted where loan data isn't loaded. */
  lendingLabelFor?: (txn: TransactionRow) => LendingRowLabel | null;
  showReviewBadge?: boolean;
  ListHeaderComponent?: React.ReactElement | null;
  ListFooterComponent?: React.ReactElement | null;
  ListEmptyComponent?: React.ReactElement | null;
  ListLoadingComponent?: React.ReactElement | null;
  contentContainerStyle?: StyleProp<ViewStyle>;
  groupBy?: 'month' | 'day' | 'month-day';
  rowVariant?: TxnRowVariant;
}

export function TransactionList({
  rows,
  loading,
  hasMore,
  loadMore,
  onPressRow,
  categoryLabelFor,
  lendingLabelFor,
  showReviewBadge,
  ListHeaderComponent,
  ListFooterComponent,
  ListEmptyComponent,
  ListLoadingComponent,
  contentContainerStyle,
  groupBy = 'month',
  rowVariant = 'card',
}: TransactionListProps) {
  // Flatten rows into [periodHeader, ...rows, periodHeader, ...rows] and track sticky positions.
  const { items, stickyHeaderIndices } = useMemo(() => {
    const out: ListItem[] = [];
    const sticky: number[] = [];
    let currentMonth = '';
    let currentDay = '';
    for (const txn of rows) {
      const monthKey = txn.isoDate.slice(0, 7);
      if (groupBy !== 'day' && monthKey !== currentMonth) {
        currentMonth = monthKey;
        sticky.push(out.length);
        out.push({
          kind: 'header',
          key: `month:${monthKey}`,
          label: monthLabel(monthKey),
          level: 'month',
        });
      }
      if (groupBy !== 'month' && txn.isoDate !== currentDay) {
        currentDay = txn.isoDate;
        if (groupBy === 'day') sticky.push(out.length);
        out.push({
          kind: 'header',
          key: `day:${txn.isoDate}`,
          label: dayLabel(txn.isoDate),
          level: 'day',
        });
      }
      out.push({ kind: 'row', txn });
    }
    return { items: out, stickyHeaderIndices: sticky };
  }, [groupBy, rows]);

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
          <PeriodHeader label={item.label} level={item.level} />
        ) : (
          <TransactionListRow
            txn={item.txn}
            categoryLabel={categoryLabelFor(item.txn)}
            lending={lendingLabelFor?.(item.txn) ?? null}
            onPress={onPressRow}
            showReviewBadge={showReviewBadge}
            variant={rowVariant}
          />
        )
      }
      ListHeaderComponent={ListHeaderComponent}
      ListFooterComponent={footer}
      ListEmptyComponent={loading ? ListLoadingComponent : ListEmptyComponent}
      onEndReached={hasMore ? loadMore : undefined}
      onEndReachedThreshold={0.6}
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator={false}
    />
  );
}

/** Unwraps the resolved lending label into primitives, so `TxnRow`'s memo still compares by value. */
function TransactionListRow({
  txn,
  categoryLabel,
  lending,
  onPress,
  showReviewBadge,
  variant,
}: {
  txn: TransactionRow;
  categoryLabel: string | null;
  lending: LendingRowLabel | null;
  onPress: (id: number) => void;
  showReviewBadge?: boolean;
  variant: TxnRowVariant;
}) {
  return (
    <View style={variant === 'activity' ? styles.activityRowWrap : styles.rowWrap}>
      <TxnRow
        txn={txn}
        categoryLabel={categoryLabel}
        lendingTitle={lending?.title ?? null}
        lendingDetail={lending?.detail ?? null}
        onPress={onPress}
        showReviewBadge={showReviewBadge}
        variant={variant}
      />
    </View>
  );
}

/** Opaque so it cleanly overlays scrolling rows while stuck to the top. */
function PeriodHeader({ label, level }: { label: string; level: 'month' | 'day' }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.periodHeader,
        level === 'day' && styles.dayHeader,
        { backgroundColor: theme.background },
      ]}
    >
      <ThemedText
        type={level === 'month' ? 'overline' : 'caption'}
        themeColor="textSecondary"
        accessibilityRole="header"
      >
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  periodHeader: { paddingTop: Spacing.two, paddingBottom: Spacing.half },
  dayHeader: { paddingTop: Spacing.one },
  rowWrap: { marginBottom: Spacing.one },
  activityRowWrap: { marginBottom: 0 },
  loadMore: { marginVertical: Spacing.two },
});
