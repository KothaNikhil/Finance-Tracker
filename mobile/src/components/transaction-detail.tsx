/**
 * A read-only detail sheet for one transaction: shows everything the app knows about it —
 * the amount, when it happened, how it was categorized, the counterparty, and (importantly)
 * any text the user wrote on it in Paytm (remarks, tag) plus the original statement wording.
 *
 * From here the user can jump to changing the category via `onChangeCategory`.
 */

import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { TransactionRow } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { useTheme } from '@/hooks/use-theme';

const DIRECTION = {
  out: { sign: '−', color: '#e5484d', label: 'Money out' },
  in: { sign: '+', color: '#30a46c', label: 'Money in' },
  self: { sign: '⇄', color: '#f5a524', label: 'Between own accounts' },
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
  onClose: () => void;
  onChangeCategory: () => void;
}

export function TransactionDetail({
  visible,
  txn,
  categoryLabel,
  paymentModeName,
  personName,
  onClose,
  onChangeCategory,
}: TransactionDetailProps) {
  const theme = useTheme();
  if (!txn) return null;

  const dir = DIRECTION[txn.direction as keyof typeof DIRECTION] ?? DIRECTION.out;
  const title = txn.counterpartyName ?? txn.rawDetails ?? 'Transaction';
  const isTransfer = txn.direction === 'self' || txn.kind === 'received';
  const categoryText = categoryLabel ?? (isTransfer ? 'Not categorized (transfer)' : 'Uncategorized');
  const addedOn = (txn.createdAt ?? '').slice(0, 10);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ThemedView style={styles.sheet}>
          <SafeAreaView edges={['bottom']}>
            {/* Header */}
            <View style={styles.header}>
              <ThemedText type="smallBold">Transaction</ThemedText>
              <Pressable onPress={onClose} hitSlop={8}>
                <ThemedText type="link" themeColor="textSecondary">
                  Close
                </ThemedText>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
              {/* Amount + who */}
              <ThemedText type="subtitle" numberOfLines={2}>
                {title}
              </ThemedText>
              <ThemedText type="title" style={{ color: dir.color, fontSize: 34, lineHeight: 40 }}>
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
                <Pressable
                  onPress={onChangeCategory}
                  style={({ pressed }) => [
                    styles.changeBtn,
                    { backgroundColor: '#3c87f7', opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <ThemedText type="smallBold" style={{ color: '#ffffff' }}>
                    Change category
                  </ThemedText>
                </Pressable>
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
            </ScrollView>
          </SafeAreaView>
        </ThemedView>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
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
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  body: { paddingBottom: Spacing.four, gap: Spacing.one },
  section: { marginTop: Spacing.three, gap: Spacing.one },
  sectionTitle: { fontSize: 12, letterSpacing: 0.5, marginBottom: Spacing.half },
  field: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.half },
  fieldLabel: { width: 130 },
  fieldValue: { flex: 1 },
  noteField: { gap: Spacing.half, paddingVertical: Spacing.half },
  noteBox: { borderRadius: Spacing.two, padding: Spacing.two },
  changeBtn: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
