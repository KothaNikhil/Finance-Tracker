/**
 * One transaction row, shared by the Import and Activity lists. Extracted from the two identical
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
import { Radius, Spacing } from '@/constants/theme';
import { MIN_FONT_SCALE, TextRole } from '@/constants/typography';
import type { TransactionRow } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { firstText } from '@/core/domain/text';
import { isTransferRole, ROLE_META } from '@/core/lending/roles';
import { useTheme } from '@/hooks/use-theme';

const DIRECTION_META = {
  out: { sign: '−', color: 'spend' },
  in: { sign: '+', color: 'income' },
  self: { sign: '⇄', color: 'review' },
} as const;

export type TxnRowVariant = 'card' | 'activity';

/** "#🥘 Food" → "🥘 Food" for a compact on-row chip. */
function formatTag(tag: string): string {
  return tag.replace(/^#/, '').trim();
}

export interface TxnRowProps {
  txn: TransactionRow;
  /** Resolved "🍽️ Food & Dining · Restaurant", or null when uncategorized. */
  categoryLabel: string | null;
  /** Stable callback (receives the row id) so the memoized cell isn't invalidated each render. */
  onPress: (id: number) => void;
  /** Show the "Review" badge for rows still awaiting confirmation. */
  showReviewBadge?: boolean;
  /** Activity uses a denser flat row; Import retains the existing card treatment. */
  variant?: TxnRowVariant;
  /**
   * Person / loan identity for a lending row, which carries no merchant of its own. Passed as two
   * strings rather than an object so the memo keeps comparing by value.
   */
  lendingTitle?: string | null;
  lendingDetail?: string | null;
}

export const TxnRow = React.memo(function TxnRow({
  txn,
  categoryLabel,
  onPress,
  showReviewBadge = false,
  variant = 'card',
  lendingTitle = null,
  lendingDetail = null,
}: TxnRowProps) {
  const theme = useTheme();
  const meta = DIRECTION_META[txn.direction as keyof typeof DIRECTION_META] ?? DIRECTION_META.out;
  // A tagged money-lent row shows its role (e.g. "💸 Lent"); otherwise the category; otherwise a
  // direction-based fallback. Only `self` is called "Transfer" — money-in is "Received" — so the
  // label matches the Activity direction filters (self→Transfer, in→Received).
  const roleLbl = isTransferRole(txn.transferRole)
    ? `${ROLE_META[txn.transferRole].emoji} ${ROLE_META[txn.transferRole].label}`
    : null;
  const fallback = txn.direction === 'self' ? 'Transfer' : txn.direction === 'in' ? 'Received' : 'Uncategorized';
  const secondary = (roleLbl ?? categoryLabel ?? fallback) + ' · ' + txn.isoDate;
  // `raw_details` is NOT NULL DEFAULT '', so `??` alone leaves an in-app lending row titleless.
  const title =
    firstText(txn.counterpartyName, txn.rawDetails, lendingTitle, roleLbl) ?? 'Unknown transaction';

  if (variant === 'activity') {
    const activityKind =
      txn.isRefund
        ? 'Refund'
        : txn.direction === 'self'
          ? 'Transfer'
          : (roleLbl ?? categoryLabel ?? fallback);
    const activitySecondary =
      [activityKind, lendingDetail, txn.accountName]
        .filter((part): part is string => !!part && part !== title)
        .join(' · ') || (categoryLabel ?? fallback);
    const glyph = activityGlyph(
      categoryLabel,
      title,
      txn.direction,
      txn.isRefund,
      isTransferRole(txn.transferRole) ? ROLE_META[txn.transferRole].emoji : null,
    );
    const avatarColors =
      txn.isRefund
        ? { backgroundColor: theme.accentMuted, color: theme.accent }
        : txn.direction === 'in'
          ? { backgroundColor: theme.incomeMuted, color: theme.income }
          : txn.direction === 'self' || roleLbl
            ? { backgroundColor: theme.reviewMuted, color: theme.review }
            : { backgroundColor: theme.spendMuted, color: theme.spend };

    return (
      <Pressable
        onPress={() => onPress(txn.id)}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${meta.sign}${formatINR(txn.paise)}, ${activitySecondary}, ${txn.isoDate}${txn.needsReview ? ', needs review' : ''}`}
        accessibilityHint="Opens transaction details"
        style={({ pressed }) => [
          styles.activityRow,
          { borderBottomColor: theme.border, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <View style={[styles.glyph, { backgroundColor: avatarColors.backgroundColor }]}>
          <ThemedText type="caption" style={{ color: avatarColors.color }} numberOfLines={1}>
            {glyph}
          </ThemedText>
        </View>

        <View style={styles.txnLeft}>
          <ThemedText type={TextRole.rowTitle} numberOfLines={1}>
            {title}
          </ThemedText>
          <ThemedText type={TextRole.rowSecondary} themeColor="textSecondary" numberOfLines={1}>
            {activitySecondary}
          </ThemedText>
        </View>

        <View style={styles.activityAmount}>
          <ThemedText
            type={TextRole.rowAmount}
            style={[styles.tabular, { color: theme[meta.color] }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={MIN_FONT_SCALE}
          >
            {meta.sign}{formatINR(txn.paise)}
          </ThemedText>
          {showReviewBadge && txn.needsReview ? (
            <View style={[styles.reviewOutline, { borderColor: theme.review }]}>
              <ThemedText type="caption" style={{ color: theme.review }}>
                Review
              </ThemedText>
            </View>
          ) : (
            <ThemedText type="caption" themeColor="textSecondary">
              {formatTime(txn.time) ?? txn.isoDate}
            </ThemedText>
          )}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => onPress(txn.id)}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <ThemedView type="backgroundElement" style={styles.txnRow}>
        <View style={styles.txnLeft}>
          <ThemedText type={TextRole.rowTitle} numberOfLines={1}>
            {title}
          </ThemedText>
          <View style={styles.txnMetaRow}>
            <ThemedText
              type={TextRole.rowSecondary}
              themeColor="textSecondary"
              numberOfLines={1}
              style={styles.txnMeta}
            >
              {secondary}
            </ThemedText>
            {showReviewBadge && txn.needsReview && (
              <View style={[styles.badge, { backgroundColor: theme.review }]}>
                <ThemedText type="caption" style={{ color: theme.onReview }}>
                  Review
                </ThemedText>
              </View>
            )}
            {/* Show the Paytm tag on rows awaiting a decision, so the tag is visible when the app's
                category disagrees with it and you're choosing which to keep. */}
            {txn.needsReview && txn.rawTag ? (
              <View style={[styles.tagChip, { borderColor: theme.border }]}>
                <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                  {formatTag(txn.rawTag)}
                </ThemedText>
              </View>
            ) : null}
          </View>
        </View>
        <ThemedText type={TextRole.rowAmount} style={[styles.tabular, { color: theme[meta.color] }]}>
          {meta.sign} {formatINR(txn.paise)}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
});

function activityGlyph(
  categoryLabel: string | null,
  title: string,
  direction: string,
  isRefund: boolean,
  roleEmoji: string | null,
): string {
  if (isRefund) return '↩';
  if (direction === 'self') return '⇄';
  const firstToken = categoryLabel?.trim().split(/\s+/)[0];
  if (firstToken && (firstToken.codePointAt(0) ?? 0) > 0x2000) return firstToken;
  if (roleEmoji) return roleEmoji;
  return Array.from(title.trim())[0]?.toUpperCase() ?? '•';
}

/** `13:05:00` → `1:05 PM`; malformed/absent statement times stay hidden. */
export function formatTime(time: string | null): string | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${match[2]} ${suffix}`;
}

const styles = StyleSheet.create({
  txnRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  txnLeft: { flex: 1, minWidth: 0 },
  txnMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  txnMeta: { flexShrink: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  badge: {
    borderRadius: Radius.xs,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
  },
  tagChip: {
    borderRadius: Radius.xs,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
    flexShrink: 1,
  },
  // ~54px: a 28px category glyph, one line of merchant, one compact secondary line.
  activityRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  glyph: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  activityAmount: {
    minWidth: 88,
    alignItems: 'flex-end',
  },
  reviewOutline: {
    minHeight: 16,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.xs,
    paddingHorizontal: Spacing.one,
  },
});
