/**
 * One transaction row, shared by the Import and Reports lists. Extracted from the two identical
 * inline copies so the (virtualized) lists render the exact same cell.
 *
 * `React.memo` matters: FlashList recycles rows, so a memoized cell avoids re-rendering every
 * visible row when the parent's state changes. For the memo to hold, `onPress` must be a STABLE
 * callback (the row passes its own id back), and `categoryLabel` is compared by value.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { TransactionRow } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { useTheme } from '@/hooks/use-theme';

const DIRECTION_META = {
  out: { sign: '−', color: 'spend' },
  in: { sign: '+', color: 'income' },
  self: { sign: '⇄', color: 'review' },
} as const;

export interface TxnRowProps {
  txn: TransactionRow;
  /** Resolved "🍽️ Food & Dining · Restaurant", or null when uncategorized. */
  categoryLabel: string | null;
  /** Stable callback (receives the row id) so the memoized cell isn't invalidated each render. */
  onPress: (id: number) => void;
  /** Show the "Review" badge on the meta line (Home does; Reports doesn't). */
  showReviewBadge?: boolean;
}

export const TxnRow = React.memo(function TxnRow({
  txn,
  categoryLabel,
  onPress,
  showReviewBadge = false,
}: TxnRowProps) {
  const theme = useTheme();
  const meta = DIRECTION_META[txn.direction as keyof typeof DIRECTION_META] ?? DIRECTION_META.out;
  const secondary =
    (categoryLabel ?? (txn.direction === 'self' || txn.kind === 'received' ? 'Transfer' : 'Uncategorized')) +
    ' · ' +
    txn.isoDate;

  return (
    <Pressable
      onPress={() => onPress(txn.id)}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <ThemedView type="backgroundElement" style={styles.txnRow}>
        <View style={styles.txnLeft}>
          <ThemedText type="default" numberOfLines={1}>
            {txn.counterpartyName ?? txn.rawDetails ?? '—'}
          </ThemedText>
          <View style={styles.txnMetaRow}>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.txnMeta}>
              {secondary}
            </ThemedText>
            {showReviewBadge && txn.needsReview && (
              <View style={[styles.badge, { backgroundColor: theme.review }]}>
                <ThemedText type="small" style={[styles.badgeText, { color: theme.onReview }]}>
                  Review
                </ThemedText>
              </View>
            )}
          </View>
        </View>
        <ThemedText type="smallBold" style={{ color: theme[meta.color] }}>
          {meta.sign} {formatINR(txn.paise)}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  txnLeft: { flex: 1, gap: 2 },
  txnMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  txnMeta: { flexShrink: 1 },
  badge: {
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
  },
  badgeText: { fontSize: 11, lineHeight: 16, fontWeight: '700' },
});
