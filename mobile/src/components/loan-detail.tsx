/**
 * A loan's management sheet: running balance (principal / repaid / outstanding / interest), the list
 * of attached transactions, and actions — add a manual entry, attach existing transactions, edit the
 * loan, close/reopen it, or delete it. The balance comes from the loan view's rolled-up transactions.
 */

import { SymbolView } from 'expo-symbols';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ListSection } from '@/components/list-section';
import { ThemedText } from '@/components/themed-text';
import { ViewOnlyHint } from '@/components/view-only-hint';
import { Opacity, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { TextRole } from '@/constants/typography';
import { formatINR } from '@/core/domain/money';
import { isTransferRole, loanFlowLabel, loanFlowOf, loanPartOf, ROLE_META, type LoanKind, type LoanPart } from '@/core/lending/roles';
import type { LoanView } from '@/hooks/use-lending';
import { useTheme } from '@/hooks/use-theme';
import { useViewOnly } from '@/services/drive/edit-session';

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
  /** Opens the entry editor for a row the user added by hand. */
  onEditTxn: (id: number) => void;
}

interface LoanHistoryItem {
  key: string;
  txnId: number;
  title: string;
  isoDate: string;
  time: string | null;
  note: string;
  direction: string;
  paise: number;
  part: LoanPart | null;
  split: boolean;
  /** Hand-entered rows are the user's own data and open the entry editor instead of the detail sheet. */
  manual: boolean;
  sortKey: string;
}

export function LoanDetail({ visible, loan, onClose, onAddTxn, onAttachExisting, onEditLoan, onToggleClosed, onDeleteLoan, onPressTxn, onEditTxn }: LoanDetailProps) {
  const theme = useTheme();
  // View only: balance and history stay readable; every loan action is disabled.
  const viewOnly = useViewOnly();
  if (!loan) return null;

  const { balance: bal, netOwedToMePaise: net } = loan;
  // Positive → they owe you; negative → you owe them (e.g. over-repaid); zero → settled.
  const status = net > 0 ? 'they owe you' : net < 0 ? 'you owe them' : 'settled';
  const outColor = net > 0 ? theme.income : net < 0 ? theme.spend : theme.textSecondary;
  const history: LoanHistoryItem[] = [
    ...loan.txns.map((transaction) => {
      const part = loanPartOf(transaction.transferRole);
      const meta = isTransferRole(transaction.transferRole) ? ROLE_META[transaction.transferRole] : null;
      return {
        key: `txn-${transaction.id}`,
        txnId: transaction.id,
        title: part ? historyTitle(part, loan.kind) : (meta?.label ?? transaction.kind),
        isoDate: transaction.isoDate,
        time: transaction.time,
        note: transaction.counterpartyName || transaction.remarks || '',
        direction: transaction.direction,
        paise: transaction.paise,
        part,
        split: false,
        manual: transaction.source === 'manual',
        sortKey: `${transaction.isoDate}T${transaction.time ?? ''}-${String(transaction.id).padStart(12, '0')}`,
      };
    }),
    ...loan.allocations.map((allocation) => ({
      key: `alloc-${allocation.id}`,
      txnId: allocation.txnId,
      title: historyTitle(allocation.part, loan.kind),
      isoDate: allocation.isoDate,
      time: null,
      note: allocation.label,
      direction: allocation.direction,
      paise: allocation.paise,
      part: allocation.part,
      split: true,
      manual: false,
      sortKey: `${allocation.isoDate}T-${String(allocation.id).padStart(12, '0')}`,
    })),
  ].sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  const confirmDelete = () => {
    Alert.alert(
      'Delete this loan?',
      'Direct transactions stay in Activity. Split slices assigned to this loan are removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            onDeleteLoan();
            onClose();
          },
        },
      ],
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SafeAreaView edges={['bottom']} style={styles.flexible}>
        <View style={styles.header}>
          <ThemedText type="smallEmphasis">Loan details</ThemedText>
          <Pressable onPress={onClose} hitSlop={14} accessibilityRole="button" accessibilityLabel="Close loan details">
            <ThemedText type="link" style={{ color: theme.accent }}>
              Close
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView style={styles.flexible} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <View style={styles.identity}>
            <View
              style={[
                styles.avatar,
                { backgroundColor: loan.kind === 'lent' ? theme.accentMuted : theme.spendMuted },
              ]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              <ThemedText type="smallEmphasis" style={{ color: loan.kind === 'lent' ? theme.accent : theme.spend }}>
                {loan.personName.trim().charAt(0).toUpperCase() || '?'}
              </ThemedText>
            </View>
            <View style={styles.nameLine}>
              <ThemedText type="heading" numberOfLines={2} style={styles.loanName}>
                {loan.personName}
                {loan.name ? ` · ${loan.name}` : ''}
              </ThemedText>
              <LoanKindBadge kind={loan.kind} />
            </View>
            <ThemedText type="amountLarge" style={[styles.outstanding, { color: outColor }]}>
              {formatINR(Math.abs(net))}
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              {status} · {loan.closed ? 'closed loan' : 'active loan'}
            </ThemedText>
          </View>

          <Card padding="small" style={styles.metricsCard}>
            <Metric label="Principal" value={formatINR(bal.principalPaise)} />
            <View style={[styles.metricDivider, { backgroundColor: theme.border }]} />
            <Metric label="Repaid" value={formatINR(bal.repaidPaise)} />
            <View style={[styles.metricDivider, { backgroundColor: theme.border }]} />
            <Metric label="Interest" value={formatINR(bal.interestPaise)} />
          </Card>

          {!loan.closed ? (
            <View style={styles.actionRow}>
              <Button
                label="Add entry"
                icon={{ ios: 'plus.square', android: 'add_box', web: 'add_box' }}
                variant="secondary"
                onPress={onAddTxn}
                disabled={viewOnly}
                style={styles.actionBtn}
              />
              <Button
                label="Attach existing"
                icon={{ ios: 'paperclip', android: 'attach_file', web: 'attach_file' }}
                variant="secondary"
                onPress={onAttachExisting}
                disabled={viewOnly}
                style={styles.actionBtn}
              />
            </View>
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyRow}>
              Reopen this loan before adding or attaching transactions.
            </ThemedText>
          )}
          <View style={styles.actionRow}>
            <Button
              label="Edit loan"
              icon={{ ios: 'square.and.pencil', android: 'edit', web: 'edit' }}
              variant="secondary"
              onPress={onEditLoan}
              disabled={viewOnly}
              style={styles.actionBtn}
            />
            <Button
              label={loan.closed ? 'Reopen loan' : 'Close loan'}
              icon={{
                ios: loan.closed ? 'arrow.uturn.backward.circle' : 'minus.circle',
                android: loan.closed ? 'replay' : 'do_not_disturb_on',
                web: loan.closed ? 'replay' : 'do_not_disturb_on',
              }}
              variant={loan.closed ? 'secondary' : 'danger'}
              onPress={onToggleClosed}
              disabled={viewOnly}
              style={styles.actionBtn}
            />
          </View>

          <View style={styles.sectionHeading}>
            <ThemedText type="overline" themeColor="textSecondary">
              TRANSACTIONS
            </ThemedText>
            {history.length > 0 ? (
              <ThemedText type="caption" themeColor="textSecondary">
                {viewOnly ? 'Tap a row to view' : 'Tap a row to edit'}
              </ThemedText>
            ) : null}
          </View>
          {history.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyRow}>
              No transactions yet. Add a manual entry or attach an imported transaction.
            </ThemedText>
          ) : (
            <ListSection>
              {history.map((item) => (
                <HistoryRow
                  key={item.key}
                  item={item}
                  onPress={() =>
                    // View only: a hand-entered row opens the read-only detail sheet, not its editor.
                    item.manual && !viewOnly ? onEditTxn(item.txnId) : onPressTxn(item.txnId)
                  }
                />
              ))}
            </ListSection>
          )}

          <Button
            label="Delete loan"
            icon={{ ios: 'trash', android: 'delete', web: 'delete' }}
            variant="danger"
            onPress={confirmDelete}
            disabled={viewOnly}
            style={styles.deleteBtn}
          />
          {viewOnly ? <ViewOnlyHint /> : null}
        </ScrollView>
      </SafeAreaView>
    </BottomSheet>
  );
}

function historyTitle(part: LoanPart | null, kind: LoanKind): string {
  if (part === 'principal' || part === 'repayment') return loanFlowLabel(loanFlowOf(kind, part));
  if (part === 'interest') return kind === 'lent' ? 'Interest received' : 'Interest paid';
  return 'Loan transaction';
}

function LoanKindBadge({ kind }: { kind: LoanKind }) {
  const theme = useTheme();
  const lent = kind === 'lent';
  return (
    <View style={[styles.badge, { backgroundColor: lent ? theme.accentMuted : theme.spendMuted }]}>
      <ThemedText type="caption" style={{ color: lent ? theme.accent : theme.spend }}>
        {lent ? 'Lent' : 'Borrowed'}
      </ThemedText>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <ThemedText type="caption" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="stat" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {value}
      </ThemedText>
    </View>
  );
}

function HistoryRow({ item, onPress }: { item: LoanHistoryItem; onPress: () => void }) {
  const theme = useTheme();
  const out = item.direction === 'out';
  const incoming = item.direction === 'in';
  const color = out ? theme.spend : incoming ? theme.income : theme.textSecondary;
  const detail = [item.isoDate, item.time, item.split ? 'Part of a split payment' : null, item.note]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.isoDate}, ${
        out ? 'money out' : incoming ? 'money in' : 'self-transfer'
      } ${formatINR(item.paise)}${
        item.split ? ', part of a split payment' : ''
      }`}
      accessibilityHint={item.manual ? 'Edit this hand-entered entry' : 'Opens transaction details'}
      style={({ pressed }) => [styles.historyRow, { opacity: pressed ? Opacity.pressed : 1 }]}
    >
      <View
        style={[
          styles.historyIcon,
          {
            backgroundColor: out
              ? theme.spendMuted
              : incoming
                ? theme.incomeMuted
                : theme.backgroundSelected,
          },
        ]}
      >
        <SymbolView
          name={{
            ios: out ? 'arrow.down' : incoming ? 'arrow.up' : 'arrow.left.arrow.right',
            android: out ? 'arrow_downward' : incoming ? 'arrow_upward' : 'sync_alt',
            web: out ? 'arrow_downward' : incoming ? 'arrow_upward' : 'sync_alt',
          }}
          size={14}
          tintColor={color}
        />
      </View>
      <View style={styles.rowLeft}>
        <View style={styles.historyTitleLine}>
          <ThemedText type={TextRole.rowTitle} numberOfLines={1} style={styles.historyTitle}>
            {item.title}
          </ThemedText>
          {item.split ? (
            <View style={[styles.splitBadge, { backgroundColor: theme.accentMuted }]}>
              <ThemedText type="caption" style={{ color: theme.accent }}>
                Split
              </ThemedText>
            </View>
          ) : null}
        </View>
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
          {detail}
        </ThemedText>
      </View>
      <ThemedText type={TextRole.rowAmount} style={[styles.tabular, { color }]} numberOfLines={1}>
        {out ? '−' : incoming ? '+' : ''}
        {formatINR(item.paise)}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flexible: { flexShrink: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  body: { paddingBottom: Spacing.four, gap: Spacing.two },
  identity: { alignItems: 'center', paddingHorizontal: Spacing.two },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  nameLine: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  loanName: { flexShrink: 1, textAlign: 'center' },
  badge: {
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
    flexShrink: 0,
  },
  outstanding: { marginTop: Spacing.one },
  metricsCard: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.one },
  metric: { flex: 1, alignItems: 'center' },
  metricDivider: { width: StyleSheet.hairlineWidth, height: 28 },
  actionRow: { flexDirection: 'row', gap: Spacing.two },
  actionBtn: { flex: 1 },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
  },
  tabular: { fontVariant: ['tabular-nums'] },
  emptyRow: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
  historyRow: {
    minHeight: TouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  historyIcon: {
    width: 26,
    height: 26,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLeft: { flex: 1, minWidth: 0 },
  historyTitleLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, minWidth: 0 },
  historyTitle: { flexShrink: 1 },
  splitBadge: {
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.one,
    paddingVertical: 1,
  },
  deleteBtn: { marginTop: Spacing.one },
});
