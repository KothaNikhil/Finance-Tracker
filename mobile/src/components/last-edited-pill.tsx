/**
 * A floating pill, shown on every tab, that reopens the LAST-EDITED transaction (see
 * {@link useTransactionDetail}). It sits just above the bottom tab bar and shows a compact summary
 * ("↩ Zomato · −₹450"); tapping it reopens that transaction's detail sheet in place. A small ✕
 * dismisses it. It renders nothing until a transaction has been edited (or after the row is gone).
 */

import { SymbolView } from 'expo-symbols';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { lendingRowLabel } from '@/components/lending-row-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Opacity, Radius, Spacing, TouchTarget } from '@/constants/theme';
import type { TransactionRow } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { firstText } from '@/core/domain/text';
import { isTransferRole, roleLabel } from '@/core/lending/roles';
import { useLiveQuery } from '@/hooks/use-live-query';
import { useLists } from '@/hooks/use-reference-data';
import { useTheme } from '@/hooks/use-theme';
import { useTransactionDetail } from '@/hooks/use-transaction-detail';
import { getDb } from '@/services/db/database';
import { txnByIdQuery } from '@/services/db/queries/transactions';

const SIGN = { out: '−', in: '+', self: '⇄' } as const;
const LAST_EDITED_BOTTOM_INSET = Platform.OS === 'web' ? 88 : BottomTabInset;

export function LastEditedPill() {
  const theme = useTheme();
  const { lastEditedId, openId, openLast, clearLastEdited } = useTransactionDetail();
  const db = getDb();

  const { data } = useLiveQuery(txnByIdQuery(db, lastEditedId ?? -1), [lastEditedId]);
  const txn = (data?.[0] as TransactionRow | undefined) ?? null;
  const { people } = useLists();

  // Nothing edited yet, the row was deleted, or its sheet is already open → no pill.
  if (!txn || openId === txn.id) return null;

  const dir: keyof typeof SIGN =
    txn.direction === 'in' || txn.direction === 'self' || txn.direction === 'out'
      ? txn.direction
      : 'out';
  const color = dir === 'out' ? theme.spend : dir === 'in' ? theme.income : theme.review;
  // A lending row added in-app has no merchant, and `raw_details` is `''` rather than null, so the
  // person behind the loan names it. The pill renders one line, and a loan only outranks the person
  // for a row that has none — which `addLoanTransaction` and `attachTransactionToLoan` always set —
  // so the people list alone matches Activity without subscribing this always-mounted pill to every
  // loan query.
  const lendingTitle = lendingRowLabel(txn, {
    personName: txn.personId != null ? (people.find((person) => person.id === txn.personId)?.name ?? null) : null,
    loan: null,
    splitLoans: [],
  })?.title;
  const title =
    firstText(
      txn.counterpartyName,
      txn.rawDetails,
      lendingTitle,
      isTransferRole(txn.transferRole) ? roleLabel(txn.transferRole) : null,
    ) ?? 'Transaction';

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <ThemedView
        type="backgroundElement"
        style={[styles.pill, { borderColor: theme.borderStrong, shadowColor: theme.shadow }]}
      >
        <Pressable
          onPress={openLast}
          accessibilityRole="button"
          accessibilityLabel={`Reopen last edited transaction: ${title}`}
          accessibilityHint="Opens the transaction detail sheet"
          style={({ pressed }) => [styles.tap, { opacity: pressed ? Opacity.pressed : 1 }]}
        >
          <View style={[styles.icon, { backgroundColor: theme.accentMuted }]}>
            <SymbolView
              name={{ ios: 'arrow.uturn.backward', android: 'undo', web: 'undo' }}
              size={14}
              tintColor={theme.accent}
            />
          </View>
          <View style={styles.label}>
            <ThemedText type="caption" themeColor="textSecondary">
              Last edited
            </ThemedText>
            <ThemedText type="smallEmphasis" numberOfLines={1}>
              {title}
            </ThemedText>
          </View>
          <ThemedText type="smallEmphasis" style={[styles.figure, { color }]}>
            {SIGN[dir]}
            {formatINR(txn.paise)}
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={clearLastEdited}
          accessibilityRole="button"
          accessibilityLabel="Dismiss last edited transaction shortcut"
          hitSlop={10}
          style={({ pressed }) => [styles.dismiss, { opacity: pressed ? Opacity.pressed : 1 }]}
        >
          <SymbolView
            name={{ ios: 'xmark', android: 'close', web: 'close' }}
            size={16}
            tintColor={theme.textSecondary}
          />
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
    bottom: LAST_EDITED_BOTTOM_INSET + Spacing.two,
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    zIndex: 20,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    width: '100%',
    maxWidth: 460,
    paddingLeft: Spacing.two,
    paddingRight: Spacing.one,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    // A soft lift so it reads as floating above the list.
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  tap: {
    minHeight: TouchTarget,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minWidth: 0,
  },
  icon: {
    width: 26,
    height: 26,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flex: 1, minWidth: 0 },
  figure: { fontVariant: ['tabular-nums'] },
  dismiss: {
    width: 32,
    height: TouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
