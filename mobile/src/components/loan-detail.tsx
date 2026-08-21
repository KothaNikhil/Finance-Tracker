/**
 * A loan's management sheet: running balance (principal / repaid / outstanding / interest), the list
 * of attached transactions, and actions — add a manual entry, attach existing transactions, edit the
 * loan, close/reopen it, or delete it. The balance comes from the loan view's rolled-up transactions.
 */

import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatINR } from '@/core/domain/money';
import { isTransferRole, ROLE_META } from '@/core/lending/roles';
import type { LoanView } from '@/hooks/use-lending';
import { useTheme } from '@/hooks/use-theme';

export interface LoanDetailProps {
  visible: boolean;
  loan: LoanView | null;
  onClose: () => void;
  onAddTxn: () => void;
  onAttachExisting: () => void;
  onEditLoan: () => void;
  onToggleClosed: () => void;
  onDeleteLoan: () => void;
  onPressTxn: (id: number) => void;
}

export function LoanDetail({ visible, loan, onClose, onAddTxn, onAttachExisting, onEditLoan, onToggleClosed, onDeleteLoan, onPressTxn }: LoanDetailProps) {
  const theme = useTheme();
  if (!loan) return null;

  const { balance: bal, netOwedToMePaise: net } = loan;
  // Positive → they owe you; negative → you owe them (e.g. over-repaid); zero → settled.
  const status = net > 0 ? 'They owe you' : net < 0 ? 'You owe them' : 'Settled';
  const outColor = net > 0 ? theme.income : net < 0 ? theme.spend : theme.textSecondary;

  const confirmDelete = () => {
    Alert.alert('Delete this loan?', 'The loan is removed; its transactions are kept (just detached).', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { onDeleteLoan(); onClose(); } },
    ]);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SafeAreaView edges={['bottom']} style={styles.flexible}>
        <View style={styles.header}>
          <ThemedText type="smallBold">Loan</ThemedText>
          <Pressable onPress={onClose} hitSlop={8}>
            <ThemedText type="link" themeColor="textSecondary">
              Close
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView style={styles.flexible} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <ThemedText type="subtitle" numberOfLines={1}>
            {loan.personName}
            {loan.name ? ` · ${loan.name}` : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {loan.kind === 'lent' ? 'You lent (they owe you)' : 'You borrowed (you owe them)'}
          </ThemedText>

          <ThemedText type="small" themeColor="textSecondary" style={styles.outLabel}>
            {status}
          </ThemedText>
          <ThemedText type="amountLarge" style={{ color: outColor }}>
            {formatINR(Math.abs(net))}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Principal {formatINR(bal.principalPaise)} · repaid {formatINR(bal.repaidPaise)} · interest {formatINR(bal.interestPaise)}
          </ThemedText>

          <View style={styles.actionRow}>
            <Button label="＋ Add" variant="primary" onPress={onAddTxn} style={styles.actionBtn} />
            <Button label="Attach existing" variant="secondary" onPress={onAttachExisting} style={styles.actionBtn} />
          </View>
          <View style={styles.actionRow}>
            <Button label="Edit" variant="secondary" onPress={onEditLoan} style={styles.actionBtn} />
            <Button label={loan.closed ? 'Reopen' : 'Close'} variant="secondary" onPress={onToggleClosed} style={styles.actionBtn} />
          </View>

          <ThemedText type="overline" themeColor="textSecondary" style={styles.sectionTitle}>
            TRANSACTIONS · tap to edit
          </ThemedText>
          {loan.txns.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No transactions yet — add one or attach existing.
            </ThemedText>
          ) : (
            loan.txns.map((c) => {
              const meta = isTransferRole(c.transferRole) ? ROLE_META[c.transferRole] : null;
              const out = c.direction === 'out';
              return (
                <Pressable
                  key={c.id}
                  onPress={() => onPressTxn(c.id)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.row, { borderBottomColor: theme.border, opacity: pressed ? 0.6 : 1 }]}
                >
                  <View style={styles.rowLeft}>
                    <ThemedText type="default" numberOfLines={1}>
                      {meta ? `${meta.emoji} ${meta.label}` : c.kind}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {c.isoDate}
                      {c.counterpartyName ? ` · ${c.counterpartyName}` : c.remarks ? ` · ${c.remarks}` : ''}
                    </ThemedText>
                  </View>
                  <ThemedText type="smallBold" style={{ color: out ? theme.spend : theme.income }}>
                    {out ? '−' : '+'} {formatINR(c.paise)}
                  </ThemedText>
                </Pressable>
              );
            })
          )}

          <Pressable onPress={confirmDelete} accessibilityRole="button" style={({ pressed }) => [styles.deleteBtn, { borderColor: theme.spend, opacity: pressed ? 0.6 : 1 }]}>
            <ThemedText type="smallBold" style={{ color: theme.spend }}>
              Delete loan
            </ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flexible: { flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.two },
  body: { paddingBottom: Spacing.four, gap: Spacing.one },
  outLabel: { marginTop: Spacing.two },
  actionRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  actionBtn: { flex: 1 },
  sectionTitle: { marginTop: Spacing.three, marginBottom: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, gap: Spacing.two },
  rowLeft: { flex: 1, gap: Spacing.half },
  deleteBtn: { marginTop: Spacing.four, paddingVertical: Spacing.three, borderRadius: Spacing.two, borderWidth: 1, alignItems: 'center' },
});
