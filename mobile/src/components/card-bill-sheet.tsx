/**
 * Credit-card bill flow for a bank bill-payment transaction. Two modes:
 *  - LINKED: shows the card statement this payment settled and lists its itemised card spends
 *    (tap to open one), with an "Unlink" action.
 *  - UNLINKED: lets the user pick which card statement this payment settled — amount-matched
 *    statements are suggested at the top, with every other card statement below.
 *
 * Mirrors the money-lent sheet's structure; the controller resolves the data via live queries.
 */

import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { ImportRow, TransactionRow } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { useTheme } from '@/hooks/use-theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Axis …CC ••4723 · Jun 2026" for a card-statement import batch. */
export function cardStatementLabel(stmt: ImportRow): string {
  const card = stmt.cardLast4 ? `••${stmt.cardLast4}` : stmt.sourceLabel.trim() || 'Card';
  let month = '';
  const m = /^(\d{4})-(\d{2})$/.exec(stmt.statementMonth ?? '');
  if (m) month = ` · ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}`;
  return `${card}${month}`;
}

export interface CardBillSheetProps {
  visible: boolean;
  /** The statement this payment is linked to, or null when unlinked. */
  linkedStatement: ImportRow | null;
  /** The linked statement's itemised activity — spends AND refunds/cashbacks (empty when unlinked). */
  items: TransactionRow[];
  /** All imported card statements, for manual picking. */
  statements: ImportRow[];
  /** Ids of statements whose Total Payment Due matches this payment (suggested first). */
  suggestedIds: number[];
  onLink: (importId: number) => void;
  onUnlink: () => void;
  onPressSpend: (txnId: number) => void;
  onClose: () => void;
}

export function CardBillSheet({
  visible,
  linkedStatement,
  items,
  statements,
  suggestedIds,
  onLink,
  onUnlink,
  onPressSpend,
  onClose,
}: CardBillSheetProps) {
  const theme = useTheme();

  // Picker order: suggested (amount-matched) statements first, then the rest.
  const suggested = statements.filter((s) => suggestedIds.includes(s.id));
  const others = statements.filter((s) => !suggestedIds.includes(s.id));

  // Net of the itemised activity = spends (out) − refunds/cashbacks (in); should equal the statement's
  // Total Payment Due when the previous bill was cleared in full.
  const netPaise = items.reduce((sum, it) => sum + (it.direction === 'out' ? it.paise : -it.paise), 0);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SafeAreaView edges={['bottom']} style={styles.flexible}>
        <View style={styles.header}>
          <ThemedText type="smallBold">Credit-card bill</ThemedText>
          <Pressable onPress={onClose} hitSlop={8}>
            <ThemedText type="link" themeColor="textSecondary">
              Close
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView style={styles.flexible} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {linkedStatement ? (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                This payment settled the statement:
              </ThemedText>
              <ThemedText type="smallBold">{cardStatementLabel(linkedStatement)}</ThemedText>

              <ThemedText type="overline" themeColor="textSecondary" style={styles.sectionTitle}>
                {items.length} CARD TRANSACTION{items.length === 1 ? '' : 'S'} · SPENDS & REFUNDS · TAP TO OPEN
              </ThemedText>
              {items.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  This statement has no itemised activity (it may have been payment-only).
                </ThemedText>
              ) : (
                items.map((it) => {
                  const isOut = it.direction === 'out';
                  return (
                    <Pressable
                      key={it.id}
                      onPress={() => onPressSpend(it.id)}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.row, { borderColor: theme.border, opacity: pressed ? 0.6 : 1 }]}
                    >
                      <View style={styles.grow}>
                        <ThemedText type="small" numberOfLines={1}>
                          {it.counterpartyName ?? it.rawDetails ?? (isOut ? 'Card spend' : 'Refund / cashback')}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {isOut ? 'Spend' : 'Refund / cashback'} · {it.isoDate}
                        </ThemedText>
                      </View>
                      <ThemedText type="smallBold" style={{ color: isOut ? theme.spend : theme.income }}>
                        {isOut ? '−' : '+'} {formatINR(it.paise)}
                      </ThemedText>
                    </Pressable>
                  );
                })
              )}

              {/* Reconciliation: spends − refunds should equal the statement's Total Payment Due. */}
              {items.length > 0 && (
                <View style={[styles.reconcile, { borderColor: theme.border }]}>
                  <View style={styles.grow}>
                    <ThemedText type="smallBold">Net (spends − refunds)</ThemedText>
                    {linkedStatement.totalDuePaise != null && (
                      <ThemedText type="small" themeColor="textSecondary">
                        Statement Total Payment Due: {formatINR(linkedStatement.totalDuePaise)}
                      </ThemedText>
                    )}
                  </View>
                  <ThemedText type="smallBold" style={{ color: netPaise >= 0 ? theme.spend : theme.income }}>
                    {netPaise >= 0 ? '−' : '+'} {formatINR(Math.abs(netPaise))}
                  </ThemedText>
                </View>
              )}

              <Pressable
                onPress={onUnlink}
                accessibilityRole="button"
                style={({ pressed }) => [styles.unlinkBtn, { borderColor: theme.spend, opacity: pressed ? 0.6 : 1 }]}
              >
                <ThemedText type="smallBold" style={{ color: theme.spend }}>
                  Unlink this statement
                </ThemedText>
              </Pressable>
            </>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                Link this bank payment to the credit-card statement it settled. Its card spends then
                count as your real expenses, and this payment is treated as a transfer (kept out of Spent).
              </ThemedText>

              {statements.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.sectionTitle}>
                  No credit-card statements imported yet. Import one from the Import tab first.
                </ThemedText>
              ) : (
                <>
                  {suggested.length > 0 && (
                    <ThemedText type="overline" themeColor="textSecondary" style={styles.sectionTitle}>
                      SUGGESTED (AMOUNT MATCHES)
                    </ThemedText>
                  )}
                  {suggested.map((s) => (
                    <StatementRow key={s.id} stmt={s} onPress={() => onLink(s.id)} theme={theme} highlight />
                  ))}
                  {others.length > 0 && (
                    <ThemedText type="overline" themeColor="textSecondary" style={styles.sectionTitle}>
                      ALL CARD STATEMENTS
                    </ThemedText>
                  )}
                  {others.map((s) => (
                    <StatementRow key={s.id} stmt={s} onPress={() => onLink(s.id)} theme={theme} />
                  ))}
                </>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </BottomSheet>
  );
}

function StatementRow({
  stmt,
  onPress,
  theme,
  highlight,
}: {
  stmt: ImportRow;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
  highlight?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        { borderColor: highlight ? theme.accent : theme.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <View style={styles.grow}>
        <ThemedText type="small">{cardStatementLabel(stmt)}</ThemedText>
        {stmt.totalDuePaise != null && (
          <ThemedText type="small" themeColor="textSecondary">
            Total due {formatINR(stmt.totalDuePaise)}
          </ThemedText>
        )}
      </View>
      <ThemedText type="link" style={{ color: theme.accent }}>
        Link
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flexible: { flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.two },
  body: { paddingBottom: Spacing.four, gap: Spacing.one },
  sectionTitle: { marginTop: Spacing.three, marginBottom: Spacing.half },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginTop: Spacing.one,
  },
  grow: { flex: 1 },
  reconcile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.two,
    paddingTop: Spacing.two,
  },
  unlinkBtn: {
    marginTop: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    alignItems: 'center',
  },
});
