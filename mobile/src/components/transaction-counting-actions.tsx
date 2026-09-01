import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { FeedbackBanner } from '@/components/feedback-banner';
import { ThemedText } from '@/components/themed-text';
import { Opacity, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { formatINR } from '@/core/domain/money';
import { useTheme } from '@/hooks/use-theme';

type SymbolName = ComponentProps<typeof SymbolView>['name'];
export type CountingActionId = 'self' | 'refund' | 'moneyLent' | 'cardBill';

export interface MoneyLentSummary {
  /** Single-loan name or "Split across N loans · M slices". */
  label: string;
  /** Compact loan/part/amount lines for a split or single attachment. */
  detailLines: string[];
  /** Whether any principal/repayment portion is excluded from normal totals. */
  excluded: boolean;
  /** Portion that remains in normal totals (interest plus any unallocated remainder). */
  countablePaise?: number;
}

export interface CountingVisibilityInput {
  direction: string;
  cardBillLinked: boolean;
  hasCardStatements: boolean;
}

/**
 * The product contract for counting controls. Keep this pure so the exact conditional states can
 * be tested without mounting the transaction sheet.
 */
export function visibleCountingActions({
  direction,
  cardBillLinked,
  hasCardStatements,
}: CountingVisibilityInput): CountingActionId[] {
  const actions: CountingActionId[] = ['self'];
  if (direction === 'in') actions.push('refund');
  actions.push('moneyLent');
  if (cardBillLinked || (direction === 'out' && hasCardStatements)) actions.push('cardBill');
  return actions;
}

export interface TransactionCountingActionsProps {
  direction: string;
  isRefund: boolean;
  moneyLent: MoneyLentSummary | null;
  cardBillLinked: boolean;
  cardBillLabel: string | null;
  cardBillSuggestion: string | null;
  hasCardStatements: boolean;
  onSetSelfTransfer: (isSelf: boolean) => void;
  onSetRefund: (isRefund: boolean) => void;
  onManageMoneyLent: () => void;
  onManageCardBill: () => void;
}

const ACTION_META: Record<CountingActionId, { label: string; icon: SymbolName }> = {
  self: {
    label: 'Self-transfer',
    icon: { ios: 'arrow.left.arrow.right', android: 'swap_horiz', web: 'swap_horiz' },
  },
  refund: {
    label: 'Refund',
    icon: { ios: 'arrow.uturn.backward', android: 'undo', web: 'undo' },
  },
  moneyLent: {
    label: 'Money Lent',
    icon: { ios: 'person.2', android: 'group', web: 'group' },
  },
  cardBill: {
    label: 'Card bill',
    icon: { ios: 'creditcard', android: 'credit_card', web: 'credit_card' },
  },
};

const CHIP_HEIGHT = 30;
const CHIP_HIT_SLOP = {
  top: Math.ceil((TouchTarget - CHIP_HEIGHT) / 2),
  bottom: Math.ceil((TouchTarget - CHIP_HEIGHT) / 2),
  left: 2,
  right: 2,
};
const CHIP_ICON = 14;
const CHIP_CHECK_ICON = 12;
const CHIP_INNER_GAP = Spacing.half;
const CHIP_PADDING_X = Spacing.one + Spacing.half;
const CHIP_ROW_GAP = Spacing.one;

/** Chip geometry, exported so the one-row budget for the common action set stays enforceable. */
export const COUNTING_CHIP_LAYOUT = {
  height: CHIP_HEIGHT,
  hitSlop: CHIP_HIT_SLOP,
  iconSize: CHIP_ICON,
  innerGap: CHIP_INNER_GAP,
  paddingX: CHIP_PADDING_X,
  rowGap: CHIP_ROW_GAP,
} as const;

/** Intrinsic width of one chip for a rendered label width, in dp. */
export function countingChipWidth(labelWidth: number, selected = false): number {
  return (
    CHIP_PADDING_X * 2 +
    CHIP_ICON +
    CHIP_INNER_GAP +
    labelWidth +
    (selected ? CHIP_INNER_GAP + CHIP_CHECK_ICON : 0)
  );
}

/**
 * Intrinsic width of the chip row. Chips size to their labels and the row spreads the slack, so
 * this is what has to stay inside the sheet's content width for the row to hold one line.
 */
export function countingChipRowWidth(labelWidths: number[], selected: boolean[] = []): number {
  const chips = labelWidths.reduce(
    (total, width, index) => total + countingChipWidth(width, selected[index] ?? false),
    0,
  );
  return chips + Math.max(0, labelWidths.length - 1) * CHIP_ROW_GAP;
}

export function TransactionCountingActions({
  direction,
  isRefund,
  moneyLent,
  cardBillLinked,
  cardBillLabel,
  cardBillSuggestion,
  hasCardStatements,
  onSetSelfTransfer,
  onSetRefund,
  onManageMoneyLent,
  onManageCardBill,
}: TransactionCountingActionsProps) {
  const isSelf = direction === 'self';
  const visible = visibleCountingActions({ direction, cardBillLinked, hasCardStatements });

  const isSelected = (id: CountingActionId) =>
    id === 'self'
      ? isSelf
      : id === 'refund'
        ? isRefund
        : id === 'moneyLent'
          ? moneyLent != null
          : cardBillLinked;

  const onPress = (id: CountingActionId) => {
    if (id === 'self') onSetSelfTransfer(!isSelf);
    else if (id === 'refund') onSetRefund(!isRefund);
    else if (id === 'moneyLent') onManageMoneyLent();
    else onManageCardBill();
  };

  return (
    <View style={styles.container}>
      <View style={styles.actions} accessibilityRole="toolbar" accessibilityLabel="How this transaction is counted">
        {visible.map((id) => (
          <CountingChip
            key={id}
            label={ACTION_META[id].label}
            icon={ACTION_META[id].icon}
            selected={isSelected(id)}
            onPress={() => onPress(id)}
            accessibilityHint={
              id === 'self'
                ? 'Marks or restores this transaction as a transfer between your own accounts'
                : id === 'refund'
                  ? 'Marks or restores this incoming transaction as a refund'
                  : id === 'moneyLent'
                    ? 'Opens the Money Lent manager'
                    : 'Opens credit-card statement linking'
            }
          />
        ))}
      </View>

      {isSelf ? (
        <FeedbackBanner
          wrap
          tone="review"
          title="Excluded from spent, received and net spent"
          message="Tap Self-transfer again to restore the original direction."
        />
      ) : null}

      {!isSelf && direction === 'in' && isRefund ? (
        <FeedbackBanner
          wrap
          tone="success"
          title="Offsets spending"
          message="This incoming transaction is treated as a refund and is not counted as income."
        />
      ) : null}

      {moneyLent ? (
        <StatusRow
          accessibilityLabel={`Manage Money Lent: ${moneyLent.label}`}
          accessibilityHint="Reopens the loan allocation manager"
          onPress={onManageMoneyLent}
          title={moneyLent.label}
          lines={[
            ...moneyLent.detailLines,
            moneyLent.excluded
              ? (moneyLent.countablePaise ?? 0) > 0
                ? `Principal and repayment slices are excluded. ${formatINR(moneyLent.countablePaise ?? 0)} of interest or unallocated remainder stays in normal totals.`
                : 'This transaction is loan principal or repayment, so it is excluded from normal spending and income.'
              : 'This is an interest entry, so it remains in normal spending or income while the loan tracks it separately.',
          ]}
        />
      ) : null}

      {cardBillLinked ? (
        <StatusRow
          accessibilityLabel={`Open linked card bill: ${cardBillLabel ?? 'card statement'}`}
          onPress={onManageCardBill}
          title={`Linked to ${cardBillLabel ?? 'card statement'}`}
          lines={['This bill-payment leg is excluded; the card purchases remain expenses.']}
        />
      ) : cardBillSuggestion && visible.includes('cardBill') ? (
        <StatusRow
          accessibilityLabel={`Review suggested card statement: ${cardBillSuggestion}`}
          onPress={onManageCardBill}
          title={`Suggested: ${cardBillSuggestion}`}
          lines={['The statement due matches this payment amount. Review before linking.']}
          tone="subtle"
        />
      ) : null}
    </View>
  );
}

function CountingChip({
  label,
  icon,
  selected,
  onPress,
  accessibilityHint,
}: {
  label: string;
  icon: SymbolName;
  selected: boolean;
  onPress: () => void;
  accessibilityHint: string;
}) {
  const theme = useTheme();
  const foreground = selected ? theme.onAccent : theme.textSecondary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected }}
      hitSlop={CHIP_HIT_SLOP}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.accent : theme.backgroundElement,
          borderColor: selected ? theme.accent : theme.borderStrong,
          opacity: pressed ? Opacity.pressed : 1,
        },
      ]}
    >
      <SymbolView name={icon} size={CHIP_ICON} tintColor={foreground} />
      <ThemedText type="smallEmphasis" numberOfLines={1} style={{ color: foreground }}>
        {label}
      </ThemedText>
      {selected ? (
        <SymbolView
          name={{ ios: 'checkmark', android: 'check', web: 'check' }}
          size={CHIP_CHECK_ICON}
          tintColor={foreground}
        />
      ) : null}
    </Pressable>
  );
}

function StatusRow({
  title,
  lines,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  tone = 'accent',
}: {
  title: string;
  lines: string[];
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  tone?: 'accent' | 'subtle';
}) {
  const theme = useTheme();
  const colors =
    tone === 'subtle'
      ? { background: theme.backgroundSelected, border: theme.border, chevron: theme.textSecondary }
      : { background: theme.accentMuted, border: theme.accent, chevron: theme.accent };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.statusRow,
        { backgroundColor: colors.background, borderColor: colors.border },
        { opacity: pressed ? Opacity.pressed : 1 },
      ]}
    >
      <View style={styles.grow}>
        <ThemedText type="smallEmphasis" numberOfLines={1}>
          {title}
        </ThemedText>
        {lines.map((line, index) => (
          <ThemedText key={`${line}-${index}`} type="small" themeColor="textSecondary">
            {line}
          </ThemedText>
        ))}
      </View>
      <SymbolView
        name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
        size={15}
        tintColor={colors.chevron}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.one },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: CHIP_ROW_GAP },
  chip: {
    minHeight: CHIP_HEIGHT,
    // Each chip keeps its intrinsic width and takes an equal share of the row's slack, so the row
    // fills edge to edge without ever squeezing a label. `flexShrink: 0` is what forbids clipping.
    flexGrow: 1,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: CHIP_INNER_GAP,
    paddingHorizontal: CHIP_PADDING_X,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.pill,
  },
  grow: { flex: 1, minWidth: 0 },
  statusRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
  },
});
