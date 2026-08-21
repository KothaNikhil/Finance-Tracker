/**
 * A read-only detail sheet for one transaction: shows everything the app knows about it —
 * the amount, when it happened, how it was categorized, the counterparty, and (importantly)
 * any text the user wrote on it in Paytm (remarks, tag) plus the original statement wording.
 *
 * From here the user can jump to changing the category via `onChangeCategory`.
 */

import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { TransactionRow } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { useTheme } from '@/hooks/use-theme';

const DIRECTION = {
  out: { sign: '−', color: 'spend', label: 'Money out' },
  in: { sign: '+', color: 'income', label: 'Money in' },
  self: { sign: '⇄', color: 'review', label: 'Between own accounts' },
} as const;

const KIND_LABEL: Record<string, string> = {
  paid: 'Paid to a merchant',
  sent: 'Money sent to a person',
  received: 'Money received',
  self: 'Transfer between own accounts',
  billpay: 'Credit-card bill payment',
  recharge: 'Recharge',
  gold: 'Paytm gold',
  refund: 'Refund',
  other: 'Other',
};

const SOURCE_LABEL: Record<string, string> = {
  paytm: 'Paytm UPI statement',
  manual: 'Added manually',
  phonepe: 'PhonePe',
  gpay: 'Google Pay',
  bank: 'Bank statement',
  cc: 'Credit-card statement',
};

export interface TransactionDetailProps {
  visible: boolean;
  txn: TransactionRow | null;
  /** Resolved "🍽️ Food & Dining · Restaurant", or null when uncategorized. */
  categoryLabel: string | null;
  paymentModeName: string | null;
  personName: string | null;
  /** Loan this transaction belongs to (e.g. "abc · lent"), or null when it isn't in Money Lent. */
  moneyLentLabel?: string | null;
  onClose: () => void;
  onChangeCategory: () => void;
  /** Clear the category (back to uncategorized). */
  onRemoveCategory: () => void;
  /** Accept the current category as-is, clearing the "needs review" flag. Shown only when in review. */
  onAccept?: () => void;
  /** Open the single "Add to / Manage in Money Lent" flow. When provided, that action is shown. */
  onManageMoneyLent?: () => void;
  /** Delete this transaction entirely. When provided, a "Delete transaction" action is shown. */
  onDelete?: () => void;
}

export function TransactionDetail({
  visible,
  txn,
  categoryLabel,
  paymentModeName,
  personName,
  onClose,
  onChangeCategory,
  onRemoveCategory,
  onAccept,
  moneyLentLabel,
  onManageMoneyLent,
  onDelete,
}: TransactionDetailProps) {
  const theme = useTheme();
  if (!txn) return null;

  const confirmDelete = () => {
    Alert.alert(
      'Delete this transaction?',
      'It will be permanently removed from this device. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            onDelete?.();
            onClose();
          },
        },
      ],
    );
  };

  const dir = DIRECTION[txn.direction as keyof typeof DIRECTION] ?? DIRECTION.out;
  const title = txn.counterpartyName ?? txn.rawDetails ?? 'Transaction';
  const isTransfer = txn.direction === 'self' || txn.kind === 'received';
  const categoryText = categoryLabel ?? (isTransfer ? 'Not categorized (transfer)' : 'Uncategorized');
  const addedOn = (txn.createdAt ?? '').slice(0, 10);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SafeAreaView edges={['bottom']} style={styles.flexible}>
        {/* Header */}
        <View style={styles.header}>
          <ThemedText type="smallBold">Transaction</ThemedText>
          <Pressable onPress={onClose} hitSlop={8}>
            <ThemedText type="link" themeColor="textSecondary">
              Close
            </ThemedText>
          </Pressable>
        </View>

            <ScrollView style={styles.flexible} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
              {/* Amount + who */}
              <ThemedText type="subtitle" numberOfLines={2}>
                {title}
              </ThemedText>
              <ThemedText type="amountLarge" style={{ color: theme[dir.color] }}>
                {dir.sign} {formatINR(txn.paise)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {dir.label} · {txn.isoDate}
                {txn.time ? ` · ${txn.time}` : ''}
              </ThemedText>

              {/* Category (with status) */}
              <Section title="Category">
                <Field label="Category" value={categoryText} />
                <Field
                  label="Status"
                  value={
                    txn.needsReview
                      ? 'Needs review'
                      : txn.autoCategorized
                        ? 'Auto-categorized'
                        : txn.categoryId != null
                          ? 'Set by you'
                          : '—'
                  }
                />
                {txn.needsReview && onAccept && (
                  <Pressable
                    onPress={() => {
                      onAccept();
                      onClose();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Accept this category as correct"
                    style={({ pressed }) => [styles.acceptBtn, { borderColor: theme.income, opacity: pressed ? 0.6 : 1 }]}
                  >
                    <ThemedText type="smallBold" style={{ color: theme.income }}>
                      ✓ Looks right — accept
                    </ThemedText>
                  </Pressable>
                )}
                <Pressable
                  onPress={onChangeCategory}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.changeBtn,
                    { backgroundColor: theme.accent, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                    Change category
                  </ThemedText>
                </Pressable>
                {txn.categoryId != null && (
                  <Pressable
                    onPress={onRemoveCategory}
                    accessibilityRole="button"
                    hitSlop={8}
                    style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <ThemedText type="small" style={{ color: theme.spend }}>
                      Remove category
                    </ThemedText>
                  </Pressable>
                )}
              </Section>

              {/* What you wrote */}
              {(txn.remarks || txn.rawTag) && (
                <Section title="Your notes">
                  {txn.remarks ? (
                    <NoteField label="Remarks / note" value={txn.remarks} theme={theme} />
                  ) : null}
                  {txn.rawTag ? <Field label="Tag (from Paytm)" value={txn.rawTag} /> : null}
                </Section>
              )}

              {/* Money lent — one button to add to / manage in the Lent tab. */}
              {onManageMoneyLent && (
                <Section title="Money lent">
                  <Field label="Loan" value={moneyLentLabel ?? 'Not in Money Lent'} />
                  <Pressable
                    onPress={onManageMoneyLent}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.changeBtn, { backgroundColor: theme.accent, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                      {moneyLentLabel ? 'Manage in Money Lent' : 'Add to Money Lent'}
                    </ThemedText>
                  </Pressable>
                </Section>
              )}

              {/* Transaction details */}
              <Section title="Details">
                <Field label="Type" value={KIND_LABEL[txn.kind] ?? txn.kind} />
                {txn.counterpartyName ? (
                  <Field
                    label={txn.direction === 'in' ? 'Received from' : 'Paid to'}
                    value={txn.counterpartyName}
                  />
                ) : null}
                {txn.counterpartyVpa ? <Field label="UPI ID" value={txn.counterpartyVpa} /> : null}
                {txn.accountName ? <Field label="From account" value={txn.accountName} /> : null}
                {paymentModeName ? <Field label="Payment mode" value={paymentModeName} /> : null}
                {personName ? <Field label="For" value={personName} /> : null}
              </Section>

              {/* Record / provenance */}
              <Section title="Record">
                <Field label="Source" value={SOURCE_LABEL[txn.source] ?? txn.source} />
                {txn.sourceRef ? <Field label="UPI Ref No." value={txn.sourceRef} /> : null}
                {txn.orderId ? <Field label="Order ID" value={txn.orderId} /> : null}
                {txn.rawDetails ? <NoteField label="Original statement text" value={txn.rawDetails} theme={theme} /> : null}
                {addedOn ? <Field label="Added on" value={addedOn} /> : null}
              </Section>

              {onDelete && (
                <Pressable
                  onPress={confirmDelete}
                  accessibilityRole="button"
                  accessibilityLabel="Delete this transaction"
                  style={({ pressed }) => [styles.deleteBtn, { borderColor: theme.spend, opacity: pressed ? 0.6 : 1 }]}
                >
                  <ThemedText type="smallBold" style={{ color: theme.spend }}>
                    Delete transaction
                  </ThemedText>
                </Pressable>
              )}
            </ScrollView>
      </SafeAreaView>
    </BottomSheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="overline" themeColor="textSecondary" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </ThemedText>
      {children}
    </View>
  );
}

/** A one-line label → value row (value wraps if long). */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>
        {label}
      </ThemedText>
      <ThemedText type="small" style={styles.fieldValue}>
        {value}
      </ThemedText>
    </View>
  );
}

/** A highlighted block for free-text the user wrote (remarks) or the original wording. */
function NoteField({
  label,
  value,
  theme,
}: {
  label: string;
  value: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={styles.noteField}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={[styles.noteBox, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText type="default">{value}</ThemedText>
      </View>
    </View>
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
  body: { paddingBottom: Spacing.four, gap: Spacing.one },
  section: { marginTop: Spacing.three, gap: Spacing.one },
  sectionTitle: { marginBottom: Spacing.half },
  field: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.half },
  fieldLabel: { width: 130 },
  fieldValue: { flex: 1 },
  noteField: { gap: Spacing.half, paddingVertical: Spacing.half },
  noteBox: { borderRadius: Spacing.two, padding: Spacing.two },
  acceptBtn: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changeBtn: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtn: { marginTop: Spacing.one, paddingVertical: Spacing.one, alignItems: 'center' },
  deleteBtn: {
    marginTop: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    alignItems: 'center',
  },
});
