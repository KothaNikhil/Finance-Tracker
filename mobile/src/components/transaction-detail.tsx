/**
 * The detail sheet for one transaction, organised into two tabs to keep it short:
 *  - OVERVIEW — the things you act on: category (change / re-categorize), how the row is counted
 *    (self-transfer, refund, money lent, card bill) as a compact chip row, and your note.
 *  - DETAILS — read-only provenance (counterparty, account, statement text, record) plus Delete.
 *
 * The amount + who is shown above the tabs so it stays in view on both.
 */

import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Chip } from '@/components/chip';
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
  /** Linked credit-card statement label (e.g. "Axis …CC ••4723 · Jun 2026"), or null when unlinked. */
  cardBillLabel?: string | null;
  /** How many card spends the linked statement itemises (shown when linked). */
  cardSpendCount?: number;
  /** A hint when unlinked but a matching statement exists (e.g. "Matches Axis …CC · Jun 2026"). */
  cardBillSuggestion?: string | null;
  /** Open the credit-card-bill flow (view linked spends, or pick a statement to link). */
  onManageCardBill?: () => void;
  /** Save (or clear) the user's hand-typed note; `recategorize` re-runs auto-categorization after. */
  onSaveNote?: (note: string, recategorize: boolean) => void;
  /** Re-run auto-categorization on this row using everything learned so far. */
  onRecategorize?: () => void;
  /** Set/clear the refund flag (a refund is money-in subtracted from Spent, not counted as income). */
  onSetRefund?: (isRefund: boolean) => void;
  /** Mark this row as a self-transfer (between own accounts, excluded from totals) or undo it. */
  onSetSelfTransfer?: (isSelf: boolean) => void;
  /** Delete this transaction entirely. When provided, a "Delete transaction" action is shown. */
  onDelete?: () => void;
}

type Tab = 'overview' | 'details';

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
  cardBillLabel,
  cardSpendCount,
  cardBillSuggestion,
  onManageCardBill,
  onSaveNote,
  onRecategorize,
  onSetRefund,
  onSetSelfTransfer,
  onDelete,
}: TransactionDetailProps) {
  const theme = useTheme();

  // Per-open UI state. Re-seeded from the current row whenever a different transaction opens, and
  // reset when the sheet closes so reopening always starts on Overview with a clean, non-editing view.
  const [tab, setTab] = useState<Tab>('overview');
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [recatOnSave, setRecatOnSave] = useState(true);
  const [seededId, setSeededId] = useState<number | null>(null);
  if (!visible) {
    if (seededId !== null) setSeededId(null);
  } else if (txn && txn.id !== seededId) {
    setSeededId(txn.id);
    setTab('overview');
    setEditingNote(false);
    setNoteText(txn.note ?? '');
    setRecatOnSave(true);
  }

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
  const statusText = txn.needsReview
    ? 'Needs review'
    : txn.autoCategorized
      ? 'Auto-categorized'
      : txn.categoryId != null
        ? 'Set by you'
        : 'Uncategorized';
  const addedOn = (txn.createdAt ?? '').slice(0, 10);

  const isSelf = txn.direction === 'self';

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

        {/* Amount + who — always in view, above the tabs */}
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

        {/* Tabs */}
        <View style={[styles.tabBar, { borderBottomColor: theme.border }]}>
          <TabButton label="Overview" active={tab === 'overview'} onPress={() => setTab('overview')} theme={theme} />
          <TabButton label="Details" active={tab === 'details'} onPress={() => setTab('details')} theme={theme} />
        </View>

        <ScrollView style={styles.flexible} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {tab === 'overview' ? (
            <>
              {/* Category — one primary action + a compact re-categorize icon. */}
              <Section title="Category">
                <View style={styles.catHead}>
                  <ThemedText type="default" style={styles.flexShrink}>
                    {categoryText}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {statusText}
                  </ThemedText>
                </View>
                <View style={styles.actionRow}>
                  <Pressable
                    onPress={onChangeCategory}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.primaryBtn, { backgroundColor: theme.accent, opacity: pressed ? 0.7 : 1 }]}
                  >
                    <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                      Change category
                    </ThemedText>
                  </Pressable>
                  {onRecategorize && (
                    <Pressable
                      onPress={onRecategorize}
                      accessibilityRole="button"
                      accessibilityLabel="Re-categorize using everything learned so far"
                      style={({ pressed }) => [styles.iconBtn, { borderColor: theme.accent, opacity: pressed ? 0.6 : 1 }]}
                    >
                      <ThemedText type="smallBold" style={{ color: theme.accent }}>
                        ↻
                      </ThemedText>
                    </Pressable>
                  )}
                </View>
                <View style={styles.linkRow}>
                  {txn.needsReview && onAccept && (
                    <Pressable
                      onPress={() => {
                        onAccept();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Accept this category as correct"
                      hitSlop={8}
                    >
                      <ThemedText type="small" style={{ color: theme.income }}>
                        ✓ Looks right
                      </ThemedText>
                    </Pressable>
                  )}
                  {txn.categoryId != null && (
                    <Pressable onPress={onRemoveCategory} accessibilityRole="button" hitSlop={8}>
                      <ThemedText type="small" style={{ color: theme.spend }}>
                        Remove category
                      </ThemedText>
                    </Pressable>
                  )}
                </View>
              </Section>

              {/* How it's counted — compact chips. Self-transfer / Refund toggle directly; Money lent /
                  Card bill open their own flow. Selected = the row is currently counted that way. */}
              <Section title="How it's counted">
                <View style={styles.chips}>
                  {onSetSelfTransfer && (
                    <Chip label="⇄ Self-transfer" selected={isSelf} onPress={() => onSetSelfTransfer(!isSelf)} />
                  )}
                  {!isSelf && txn.direction === 'in' && onSetRefund && (
                    <Chip label="↩ Refund" selected={txn.isRefund} onPress={() => onSetRefund(!txn.isRefund)} />
                  )}
                  {onManageMoneyLent && (
                    <Chip label="💸 Money lent" selected={!!moneyLentLabel} onPress={onManageMoneyLent} />
                  )}
                  {onManageCardBill && (
                    <Chip label="💳 Card bill" selected={!!cardBillLabel} onPress={onManageCardBill} />
                  )}
                </View>
                {(isSelf || moneyLentLabel || cardBillLabel || cardBillSuggestion) && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.countedHint}>
                    {isSelf ? 'Self-transfer — excluded from totals. ' : ''}
                    {moneyLentLabel ? `In Money Lent: ${moneyLentLabel}. ` : ''}
                    {cardBillLabel
                      ? `Card bill: ${cardBillLabel}${cardSpendCount != null ? ` (${cardSpendCount} item${cardSpendCount === 1 ? '' : 's'})` : ''}.`
                      : cardBillSuggestion
                        ? `Matches ${cardBillSuggestion}.`
                        : ''}
                  </ThemedText>
                )}
              </Section>

              {/* Your note (editable) — plus imported remarks / tag for context. */}
              <Section title="Your notes">
                {editingNote ? (
                  <View style={styles.noteEditor}>
                    <TextInput
                      value={noteText}
                      onChangeText={setNoteText}
                      placeholder="Add a note (e.g. what you bought)…"
                      placeholderTextColor={theme.textSecondary}
                      multiline
                      autoFocus
                      style={[styles.noteInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                    />
                    <Pressable
                      onPress={() => setRecatOnSave((v) => !v)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: recatOnSave }}
                      style={({ pressed }) => [styles.checkboxRow, { opacity: pressed ? 0.6 : 1 }]}
                    >
                      <ThemedText type="default">{recatOnSave ? '☑' : '☐'}</ThemedText>
                      <ThemedText type="small">Re-categorize using this note</ThemedText>
                    </Pressable>
                    <View style={styles.noteActions}>
                      <Pressable onPress={() => setEditingNote(false)} accessibilityRole="button" hitSlop={8}>
                        <ThemedText type="small" themeColor="textSecondary">
                          Cancel
                        </ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          onSaveNote?.(noteText, recatOnSave);
                          setEditingNote(false);
                        }}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.saveNoteBtn, { backgroundColor: theme.accent, opacity: pressed ? 0.7 : 1 }]}
                      >
                        <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                          Save note
                        </ThemedText>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <>
                    {txn.note ? <NoteField label="Note" value={txn.note} theme={theme} /> : null}
                    {txn.remarks ? <NoteField label="Imported remarks" value={txn.remarks} theme={theme} /> : null}
                    {txn.rawTag ? <Field label="Tag (from Paytm)" value={txn.rawTag} /> : null}
                    {onSaveNote && (
                      <Pressable
                        onPress={() => {
                          setNoteText(txn.note ?? '');
                          setRecatOnSave(true);
                          setEditingNote(true);
                        }}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.recatBtn, { borderColor: theme.accent, opacity: pressed ? 0.6 : 1 }]}
                      >
                        <ThemedText type="smallBold" style={{ color: theme.accent }}>
                          {txn.note ? 'Edit note' : '＋ Add note'}
                        </ThemedText>
                      </Pressable>
                    )}
                  </>
                )}
              </Section>
            </>
          ) : (
            <>
              {/* Transaction details */}
              <Section title="Details">
                <Field label="Type" value={KIND_LABEL[txn.kind] ?? txn.kind} />
                {txn.counterpartyName ? (
                  <Field label={txn.direction === 'in' ? 'Received from' : 'Paid to'} value={txn.counterpartyName} />
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
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </BottomSheet>
  );
}

/** One tab in the sheet's segmented tab bar — an underline marks the active tab. */
function TabButton({
  label,
  active,
  onPress,
  theme,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[styles.tab, active && { borderBottomColor: theme.accent }]}
    >
      <ThemedText type="smallBold" themeColor={active ? 'text' : 'textSecondary'}>
        {label}
      </ThemedText>
    </Pressable>
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
  flexShrink: { flexShrink: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  tabBar: {
    flexDirection: 'row',
    marginTop: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  body: { paddingBottom: Spacing.four, gap: Spacing.one },
  section: { marginTop: Spacing.three, gap: Spacing.one },
  sectionTitle: { marginBottom: Spacing.half },
  catHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  actionRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  primaryBtn: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    width: 48,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkRow: { flexDirection: 'row', gap: Spacing.four, marginTop: Spacing.one },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  countedHint: { marginTop: Spacing.one },
  field: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.half },
  fieldLabel: { width: 130 },
  fieldValue: { flex: 1 },
  noteField: { gap: Spacing.half, paddingVertical: Spacing.half },
  noteBox: { borderRadius: Spacing.two, padding: Spacing.two },
  recatBtn: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteEditor: { gap: Spacing.two },
  noteInput: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.half },
  noteActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: Spacing.four },
  saveNoteBtn: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: {
    marginTop: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    alignItems: 'center',
  },
});
