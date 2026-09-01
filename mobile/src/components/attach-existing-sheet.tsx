/**
 * Attach existing (already-imported) transactions to a loan in bulk. Filter the candidate list by
 * amount range / text / direction (the same filter the Reports screen uses), pick the part they
 * represent (principal / repayment / interest), multi-select, then attach them all at once. Backs
 * the "these ₹50k–₹10L credits are repayments for this loan" case from a bank import.
 */

import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { SegmentedControl } from '@/components/segmented-control';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Opacity, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { TextRole } from '@/constants/typography';
import type { TxnFilter } from '@/core/analytics';
import type { Direction } from '@/core/domain/money';
import { formatINR } from '@/core/domain/money';
import { LOAN_PARTS, roleDirection, roleForLoanPart, type LoanKind, type LoanPart } from '@/core/lending/roles';
import { useUnattachedTxnsState } from '@/hooks/use-lending';
import { useTheme } from '@/hooks/use-theme';

export interface AttachExistingSheetProps {
  visible: boolean;
  loanKind?: LoanKind;
  onAttach: (txnIds: number[], part: LoanPart) => void;
  onClose: () => void;
}

/** A rupee-string input → paise, or undefined when empty / not a number. */
const textToPaise = (text: string): number | undefined => {
  const t = text.trim().replace(/[,\s₹]/g, '');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};

const RESULTS_MIN_HEIGHT = 220;

const DIRECTIONS: { label: string; value: Direction | undefined }[] = [
  { label: 'Any', value: undefined },
  { label: 'Money out', value: 'out' },
  { label: 'Money in', value: 'in' },
];

export function AttachExistingSheet({ visible, loanKind, onAttach, onClose }: AttachExistingSheetProps) {
  const theme = useTheme();
  const [part, setPart] = useState<LoanPart>('principal');
  const [selected, setSelected] = useState<
    Map<number, { direction: Direction; manual: boolean }>
  >(new Map());
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<Direction | undefined>(undefined);

  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setPart('principal');
      setSelected(new Map());
      setMinText('');
      setMaxText('');
      setSearch('');
      setDirection(undefined);
    }
  }

  const minPaise = textToPaise(minText);
  const maxPaise = textToPaise(maxText);
  const amountError =
    (minText.trim() !== '' && minPaise == null) || (maxText.trim() !== '' && maxPaise == null)
      ? 'Enter valid rupee amounts.'
      : minPaise != null && maxPaise != null && minPaise > maxPaise
        ? 'Minimum amount cannot exceed maximum amount.'
        : null;
  const filter: TxnFilter = {
    minPaise,
    maxPaise,
    search: search.trim() || undefined,
    direction,
  };
  const { data: candidates, loading, error } = useUnattachedTxnsState(filter);
  const expectedDirection =
    loanKind != null ? roleDirection(roleForLoanPart(loanKind, part)) : undefined;
  const invalidSelected = [...selected.values()].filter(
    (selection) =>
      !selection.manual &&
      expectedDirection != null &&
      selection.direction !== expectedDirection,
  ).length;

  const toggle = (id: number, rowDirection: Direction, manual: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, { direction: rowDirection, manual });
      return next;
    });
  };

  const attach = () => {
    if (selected.size === 0 || invalidSelected > 0 || amountError != null) return;
    onAttach([...selected.keys()], part);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SafeAreaView edges={['bottom']} style={styles.flexible}>
        <View style={styles.header}>
          <ThemedText type="smallEmphasis">Attach existing transactions</ThemedText>
          <Pressable
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Close attach existing"
            style={({ pressed }) => [styles.headerAction, { opacity: pressed ? Opacity.pressed : 1 }]}
          >
            <ThemedText type="link" style={{ color: theme.accent }}>
              Close
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView
          style={styles.flexible}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <TextField
            value={search}
            onChangeText={setSearch}
            label="Search"
            placeholder="Merchant, note or UPI ID"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          <View style={styles.amountRow}>
            <TextField
              value={minText}
              onChangeText={setMinText}
              label="Minimum (₹)"
              placeholder="0"
              keyboardType="decimal-pad"
              containerStyle={styles.flexInput}
            />
            <TextField
              value={maxText}
              onChangeText={setMaxText}
              label="Maximum (₹)"
              placeholder="Any"
              keyboardType="decimal-pad"
              containerStyle={styles.flexInput}
            />
          </View>
          {amountError ? (
            <ThemedText type="small" style={{ color: theme.spend }} accessibilityLiveRegion="polite">
              {amountError}
            </ThemedText>
          ) : null}
          <View style={styles.chips}>
            {DIRECTIONS.map((d) => (
              <Chip key={d.label} label={d.label} selected={direction === d.value} onPress={() => setDirection(d.value)} />
            ))}
          </View>

          <View style={styles.attachAs}>
            <ThemedText type="overline" themeColor="textSecondary">
              ATTACH AS
            </ThemedText>
            <SegmentedControl
              accessibilityLabel="Loan part"
              options={LOAN_PARTS.map((option) => ({ value: option.part, label: option.label }))}
              value={part}
              onChange={setPart}
            />
          </View>
          {expectedDirection ? (
            <ThemedText type="small" themeColor="textSecondary">
              {LOAN_PARTS.find((option) => option.part === part)?.label} for this{' '}
              {loanKind === 'lent' ? 'lent' : 'borrowed'} loan must be money {expectedDirection}.
            </ThemedText>
          ) : null}
          {invalidSelected > 0 ? (
            <ThemedText type="small" style={{ color: theme.spend }} accessibilityLiveRegion="polite">
              {invalidSelected} selected {invalidSelected === 1 ? 'transaction moves' : 'transactions move'} the
              wrong way for this loan part. Deselect {invalidSelected === 1 ? 'it' : 'them'} or choose another part.
            </ThemedText>
          ) : null}

          <View style={styles.resultHeader}>
            <ThemedText type="overline" themeColor="textSecondary">
              MATCHING TRANSACTIONS
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary" accessibilityLiveRegion="polite">
              {selected.size} selected
            </ThemedText>
          </View>

          <View style={styles.results}>
            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={theme.accent} />
                <ThemedText type="small" themeColor="textSecondary">
                  Loading transactions…
                </ThemedText>
              </View>
            ) : error ? (
              <EmptyState title="Couldn’t load transactions" message="Close this sheet and try again." />
            ) : candidates.length === 0 ? (
              <EmptyState title="No matches" message="No unattached transactions match these filters." />
            ) : (
              <View>
                {candidates.map((c, index) => {
                  const isSel = selected.has(c.id);
                  const out = c.direction === 'out';
                  const incoming = c.direction === 'in';
                  const rowDirection: Direction =
                    c.direction === 'in' || c.direction === 'out' ? c.direction : 'self';
                  const compatible =
                    c.source === 'manual' ||
                    expectedDirection == null ||
                    rowDirection === expectedDirection;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => toggle(c.id, rowDirection, c.source === 'manual')}
                      disabled={!compatible}
                      accessibilityRole="checkbox"
                      accessibilityLabel={`${c.counterpartyName || c.rawDetails || 'Transaction'}, ${c.isoDate}, ${
                        out ? 'money out' : incoming ? 'money in' : 'self-transfer'
                      } ${formatINR(c.paise)}`}
                      accessibilityState={{ checked: isSel, disabled: !compatible }}
                      style={({ pressed }) => [
                        styles.row,
                        index > 0 && { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth },
                        { backgroundColor: isSel ? theme.backgroundSelected : theme.backgroundElement },
                        { opacity: !compatible ? Opacity.disabled : pressed ? Opacity.pressed : 1 },
                      ]}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          {
                            borderColor: isSel ? theme.accent : theme.borderStrong,
                            backgroundColor: isSel ? theme.accent : 'transparent',
                          },
                        ]}
                      >
                        <ThemedText type="caption" style={{ color: isSel ? theme.onAccent : 'transparent' }}>
                          ✓
                        </ThemedText>
                      </View>
                      <View style={styles.rowLeft}>
                        <ThemedText type={TextRole.rowTitle} numberOfLines={1}>
                          {c.counterpartyName || c.rawDetails || '—'}
                        </ThemedText>
                        <ThemedText
                          type={TextRole.rowSecondary}
                          themeColor="textSecondary"
                          numberOfLines={1}
                        >
                          {c.isoDate}
                          {!compatible ? ` · Requires money ${expectedDirection}` : ''}
                        </ThemedText>
                      </View>
                      <ThemedText
                        type={TextRole.rowAmount}
                        style={[
                          styles.figure,
                          { color: out ? theme.spend : incoming ? theme.income : theme.textSecondary },
                        ]}
                      >
                        {out ? '−' : incoming ? '+' : ''} {formatINR(c.paise)}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>

        <Button
          label={
            selected.size === 0
              ? 'Select transactions'
              : `Attach ${selected.size} ${selected.size === 1 ? 'transaction' : 'transactions'}`
          }
          variant="primary"
          size="small"
          onPress={attach}
          disabled={selected.size === 0 || invalidSelected > 0 || amountError != null}
          style={styles.attachBtn}
        />
      </SafeAreaView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  // Content-sized sheet: the body takes its content height and shrinks at the cap.
  flexible: { flexShrink: 1, minHeight: 0 },
  // A floor under the search results, so narrowing a filter to a couple of rows does not resize the
  // sheet under an open keyboard. It matches the space the cap leaves once the keyboard is up.
  results: { minHeight: RESULTS_MIN_HEIGHT },
  header: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
  },
  headerAction: { minHeight: 32, justifyContent: 'center' },
  body: { paddingBottom: Spacing.two, gap: Spacing.one },
  amountRow: { flexDirection: 'row', gap: Spacing.two },
  flexInput: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  attachAs: { marginTop: Spacing.one, gap: Spacing.one },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
  },
  figure: { fontVariant: ['tabular-nums'] },
  row: {
    minHeight: TouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: Radius.xs,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLeft: { flex: 1, minWidth: 0 },
  loading: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.four },
  attachBtn: { marginTop: Spacing.one },
});
