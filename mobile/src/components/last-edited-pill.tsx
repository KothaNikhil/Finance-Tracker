/**
 * A floating pill, shown on every tab, that reopens the LAST-EDITED transaction (see
 * {@link useTransactionDetail}). It sits just above the bottom tab bar and shows a compact summary
 * ("↩ Zomato · −₹450"); tapping it reopens that transaction's detail sheet in place. A small ✕
 * dismisses it. It renders nothing until a transaction has been edited (or after the row is gone).
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import type { TransactionRow } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { useLiveQuery } from '@/hooks/use-live-query';
import { useTheme } from '@/hooks/use-theme';
import { useTransactionDetail } from '@/hooks/use-transaction-detail';
import { getDb } from '@/services/db/database';
import { txnByIdQuery } from '@/services/db/queries/transactions';

const SIGN = { out: '−', in: '+', self: '⇄' } as const;

export function LastEditedPill() {
  const theme = useTheme();
  const { lastEditedId, openId, openLast, clearLastEdited } = useTransactionDetail();
  const db = getDb();

  const { data } = useLiveQuery(txnByIdQuery(db, lastEditedId ?? -1), [lastEditedId]);
  const txn = (data?.[0] as TransactionRow | undefined) ?? null;

  // Nothing edited yet, the row was deleted, or its sheet is already open → no pill.
  if (!txn || openId === txn.id) return null;

  const dir = (txn.direction as keyof typeof SIGN) ?? 'out';
  const color = dir === 'out' ? theme.spend : dir === 'in' ? theme.income : theme.review;
  const title = txn.counterpartyName ?? txn.rawDetails ?? 'Transaction';

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <ThemedView type="backgroundElement" style={[styles.pill, { borderColor: theme.border }]}>
        <Pressable
          onPress={openLast}
          accessibilityRole="button"
          accessibilityLabel={`Reopen last edited transaction: ${title}`}
          style={({ pressed }) => [styles.tap, { opacity: pressed ? 0.6 : 1 }]}
        >
          <ThemedText type="small" themeColor="textSecondary">
            ↩
          </ThemedText>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.label}>
            {title}
          </ThemedText>
          <ThemedText type="smallBold" style={{ color }}>
            {SIGN[dir]} {formatINR(txn.paise)}
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={clearLastEdited}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={10}
          style={({ pressed }) => [styles.dismiss, { opacity: pressed ? 0.5 : 1 }]}
        >
          <ThemedText type="small" themeColor="textSecondary">
            ✕
          </ThemedText>
        </Pressable>
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: BottomTabInset + Spacing.two,
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    maxWidth: 460,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    // A soft lift so it reads as floating above the list.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  tap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexShrink: 1 },
  label: { flexShrink: 1 },
  dismiss: { paddingLeft: Spacing.one },
});
