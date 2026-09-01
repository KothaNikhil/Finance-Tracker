import { SymbolView } from 'expo-symbols';
import type { ComponentProps, ReactNode } from 'react';
import { useState } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { IconButton } from '@/components/icon-button';
import { ThemedText } from '@/components/themed-text';
import {
  TransactionCountingActions,
  type MoneyLentSummary,
} from '@/components/transaction-counting-actions';
import { Opacity, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { TextRole } from '@/constants/typography';
import type { ImportRow, TransactionRow } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { firstText } from '@/core/domain/text';
import { useTheme } from '@/hooks/use-theme';

type SymbolName = ComponentProps<typeof SymbolView>['name'];
type Tab = 'overview' | 'details';

/** A label/value fact in the Details tab. `half` pairs into two columns; `block` wraps in full. */
interface DetailField {
  label: string;
  value: string;
  span?: 'half' | 'full' | 'block';
}

const DIRECTION = {
  out: { sign: '−', color: 'spend', label: 'Money out', detail: 'Outgoing' },
  in: { sign: '+', color: 'income', label: 'Money in', detail: 'Incoming' },
  self: { sign: '⇄', color: 'review', label: 'Between own accounts', detail: 'Self-transfer' },
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'details', label: 'Details' },
];

const LINK_HIT_SLOP = { top: 14, bottom: 14, left: 8, right: 8 };

export interface TransactionDetailProps {
  visible: boolean;
  txn: TransactionRow | null;
  /** Resolved "🍽️ Food & Dining · Restaurant", or null when uncategorized. */
  categoryLabel: string | null;
  paymentModeName: string | null;
  personName: string | null;
  /**
   * Person / loan identity for a lending row, resolved by the controller from the same sources the
   * Activity row uses. Only names a row that carries no merchant of its own.
   */
  lendingTitle?: string | null;
  /** Import batch that produced this row, retained as read-only statement provenance. */
  provenance: ImportRow | null;
  moneyLent: MoneyLentSummary | null;
  cardBillLinked: boolean;
  cardBillLabel: string | null;
  cardSpendCount: number;
  cardBillSuggestion: string | null;
  hasCardStatements: boolean;
  onClose: () => void;
  onChangeCategory: () => void;
  onRemoveCategory: () => void;
  onAccept?: () => void;
  onManageMoneyLent: () => void;
  onManageCardBill: () => void;
  onSaveNote?: (note: string, recategorize: boolean) => void;
  onRecategorize?: () => void;
  onSetRefund: (isRefund: boolean) => void;
  onSetSelfTransfer: (isSelf: boolean) => void;
  onDelete?: () => void;
}

export function TransactionDetail({
  visible,
  txn,
  categoryLabel,
  paymentModeName,
  personName,
  lendingTitle = null,
  provenance,
  moneyLent,
  cardBillLinked,
  cardBillLabel,
  cardSpendCount,
  cardBillSuggestion,
  hasCardStatements,
  onClose,
  onChangeCategory,
  onRemoveCategory,
  onAccept,
  onManageMoneyLent,
  onManageCardBill,
  onSaveNote,
  onRecategorize,
  onSetRefund,
  onSetSelfTransfer,
  onDelete,
}: TransactionDetailProps) {
  const theme = useTheme();
  const [tab, setTab] = useState<Tab>('overview');
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [recatOnSave, setRecatOnSave] = useState(true);
  const [seededId, setSeededId] = useState<number | null>(null);
  // Overview sets the sheet's height; Details then scrolls inside it instead of growing the sheet.
  const [overviewHeight, setOverviewHeight] = useState<number | null>(null);

  const txnId = txn?.id ?? null;
  const savedNote = txn?.note ?? '';
  if (!visible) {
    if (seededId !== null) setSeededId(null);
  } else if (txnId != null && txnId !== seededId) {
    setSeededId(txnId);
    setTab('overview');
    setEditingNote(false);
    setNoteText(savedNote);
    setRecatOnSave(true);
    setOverviewHeight(null);
  }

  if (!txn) return null;

  const dir = DIRECTION[txn.direction as keyof typeof DIRECTION] ?? DIRECTION.out;
  const title = transactionTitle(txn, lendingTitle);
  const categoryText = categoryLabel ?? (txn.direction === 'self' ? 'Not categorized (transfer)' : 'Uncategorized');
  const category = splitCategoryLabel(categoryText);
  const categoryStatus = txn.needsReview
    ? 'Needs review'
    : txn.autoCategorized
      ? 'Auto-categorized'
      : txn.categoryId != null
        ? 'Set by you'
        : 'Not categorized';
  const categoryStatusColor = txn.needsReview ? theme.review : theme.textSecondary;
  const metaLine = [
    dir.label,
    formatDisplayDate(txn.isoDate),
    txn.time ? formatDisplayTime(txn.time) : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  const confirmDelete = () => {
    Alert.alert(
      'Delete this transaction?',
      `${title} · ${dir.sign}${formatINR(txn.paise)} · ${formatDisplayDate(txn.isoDate)}\n\nThe full record and its loan or card-statement link will be permanently removed from this device. This can’t be undone.`,
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

  const startNoteEdit = () => {
    setNoteText(txn.note ?? '');
    setRecatOnSave(true);
    setEditingNote(true);
  };

  const cancelNoteEdit = () => {
    Keyboard.dismiss();
    setNoteText(txn.note ?? '');
    setEditingNote(false);
  };

  const saveNote = () => {
    Keyboard.dismiss();
    onSaveNote?.(noteText, recatOnSave);
    setEditingNote(false);
  };

  const noteRows: ReactNode[] = [];
  if (txn.note) {
    noteRows.push(
      <NoteValueRow
        key="note"
        label="Note"
        value={txn.note}
        onEdit={onSaveNote ? startNoteEdit : undefined}
      />,
    );
  } else if (onSaveNote) {
    noteRows.push(<AddNoteRow key="add-note" onPress={startNoteEdit} />);
  }
  if (txn.remarks) {
    noteRows.push(<NoteValueRow key="remarks" label="Imported remarks" value={txn.remarks} readOnly />);
  }

  const counterpartyLabel =
    txn.direction === 'in' ? 'Received from' : txn.direction === 'out' ? 'Paid to' : 'Counterparty';
  const transactionFields: DetailField[] = [
    { label: 'Direction', value: dir.detail },
    { label: 'Amount', value: `${dir.sign}${formatINR(txn.paise)}` },
    { label: 'Date', value: formatDisplayDate(txn.isoDate) },
    ...(txn.time ? [{ label: 'Time', value: formatDisplayTime(txn.time) }] : []),
    { label: 'Type', value: KIND_LABEL[txn.kind] ?? txn.kind, span: 'full' as const },
    ...(txn.counterpartyName
      ? [{ label: counterpartyLabel, value: txn.counterpartyName, span: 'full' as const }]
      : []),
    ...(txn.counterpartyVpa ? [{ label: 'UPI ID', value: txn.counterpartyVpa, span: 'full' as const }] : []),
    ...(txn.accountName ? [{ label: 'Account', value: txn.accountName, span: 'full' as const }] : []),
    { label: 'Category', value: categoryText, span: 'full' as const },
    ...(paymentModeName ? [{ label: 'Payment mode', value: `${paymentModeName} · Display only` }] : []),
    ...(personName ? [{ label: 'For', value: `${personName} · Display only` }] : []),
  ];

  const provenanceFields: DetailField[] = [
    { label: 'Source', value: SOURCE_LABEL[txn.source] ?? txn.source, span: 'full' },
    ...(provenance
      ? [
          {
            label: 'Imported from',
            value: provenance.sourceLabel.trim() || 'Imported statement',
            span: 'full' as const,
          },
          { label: 'Imported on', value: provenance.importedAt, span: 'full' as const },
          { label: 'Import batch', value: `#${provenance.id}` },
          ...(provenance.statementMonth
            ? [{ label: 'Statement period', value: formatStatementMonth(provenance.statementMonth) }]
            : []),
          ...(provenance.cardLast4 ? [{ label: 'Card ending', value: provenance.cardLast4 }] : []),
        ]
      : []),
    ...(txn.sourceRef ? [{ label: 'UPI reference', value: txn.sourceRef, span: 'full' as const }] : []),
    ...(txn.orderId ? [{ label: 'Order ID', value: txn.orderId, span: 'full' as const }] : []),
    ...(txn.accountName ? [{ label: 'Account', value: txn.accountName, span: 'full' as const }] : []),
    ...(txn.rawTag ? [{ label: 'Raw Paytm tag', value: txn.rawTag, span: 'full' as const }] : []),
    ...(txn.remarks ? [{ label: 'Imported remarks', value: txn.remarks, span: 'block' as const }] : []),
    { label: 'Original statement text', value: txn.rawDetails || 'Not provided', span: 'block' },
    { label: 'Added to app', value: txn.createdAt, span: 'full' },
    { label: 'Record ID', value: `#${txn.id}` },
  ];

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <View style={styles.topBar}>
          <ThemedText type="overline" themeColor="textSecondary">
            TRANSACTION
          </ThemedText>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Done, close transaction details"
            hitSlop={LINK_HIT_SLOP}
            style={({ pressed }) => [styles.doneButton, { opacity: pressed ? Opacity.pressed : 1 }]}
          >
            <ThemedText type="link" style={{ color: theme.accent }}>
              Done
            </ThemedText>
          </Pressable>
        </View>

        <View style={styles.header}>
          <View style={styles.titleRow}>
            <View style={[styles.titleBadge, { backgroundColor: theme.accentMuted }]}>
              <SymbolView name={transactionIcon(txn)} size={15} tintColor={theme.accent} />
            </View>
            <ThemedText type="heading" numberOfLines={1} style={styles.grow}>
              {title}
            </ThemedText>
            <ThemedText
              type="amount"
              numberOfLines={1}
              style={[styles.headerAmount, { color: theme[dir.color] }]}
            >
              {dir.sign}
              {formatINR(txn.paise)}
            </ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {metaLine}
          </ThemedText>
        </View>

        <View
          accessibilityRole="tablist"
          accessibilityLabel="Transaction detail section"
          style={[styles.tabs, { borderBottomColor: theme.border }]}
        >
          {TABS.map((option) => {
            const selected = option.value === tab;
            return (
              <Pressable
                key={option.value}
                onPress={() => setTab(option.value)}
                accessibilityRole="tab"
                accessibilityLabel={option.label}
                accessibilityState={{ selected }}
                hitSlop={{ top: 8, bottom: 8 }}
                style={({ pressed }) => [
                  styles.tab,
                  { borderBottomColor: selected ? theme.accent : 'transparent' },
                  { opacity: pressed && !selected ? Opacity.pressed : 1 },
                ]}
              >
                <ThemedText
                  type="smallEmphasis"
                  style={{ color: selected ? theme.accent : theme.textSecondary }}
                >
                  {option.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <ScrollView
          style={[styles.scroll, overviewHeight != null ? { height: overviewHeight } : null]}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={(_width, height) => {
            if (tab === 'overview' && height > 0 && Math.abs(height - (overviewHeight ?? 0)) > 1) {
              setOverviewHeight(height);
            }
          }}
        >
          {tab === 'overview' ? (
            <>
              <Section title="Category">
                <View>
                  <View style={styles.categoryRow}>
                    <Pressable
                      onPress={onChangeCategory}
                      accessibilityRole="button"
                      accessibilityLabel={`Category: ${categoryText}`}
                      accessibilityHint="Choose a category or create a new category or subcategory"
                      style={({ pressed }) => [
                        styles.categoryTap,
                        { opacity: pressed ? Opacity.pressed : 1 },
                      ]}
                    >
                      <View style={[styles.rowBadge, { backgroundColor: theme.backgroundSelected }]}>
                        {category.glyph ? (
                          <ThemedText type="small">{category.glyph}</ThemedText>
                        ) : (
                          <SymbolView
                            name={{ ios: 'tag', android: 'sell', web: 'sell' }}
                            size={14}
                            tintColor={theme.textSecondary}
                          />
                        )}
                      </View>
                      <View style={styles.grow}>
                        <ThemedText type="label" numberOfLines={1}>
                          {category.text}
                        </ThemedText>
                        <View style={styles.statusLine}>
                          {txn.needsReview ? (
                            <SymbolView
                              name={{ ios: 'exclamationmark.circle.fill', android: 'warning', web: 'warning' }}
                              size={13}
                              tintColor={theme.review}
                            />
                          ) : null}
                          <ThemedText type="small" style={{ color: categoryStatusColor }}>
                            {categoryStatus}
                          </ThemedText>
                        </View>
                      </View>
                      <SymbolView
                        name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                        size={14}
                        tintColor={theme.textSecondary}
                      />
                    </Pressable>
                    {txn.categoryId != null ? (
                      <TextAction
                        label="Remove"
                        accessibilityLabel="Remove category"
                        accessibilityHint="Returns this transaction to uncategorized"
                        color={theme.spend}
                        onPress={onRemoveCategory}
                      />
                    ) : null}
                    {onRecategorize ? (
                      <IconButton
                        name={{ ios: 'arrow.triangle.2.circlepath', android: 'refresh', web: 'refresh' }}
                        label="Re-categorize"
                        accessibilityHint="Runs categorization again using learned rules and this note"
                        onPress={onRecategorize}
                      />
                    ) : null}
                  </View>

                  {txn.needsReview && onAccept ? (
                    <View style={[styles.reviewLine, { borderTopColor: theme.border }]}>
                      <Button
                        label="Looks right"
                        variant="ghost"
                        size="small"
                        onPress={onAccept}
                        accessibilityHint="Accepts this category and clears its review status"
                        icon={{ ios: 'checkmark', android: 'check', web: 'check' }}
                      />
                    </View>
                  ) : null}
                </View>
              </Section>

              <Section title="How it’s counted">
                <TransactionCountingActions
                  direction={txn.direction}
                  isRefund={txn.isRefund}
                  moneyLent={moneyLent}
                  cardBillLinked={cardBillLinked}
                  cardBillLabel={
                    cardBillLinked && cardSpendCount > 0
                      ? `${cardBillLabel ?? 'card statement'} · ${cardSpendCount} item${cardSpendCount === 1 ? '' : 's'}`
                      : cardBillLabel
                  }
                  cardBillSuggestion={cardBillSuggestion}
                  hasCardStatements={hasCardStatements}
                  onSetSelfTransfer={onSetSelfTransfer}
                  onSetRefund={onSetRefund}
                  onManageMoneyLent={onManageMoneyLent}
                  onManageCardBill={onManageCardBill}
                />
              </Section>

              {editingNote || noteRows.length > 0 ? (
                <Section title="Notes">
                  {editingNote ? (
                    <View style={styles.noteEditor}>
                      <TextInput
                        value={noteText}
                        onChangeText={setNoteText}
                        placeholder="Add a note, such as what you bought"
                        placeholderTextColor={theme.textSecondary}
                        multiline
                        autoFocus
                        accessibilityLabel="Transaction note"
                        style={[
                          styles.noteInput,
                          {
                            color: theme.text,
                            backgroundColor: theme.background,
                            borderColor: theme.borderStrong,
                          },
                        ]}
                      />
                      <Pressable
                        onPress={() => setRecatOnSave((value) => !value)}
                        accessibilityRole="checkbox"
                        accessibilityLabel="Re-categorize using this note"
                        accessibilityState={{ checked: recatOnSave }}
                        hitSlop={{ top: 8, bottom: 8 }}
                        style={({ pressed }) => [
                          styles.checkboxRow,
                          { opacity: pressed ? Opacity.pressed : 1 },
                        ]}
                      >
                        <View
                          style={[
                            styles.checkbox,
                            {
                              backgroundColor: recatOnSave ? theme.accent : 'transparent',
                              borderColor: recatOnSave ? theme.accent : theme.borderStrong,
                            },
                          ]}
                        >
                          {recatOnSave ? (
                            <SymbolView
                              name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                              size={13}
                              tintColor={theme.onAccent}
                            />
                          ) : null}
                        </View>
                        <ThemedText type="small" style={styles.grow}>
                          Re-categorize using this note
                        </ThemedText>
                      </Pressable>
                      <View style={styles.noteActions}>
                        <Button
                          label="Cancel"
                          variant="secondary"
                          size="small"
                          onPress={cancelNoteEdit}
                          style={styles.grow}
                        />
                        <Button
                          label="Save note"
                          variant="primary"
                          size="small"
                          onPress={saveNote}
                          style={styles.grow}
                        />
                      </View>
                    </View>
                  ) : (
                    <View>
                      {noteRows.map((row, index) => (
                        <View
                          key={`note-row-${index}`}
                          style={
                            index > 0
                              ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }
                              : null
                          }
                        >
                          {row}
                        </View>
                      ))}
                    </View>
                  )}
                </Section>
              ) : null}

              <View style={[styles.linkGroup, { borderTopColor: theme.border }]}>
                <Pressable
                  onPress={() => setTab('details')}
                  accessibilityRole="button"
                  accessibilityLabel="Open full statement and transaction details"
                  style={({ pressed }) => [
                    styles.linkRow,
                    styles.flushRow,
                    { opacity: pressed ? Opacity.pressed : 1 },
                  ]}
                >
                  <SymbolView
                    name={{ ios: 'doc.text', android: 'description', web: 'description' }}
                    size={15}
                    tintColor={theme.accent}
                  />
                  <View style={styles.grow}>
                    <ThemedText type={TextRole.rowTitle}>Statement details</ThemedText>
                    <ThemedText
                      type={TextRole.rowSecondary}
                      themeColor="textSecondary"
                      numberOfLines={1}
                    >
                      {statementSummary(txn, provenance)}
                    </ThemedText>
                  </View>
                  <SymbolView
                    name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                    size={15}
                    tintColor={theme.textSecondary}
                  />
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Section title="Transaction">
                <View>
                  <DetailList fields={transactionFields} />
                </View>
                {paymentModeName || personName ? (
                  <ThemedText type="caption" themeColor="textSecondary">
                    Payment mode and For are statement reference fields and cannot be edited here.
                  </ThemedText>
                ) : null}
              </Section>

              <Section title="Provenance">
                <View>
                  <DetailList fields={provenanceFields} />
                </View>
              </Section>

              {cardBillLinked && cardBillLabel ? (
                <Section title="Card bill">
                  <Card padding="none" tone="accent">
                    <Pressable
                      onPress={onManageCardBill}
                      accessibilityRole="button"
                      accessibilityLabel={`Open linked card bill ${cardBillLabel}`}
                      style={({ pressed }) => [styles.linkRow, { opacity: pressed ? Opacity.pressed : 1 }]}
                    >
                      <View style={styles.grow}>
                        <ThemedText type={TextRole.rowTitle} numberOfLines={1}>
                          {cardBillLabel}
                        </ThemedText>
                        <ThemedText type={TextRole.rowSecondary} themeColor="textSecondary">
                          {cardSpendCount} statement item{cardSpendCount === 1 ? '' : 's'} · Bill payment
                          excluded; purchases remain expenses.
                        </ThemedText>
                      </View>
                      <SymbolView
                        name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                        size={15}
                        tintColor={theme.accent}
                      />
                    </Pressable>
                  </Card>
                </Section>
              ) : null}

              {moneyLent ? (
                <Section title="Money Lent">
                  <Card padding="none" tone="accent">
                    <Pressable
                      onPress={onManageMoneyLent}
                      accessibilityRole="button"
                      accessibilityLabel={`Manage Money Lent: ${moneyLent.label}`}
                      style={({ pressed }) => [styles.linkRow, { opacity: pressed ? Opacity.pressed : 1 }]}
                    >
                      <View style={styles.grow}>
                        <ThemedText type={TextRole.rowTitle}>{moneyLent.label}</ThemedText>
                        {moneyLent.detailLines.map((line, index) => (
                          <ThemedText
                            key={`${line}-${index}`}
                            type={TextRole.rowSecondary}
                            themeColor="textSecondary"
                          >
                            {line}
                          </ThemedText>
                        ))}
                      </View>
                      <SymbolView
                        name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                        size={15}
                        tintColor={theme.accent}
                      />
                    </Pressable>
                  </Card>
                </Section>
              ) : null}

              {onDelete ? (
                <Button
                  label="Delete transaction"
                  variant="danger"
                  size="small"
                  onPress={confirmDelete}
                  accessibilityHint="Opens a permanent deletion confirmation"
                  icon={{ ios: 'trash', android: 'delete', web: 'delete' }}
                  style={styles.deleteButton}
                />
              ) : null}
            </>
          )}

          <View style={styles.autoSave}>
            <SymbolView
              name={{ ios: 'lock', android: 'lock', web: 'lock' }}
              size={12}
              tintColor={theme.textSecondary}
            />
            <ThemedText type="caption" themeColor="textSecondary">
              Changes save automatically
            </ThemedText>
          </View>
        </ScrollView>
      </SafeAreaView>
    </BottomSheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="overline" themeColor="textSecondary">
        {title.toUpperCase()}
      </ThemedText>
      {children}
    </View>
  );
}

/**
 * A trailing text control that owns a full-height touch box, so it never depends on `hitSlop`
 * reaching outside a parent pressable — Android clips a child's touch area to its parent.
 */
function TextAction({
  label,
  accessibilityLabel,
  accessibilityHint,
  color,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  accessibilityHint: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      hitSlop={{ left: 6, right: 6 }}
      style={({ pressed }) => [styles.textAction, { opacity: pressed ? Opacity.pressed : 1 }]}
    >
      <ThemedText type="smallEmphasis" style={{ color }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function AddNoteRow({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Add note"
      accessibilityHint="Opens the note editor with optional re-categorization"
      style={({ pressed }) => [styles.addNoteRow, { opacity: pressed ? Opacity.pressed : 1 }]}
    >
      <SymbolView
        name={{ ios: 'square.and.pencil', android: 'edit', web: 'edit' }}
        size={15}
        tintColor={theme.accent}
      />
      <ThemedText type="smallEmphasis" style={{ color: theme.accent }}>
        Add note
      </ThemedText>
    </Pressable>
  );
}

function NoteValueRow({
  label,
  value,
  readOnly = false,
  onEdit,
}: {
  label: string;
  value: string;
  readOnly?: boolean;
  onEdit?: () => void;
}) {
  const theme = useTheme();
  const body = (
    <View style={styles.noteRow}>
      <View style={styles.grow}>
        <View style={styles.noteLabelRow}>
          <ThemedText type="caption" themeColor="textSecondary">
            {label}
          </ThemedText>
          {readOnly ? (
            <ThemedText type="caption" themeColor="textSecondary">
              Read-only
            </ThemedText>
          ) : null}
        </View>
        <ThemedText type="small" numberOfLines={3} selectable>
          {value}
        </ThemedText>
      </View>
      {onEdit ? (
        <SymbolView
          name={{ ios: 'square.and.pencil', android: 'edit', web: 'edit' }}
          size={15}
          tintColor={theme.accent}
        />
      ) : null}
    </View>
  );

  if (!onEdit) return body;

  return (
    <Pressable
      onPress={onEdit}
      accessibilityRole="button"
      accessibilityLabel="Edit note"
      accessibilityHint="Opens the note editor with optional re-categorization"
      style={({ pressed }) => ({ opacity: pressed ? Opacity.pressed : 1 })}
    >
      {body}
    </Pressable>
  );
}

/** Groups short facts into two columns and keeps long ones full width, on hairline-split rows. */
function DetailList({ fields }: { fields: DetailField[] }) {
  const theme = useTheme();
  const rows: DetailField[][] = [];
  fields.forEach((field) => {
    const previous = rows[rows.length - 1];
    if (
      (field.span ?? 'half') === 'half' &&
      previous != null &&
      previous.length === 1 &&
      (previous[0].span ?? 'half') === 'half'
    ) {
      previous.push(field);
    } else {
      rows.push([field]);
    }
  });

  return (
    <>
      {rows.map((row, index) => (
        <View
          key={`${row[0].label}-${index}`}
          style={[
            styles.detailRow,
            index < rows.length - 1
              ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }
              : null,
          ]}
        >
          {row.length === 2 ? (
            <>
              <DetailCell field={row[0]} />
              <View style={[styles.cellDivider, { backgroundColor: theme.border }]} />
              <DetailCell field={row[1]} />
            </>
          ) : row[0].span === 'block' ? (
            <View style={styles.grow}>
              <ThemedText type="small" themeColor="textSecondary">
                {row[0].label}
              </ThemedText>
              <ThemedText type="small" selectable>
                {row[0].value}
              </ThemedText>
            </View>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.detailLabel}>
                {row[0].label}
              </ThemedText>
              <ThemedText
                type="small"
                numberOfLines={2}
                selectable
                style={[styles.detailValue, styles.figure]}
              >
                {row[0].value}
              </ThemedText>
            </>
          )}
        </View>
      ))}
    </>
  );
}

function DetailCell({ field }: { field: DetailField }) {
  return (
    <View style={styles.detailCell}>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {field.label}
      </ThemedText>
      <ThemedText type="small" numberOfLines={1} selectable style={styles.figure}>
        {field.value}
      </ThemedText>
    </View>
  );
}

function transactionTitle(txn: TransactionRow, lendingTitle: string | null): string {
  if (txn.direction === 'self' && !txn.counterpartyName) return 'Transfer to own account';
  return firstText(txn.counterpartyName, txn.rawDetails, lendingTitle) ?? 'Transaction';
}

function transactionIcon(txn: TransactionRow): SymbolName {
  if (txn.linkedImportId != null || txn.transferRole === 'cc_payment') {
    return { ios: 'creditcard', android: 'credit_card', web: 'credit_card' };
  }
  if (txn.direction === 'self') {
    return { ios: 'arrow.left.arrow.right', android: 'swap_horiz', web: 'swap_horiz' };
  }
  if (txn.direction === 'in') {
    return { ios: 'arrow.down.left', android: 'south_west', web: 'south_west' };
  }
  return { ios: 'arrow.up.right', android: 'north_east', web: 'north_east' };
}

/** Peels the leading emoji off "🍽️ Food & Dining · Restaurant" so it can render as a badge. */
function splitCategoryLabel(label: string): { glyph: string | null; text: string } {
  const match = /^(\S+)\s+(\S.*)$/.exec(label);
  if (!match) return { glyph: null, text: label };
  const [, lead, rest] = match;
  return (lead.codePointAt(0) ?? 0) > 0x2000 ? { glyph: lead, text: rest } : { glyph: null, text: label };
}

function formatDisplayDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : isoDate;
}

function formatDisplayTime(time: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hour = Number(match[1]);
  if (!Number.isFinite(hour) || hour > 23) return time;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${match[2]} ${suffix}`;
}

function formatStatementMonth(statementMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(statementMonth);
  if (!match) return statementMonth;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : statementMonth;
}

function statementSummary(txn: TransactionRow, provenance: ImportRow | null): string {
  const parts = [
    provenance?.sourceLabel.trim() || SOURCE_LABEL[txn.source] || txn.source,
    txn.sourceRef ? 'UPI reference' : null,
    txn.accountName ? 'account' : null,
    txn.rawDetails ? 'original text' : null,
  ].filter((part): part is string => Boolean(part));
  return parts.join(', ') || 'Source and record metadata';
}

const styles = StyleSheet.create({
  // The sheet is content-sized, so the body shrinks to fit rather than growing from a zero basis.
  safeArea: { flexShrink: 1 },
  topBar: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  doneButton: { minHeight: 24, justifyContent: 'center' },
  header: { gap: Spacing.half, paddingTop: Spacing.one },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  // The amount is the sheet's headline figure: it keeps its intrinsic width and the name truncates.
  headerAmount: { flexShrink: 0, flexGrow: 0 },
  titleBadge: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: {
    flexDirection: 'row',
    marginTop: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    marginBottom: -StyleSheet.hairlineWidth,
  },
  scroll: { flexShrink: 1, marginTop: Spacing.two },
  body: { gap: Spacing.two, paddingBottom: Spacing.three },
  grow: { flex: 1, minWidth: 0 },
  section: { gap: Spacing.one },
  categoryRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  categoryTap: {
    minHeight: TouchTarget,
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  textAction: { minHeight: TouchTarget, justifyContent: 'center' },
  reviewLine: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingBottom: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowBadge: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.one },
  noteEditor: { gap: Spacing.two, paddingVertical: Spacing.one },
  noteInput: {
    minHeight: 64,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 14,
    lineHeight: 19,
    textAlignVertical: 'top',
  },
  checkboxRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: Radius.xs,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteActions: { flexDirection: 'row', gap: Spacing.two },
  addNoteRow: {
    minHeight: TouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  noteRow: {
    minHeight: TouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  noteLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  linkRow: {
    minHeight: TouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  detailRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  detailCell: { flex: 1, minWidth: 0 },
  cellDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  detailLabel: { width: 96 },
  detailValue: { flex: 1, minWidth: 0, textAlign: 'right' },
  figure: { fontVariant: ['tabular-nums'] },
  linkGroup: { borderTopWidth: StyleSheet.hairlineWidth },
  flushRow: { paddingHorizontal: 0 },
  deleteButton: { marginTop: Spacing.one },
  autoSave: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
});
