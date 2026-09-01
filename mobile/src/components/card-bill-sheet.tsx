import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import {
  partitionCardStatements,
  reconcileCardBill,
  summarizeCardStatementActivity,
} from '@/components/card-bill-model';
import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Opacity, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { TextRole } from '@/constants/typography';
import type { ImportRow, TransactionRow } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { useTheme } from '@/hooks/use-theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PREVIEW_ITEM_COUNT = 6;

/** A compact, identifiable label for a card-statement import batch. */
export function cardStatementLabel(statement: ImportRow): string {
  const source = statement.sourceLabel
    .trim()
    .replace(/^.*[\\/]/, '')
    .replace(/\.(pdf|xlsx?)$/i, '');
  const card = source || 'Credit card';
  const ending = statement.cardLast4 ? ` · ••${statement.cardLast4}` : '';
  const match = /^(\d{4})-(\d{2})$/.exec(statement.statementMonth ?? '');
  const period =
    match && MONTHS[Number(match[2]) - 1] ? ` · ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : '';
  return `${card}${ending}${period}`;
}

export interface CardBillSheetProps {
  visible: boolean;
  /** Retained separately so a dangling link can still be inspected and unlinked. */
  linkedImportId: number | null;
  linkedStatement: ImportRow | null;
  /** Linked statement activity. Payment-received legs are filtered defensively before display. */
  items: TransactionRow[];
  statements: ImportRow[];
  /** Statement ids whose Total Payment Due matches this bank payment. */
  suggestedIds: number[];
  /** The linked bank payment, in paise, used for due-vs-payment reconciliation. */
  paymentPaise: number;
  onLink: (importId: number) => void;
  onUnlink: () => void;
  onPressSpend: (txnId: number) => void;
  onClose: () => void;
}

export function CardBillSheet({
  visible,
  linkedImportId,
  linkedStatement,
  items,
  statements,
  suggestedIds,
  paymentPaise,
  onLink,
  onUnlink,
  onPressSpend,
  onClose,
}: CardBillSheetProps) {
  const theme = useTheme();
  const [showAllItems, setShowAllItems] = useState(false);
  const [seededStatementId, setSeededStatementId] = useState<number | null>(null);

  const openSeed = visible ? (linkedImportId ?? -1) : null;
  if (openSeed !== seededStatementId) {
    setSeededStatementId(openSeed);
    if (openSeed != null) setShowAllItems(false);
  }

  const { suggested, others } = partitionCardStatements(statements, suggestedIds);
  const activity = summarizeCardStatementActivity(items);
  const reconciliation = reconcileCardBill(linkedStatement?.totalDuePaise ?? null, paymentPaise);
  const shownItems = showAllItems
    ? activity.items
    : activity.items.slice(0, PREVIEW_ITEM_COUNT);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText type="heading">Card bill</ThemedText>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close card bill"
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            style={({ pressed }) => [styles.closeButton, { opacity: pressed ? Opacity.pressed : 1 }]}
          >
            <ThemedText type="link" style={{ color: theme.accent }}>
              Close
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {linkedImportId != null ? (
            <>
              {linkedStatement ? (
                <StatementHeader statement={linkedStatement} />
              ) : (
                <Card tone="review" padding="small">
                  <ThemedText type="smallEmphasis">Linked statement is no longer available</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Import batch #{linkedImportId} could not be loaded. Unlink this payment to restore
                    normal counting, or link it to another statement afterward.
                  </ThemedText>
                </Card>
              )}

              <Section title="Reconciliation">
                <Card padding="none">
                  <View style={styles.reconciliationGrid}>
                    <ReconciliationValue
                      label="Statement due"
                      value={
                        reconciliation.statementDuePaise == null
                          ? 'Unavailable'
                          : formatINR(reconciliation.statementDuePaise)
                      }
                    />
                    <View style={[styles.verticalDivider, { backgroundColor: theme.border }]} />
                    <ReconciliationValue
                      label="Linked payment"
                      value={formatINR(reconciliation.linkedPaymentPaise)}
                    />
                    <View style={[styles.verticalDivider, { backgroundColor: theme.border }]} />
                    <ReconciliationValue
                      label="Difference"
                      value={formatDifference(reconciliation.differencePaise)}
                      color={
                        reconciliation.matched
                          ? theme.income
                          : reconciliation.differencePaise == null
                            ? theme.textSecondary
                            : theme.review
                      }
                    />
                  </View>

                  <View style={[styles.reconciliationStatus, { borderTopColor: theme.border }]}>
                    <SymbolView
                      name={
                        reconciliation.matched
                          ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }
                          : { ios: 'exclamationmark.circle.fill', android: 'warning', web: 'warning' }
                      }
                      size={14}
                      tintColor={reconciliation.matched ? theme.income : theme.review}
                    />
                    <ThemedText
                      type="smallEmphasis"
                      style={{ color: reconciliation.matched ? theme.income : theme.review }}
                    >
                      {reconciliationStatus(reconciliation.differencePaise)}
                    </ThemedText>
                  </View>

                  <View style={[styles.ruleCopy, { borderTopColor: theme.border }]}>
                    <ThemedText type="small" themeColor="textSecondary">
                      The linked bill-payment leg is excluded from spending and income. Statement
                      purchases remain real expenses; merchant refunds continue to offset spending.
                    </ThemedText>
                  </View>
                </Card>
              </Section>

              <Section title="Statement activity">
                <ThemedText type="small" themeColor="textSecondary">
                  {activity.purchaseCount} purchase{activity.purchaseCount === 1 ? '' : 's'} ·{' '}
                  {activity.refundCount} refund{activity.refundCount === 1 ? '' : 's'} · Itemised net{' '}
                  {formatINR(activity.netPaise)}
                </ThemedText>

                {activity.items.length === 0 ? (
                  <Card tone="subtle" padding="small">
                    <ThemedText type="smallEmphasis">No purchase or refund items</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Payment-received legs are transfers and are intentionally omitted.
                    </ThemedText>
                  </Card>
                ) : (
                  <View>
                    {shownItems.map((item, index) => (
                      <StatementItem
                        key={item.id}
                        item={item}
                        onPress={() => onPressSpend(item.id)}
                        border={index > 0}
                      />
                    ))}
                  </View>
                )}

                {activity.items.length > PREVIEW_ITEM_COUNT ? (
                  <Button
                    label={
                      showAllItems
                        ? 'Show fewer statement transactions'
                        : `View all ${activity.items.length} statement transactions`
                    }
                    variant="secondary"
                    size="small"
                    onPress={() => setShowAllItems((value) => !value)}
                    icon={{
                      ios: showAllItems ? 'chevron.up' : 'doc.text',
                      android: showAllItems ? 'expand_less' : 'description',
                      web: showAllItems ? 'expand_less' : 'description',
                    }}
                  />
                ) : null}
              </Section>

              <Button
                label="Unlink this statement"
                variant="danger"
                size="small"
                onPress={onUnlink}
                accessibilityHint="Restores this bank transaction to normal counting"
                icon={{ ios: 'link', android: 'link_off', web: 'link_off' }}
              />
            </>
          ) : (
            <>
              <Card tone="subtle" padding="small">
                <View style={styles.intro}>
                  <SymbolView
                    name={{ ios: 'creditcard', android: 'credit_card', web: 'credit_card' }}
                    size={15}
                    tintColor={theme.accent}
                    style={styles.introIcon}
                  />
                  <View style={styles.grow}>
                    <ThemedText type="smallEmphasis">Choose the statement this payment settled</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Linking excludes this bank payment from spending. The statement’s purchases
                      remain expenses.
                    </ThemedText>
                  </View>
                </View>
              </Card>

              {statements.length === 0 ? (
                <Card tone="subtle" padding="small">
                  <ThemedText type="smallEmphasis">No card statements available</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Import a supported credit-card statement from Import, then return here to link it.
                  </ThemedText>
                </Card>
              ) : (
                <>
                  {suggested.length > 0 ? (
                    <Section title="Suggested amount matches">
                      <ThemedText type="small" themeColor="textSecondary">
                        Total Payment Due matches {formatINR(paymentPaise)}.
                      </ThemedText>
                      <View>
                        {suggested.map((statement, index) => (
                          <StatementChoice
                            key={statement.id}
                            statement={statement}
                            suggested
                            border={index > 0}
                            onPress={() => onLink(statement.id)}
                          />
                        ))}
                      </View>
                    </Section>
                  ) : null}

                  {others.length > 0 ? (
                    <Section title={suggested.length > 0 ? 'All other statements' : 'All statements'}>
                      <View>
                        {others.map((statement, index) => (
                          <StatementChoice
                            key={statement.id}
                            statement={statement}
                            border={index > 0}
                            onPress={() => onLink(statement.id)}
                          />
                        ))}
                      </View>
                    </Section>
                  ) : null}

                  {suggested.length > 0 && others.length === 0 ? (
                    <ThemedText type="caption" themeColor="textSecondary" style={styles.centerText}>
                      All imported card statements are shown above.
                    </ThemedText>
                  ) : null}
                </>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </BottomSheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="overline" themeColor="textSecondary">
        {title.toUpperCase()}
      </ThemedText>
      {children}
    </View>
  );
}

function StatementHeader({ statement }: { statement: ImportRow }) {
  const theme = useTheme();
  return (
    <View style={[styles.statementHeaderGroup, { borderBottomColor: theme.border }]}>
      <View style={styles.statementHeader}>
        <View style={[styles.badge, { backgroundColor: theme.spendMuted }]}>
          <SymbolView
            name={{ ios: 'creditcard', android: 'credit_card', web: 'credit_card' }}
            size={15}
            tintColor={theme.spend}
          />
        </View>
        <View style={styles.grow}>
          <ThemedText type={TextRole.rowTitle} numberOfLines={1}>
            {cardStatementLabel(statement)}
          </ThemedText>
          <ThemedText type={TextRole.rowSecondary} themeColor="textSecondary" numberOfLines={1}>
            {statement.cardLast4 ? `Card ending ${statement.cardLast4}` : 'Imported card statement'}
          </ThemedText>
        </View>
        <View style={[styles.linkedBadge, { backgroundColor: theme.accentMuted }]}>
          <SymbolView name={{ ios: 'link', android: 'link', web: 'link' }} size={11} tintColor={theme.accent} />
          <ThemedText type="caption" style={{ color: theme.accent }}>
            Linked
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

function ReconciliationValue({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.reconciliationValue}>
      <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
        {label}
      </ThemedText>
      <ThemedText type="stat" numberOfLines={1} adjustsFontSizeToFit style={color ? { color } : undefined}>
        {value}
      </ThemedText>
    </View>
  );
}

function StatementItem({
  item,
  onPress,
  border,
}: {
  item: TransactionRow;
  onPress: () => void;
  border: boolean;
}) {
  const theme = useTheme();
  const isPurchase = item.direction === 'out';
  const title =
    item.counterpartyName?.trim() ||
    item.rawDetails.trim() ||
    (isPurchase ? 'Card purchase' : 'Merchant refund');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${isPurchase ? 'purchase' : 'refund'} ${title}, ${formatINR(item.paise)}`}
      style={({ pressed }) => [
        styles.itemRow,
        border ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border } : null,
        { opacity: pressed ? Opacity.pressed : 1 },
      ]}
    >
      <View style={styles.grow}>
        <ThemedText type={TextRole.rowTitle} numberOfLines={1}>
          {title}
        </ThemedText>
        <ThemedText type={TextRole.rowSecondary} themeColor="textSecondary" numberOfLines={1}>
          {isPurchase ? 'Purchase' : 'Refund'} · {item.isoDate}
        </ThemedText>
      </View>
      <ThemedText
        type={TextRole.rowAmount}
        style={[styles.figure, { color: isPurchase ? theme.spend : theme.income }]}
      >
        {isPurchase ? '−' : '+'}
        {formatINR(item.paise)}
      </ThemedText>
      <SymbolView
        name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
        size={14}
        tintColor={theme.textSecondary}
      />
    </Pressable>
  );
}

function StatementChoice({
  statement,
  suggested = false,
  border,
  onPress,
}: {
  statement: ImportRow;
  suggested?: boolean;
  border: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Link ${cardStatementLabel(statement)}${
        statement.totalDuePaise == null ? '' : `, total due ${formatINR(statement.totalDuePaise)}`
      }`}
      style={({ pressed }) => [
        styles.choiceRow,
        border ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border } : null,
        { opacity: pressed ? Opacity.pressed : 1 },
      ]}
    >
      <View style={styles.grow}>
        <ThemedText type={TextRole.rowTitle} numberOfLines={1}>
          {cardStatementLabel(statement)}
        </ThemedText>
        <ThemedText type={TextRole.rowSecondary} themeColor="textSecondary" numberOfLines={1}>
          {statement.totalDuePaise == null
            ? 'Total due not available'
            : `Total due ${formatINR(statement.totalDuePaise)}`}
          {' · Imported '}
          {statement.importedAt.slice(0, 10)}
        </ThemedText>
      </View>
      {suggested ? (
        <View style={[styles.matchBadge, { backgroundColor: theme.accentMuted }]}>
          <ThemedText type="caption" style={{ color: theme.accent }}>
            Amount match
          </ThemedText>
        </View>
      ) : null}
      <SymbolView
        name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
        size={14}
        tintColor={theme.textSecondary}
      />
    </Pressable>
  );
}

function formatDifference(differencePaise: number | null): string {
  if (differencePaise == null) return '—';
  if (differencePaise === 0) return formatINR(0);
  return `${differencePaise > 0 ? '+' : '−'}${formatINR(Math.abs(differencePaise))}`;
}

function reconciliationStatus(differencePaise: number | null): string {
  if (differencePaise == null) return 'Statement due is unavailable';
  if (differencePaise === 0) return 'Payment matches statement due';
  return differencePaise > 0
    ? `Payment is ${formatINR(differencePaise)} above the statement due`
    : `Payment is ${formatINR(Math.abs(differencePaise))} below the statement due`;
}

const styles = StyleSheet.create({
  // Content-sized sheet: the body takes its content height and shrinks at the cap instead of
  // growing from a zero basis, so a one-statement sheet stays short.
  safeArea: { flexShrink: 1 },
  header: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
  },
  closeButton: { minHeight: 32, justifyContent: 'center' },
  scroll: { flexShrink: 1 },
  body: { gap: Spacing.two, paddingBottom: Spacing.three },
  grow: { flex: 1, minWidth: 0 },
  section: { gap: Spacing.one },
  statementHeaderGroup: { borderBottomWidth: StyleSheet.hairlineWidth },
  statementHeader: {
    minHeight: TouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  reconciliationGrid: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  reconciliationValue: { flex: 1, minWidth: 0, paddingHorizontal: Spacing.one },
  verticalDivider: { width: StyleSheet.hairlineWidth },
  reconciliationStatus: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ruleCopy: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  itemRow: {
    minHeight: TouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  intro: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  introIcon: { marginTop: Spacing.half },
  choiceRow: {
    minHeight: TouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  matchBadge: {
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  figure: { fontVariant: ['tabular-nums'] },
  centerText: { textAlign: 'center' },
});
