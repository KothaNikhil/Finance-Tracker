/**
 * The single "Add to Money Lent" flow, opened from a transaction. Two modes:
 *  - One loan: pick an existing loan (or create one inline — person + direction + name), choose what
 *    this transaction is (Paid / Received / Interest), and attach it.
 *  - Split across loans: divide this one payment across active loans — e.g. a lump repayment that
 *    clears two loans, or principal + interest slices on the same loan. A debit can only be Paid and a
 *    credit only Received; interest follows the loan (received on money lent, paid on money borrowed).
 * If the transaction is already attached/split, this lets you change it or remove it.
 */

import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { validateLendingSplit } from '@/components/lending-split-validation';
import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { SegmentedControl } from '@/components/segmented-control';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Opacity, Radius, Spacing, TouchTarget } from '@/constants/theme';
import { TextRole } from '@/constants/typography';
import type { TransactionRow } from '@/core/db/schema';
import { formatINR, type Direction } from '@/core/domain/money';
import {
  defaultLoanFlow,
  LOAN_FLOWS,
  loanFlowDirection,
  loanFlowError,
  loanFlowOf,
  loanPartForFlow,
  type LoanFlow,
  type LoanKind,
  type LoanPart,
} from '@/core/lending/roles';
import { useTheme } from '@/hooks/use-theme';

export interface LoanChoice {
  id: number;
  name: string;
  personName: string;
  kind: LoanKind;
}

/** One editable split slice in the sheet: which loan, Paid / Received / Interest, and the rupee text. */
interface SplitRow {
  key: number;
  loanId: number | null;
  flow: LoanFlow;
  text: string;
}

let nextSplitRowKey = 1;

const createSplitRow = (loanId: number | null, flow: LoanFlow): SplitRow => ({
  key: nextSplitRowKey++,
  loanId,
  flow,
  text: '',
});

export interface AddToMoneyLentSheetProps {
  visible: boolean;
  txn: TransactionRow | null;
  loans: LoanChoice[];
  people: { id: number; name: string }[];
  /** Loan the transaction is already attached to (null when not attached / when split). */
  currentLoanId?: number | null;
  currentLoanName?: string;
  currentPart?: LoanPart | null;
  /** Kind of the attached loan, which may be closed and therefore missing from `loans`. */
  currentLoanKind?: LoanKind | null;
  /** Existing split slices for this transaction (empty when not split). */
  currentAllocations?: { loanId: number; part: LoanPart | null; paise: number; kind?: LoanKind }[];
  onAddPerson: (name: string) => number;
  onCreateLoan: (input: { name: string; personId: number; kind: LoanKind }) => number;
  onAttach: (loanId: number, part: LoanPart) => void;
  /**
   * Split the transaction into slices, each a `{loan, part, amount}`. All slices must move money the
   * same way (e.g. repayment + interest, or several principals). Replaces any attach/split.
   */
  onSplit: (allocations: { loanId: number; part: LoanPart; paise: number }[]) => void;
  onDetach: () => void;
  onClose: () => void;
}

const loanLabel = (l: LoanChoice) =>
  `${l.personName}${l.name ? ` · ${l.name}` : ''} · ${l.kind === 'lent' ? 'lent' : 'borrowed'}`;

/** A rupee-string input → paise, or undefined when empty / not a number. */
const textToPaise = (text: string): number | undefined => {
  const t = text.trim().replace(/[,\s₹]/g, '');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};

export function AddToMoneyLentSheet({
  visible,
  txn,
  loans,
  people,
  currentLoanId,
  currentLoanName,
  currentPart,
  currentLoanKind,
  currentAllocations,
  onAddPerson,
  onCreateLoan,
  onAttach,
  onSplit,
  onDetach,
  onClose,
}: AddToMoneyLentSheetProps) {
  const theme = useTheme();
  const [mode, setMode] = useState<'single' | 'split'>('single');
  const [selectedLoanId, setSelectedLoanId] = useState<number | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newKind, setNewKind] = useState<LoanKind>('lent');
  const [newPersonId, setNewPersonId] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [newPerson, setNewPerson] = useState('');
  const kindFor = (id: number | null): LoanKind | undefined => {
    if (id == null) return undefined;
    const active = loans.find((l) => l.id === id)?.kind;
    if (active) return active;
    if (id === currentLoanId && currentLoanKind) return currentLoanKind;
    return currentAllocations?.find((a) => a.loanId === id)?.kind;
  };
  const initialFlow = (): LoanFlow =>
    loanFlowOf(currentLoanKind ?? 'lent', currentPart) ?? defaultLoanFlow(txn?.direction);
  const [flow, setFlow] = useState<LoanFlow>(initialFlow); // single-mode choice
  // One row per split slice: which loan, which part, and the rupee text. The same loan may appear in
  // more than one row (e.g. repayment + interest on one loan).
  const [splitRows, setSplitRows] = useState<SplitRow[]>([]);
  const [openLoanPicker, setOpenLoanPicker] = useState<number | null>(null);

  const attached = currentLoanId != null;
  const isSplit = (currentAllocations?.length ?? 0) > 0;
  const total = txn?.paise ?? 0;

  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setSelectedLoanId(null);
      setCreatingNew(false);
      setNewKind('lent');
      setNewPersonId(null);
      setNewName('');
      setNewPerson('');
      setFlow(initialFlow());
      setOpenLoanPicker(null);
      // Prefill split rows (and default to split mode) when editing an existing split; otherwise start
      // with one blank slice (pre-picking the loan when there's only one to choose).
      const seeded = (currentAllocations ?? []).map<SplitRow>((a) => ({
        key: nextSplitRowKey++,
        loanId: a.loanId,
        flow:
          loanFlowOf(a.kind ?? kindFor(a.loanId) ?? 'lent', a.part ?? 'repayment') ??
          defaultLoanFlow(txn?.direction),
        text: String(a.paise / 100),
      }));
      const currentActiveLoanId =
        currentLoanId != null && loans.some((loan) => loan.id === currentLoanId)
          ? currentLoanId
          : null;
      setSplitRows(
        seeded.length > 0
          ? seeded
          : [
              createSplitRow(
                currentActiveLoanId ?? (loans.length === 1 ? loans[0].id : null),
                initialFlow(),
              ),
            ],
      );
      setMode(isSplit ? 'split' : 'single');
    }
  }

  const addPerson = () => {
    const n = newPerson.trim();
    if (n === '') return;
    Keyboard.dismiss();
    setNewPersonId(onAddPerson(n));
    setNewPerson('');
  };

  // --- split-mode derived values ---
  const sourceDirection: Direction =
    txn?.direction === 'in' || txn?.direction === 'out' ? txn.direction : 'self';
  const splitValidation = validateLendingSplit(
    { direction: sourceDirection, paise: total },
    splitRows.map((r) => {
      const kind = kindFor(r.loanId);
      return {
        loanId: r.loanId,
        part: kind != null ? loanPartForFlow(kind, r.flow) : null,
        paise: textToPaise(r.text),
        direction: kind != null ? loanFlowDirection(kind, r.flow) : undefined,
        flowError: kind != null && sourceDirection !== 'self' ? loanFlowError(kind, r.flow, sourceDirection) : null,
      };
    }),
  );
  const allocated = splitValidation.allocatedPaise;
  const canSplit = splitValidation.valid;

  const newRow = (): SplitRow =>
    createSplitRow(loans.length === 1 ? loans[0].id : null, defaultLoanFlow(txn?.direction));
  const updateRow = (i: number, patch: Partial<SplitRow>) =>
    setSplitRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setSplitRows((rows) => [...rows, newRow()]);
  const removeRow = (i: number) => {
    const removedKey = splitRows[i]?.key;
    setSplitRows((rows) => rows.filter((_, idx) => idx !== i));
    if (removedKey != null && openLoanPicker === removedKey) setOpenLoanPicker(null);
  };

  const singleKind = attached
    ? kindFor(currentLoanId ?? null)
    : creatingNew
      ? newKind
      : loans.find((loan) => loan.id === selectedLoanId)?.kind;
  const singleError = singleKind != null ? loanFlowError(singleKind, flow, sourceDirection) : null;
  const part = loanPartForFlow(singleKind ?? 'lent', flow);
  const canSubmitSingle =
    singleError == null &&
    (attached || selectedLoanId != null || (creatingNew && newPersonId != null));

  const submitSingle = () => {
    if (attached) {
      onAttach(currentLoanId!, part); // change part on the existing loan
      return;
    }
    let loanId = selectedLoanId;
    if (creatingNew) {
      if (newPersonId == null) return;
      loanId = onCreateLoan({ name: newName.trim(), personId: newPersonId, kind: newKind });
    }
    if (loanId != null) onAttach(loanId, part);
  };

  const submitSplit = () => {
    if (!canSplit) return;
    onSplit(splitValidation.allocations);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SafeAreaView edges={['bottom']} style={styles.flexible}>
        <View style={styles.header}>
          <ThemedText type="smallEmphasis">Money Lent</ThemedText>
          <Pressable
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Close Money Lent"
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
          {txn && (
            <View style={styles.transactionSummary}>
              <View style={[styles.badge, { backgroundColor: theme.accentMuted }]}>
                <SymbolView
                  name={{ ios: 'arrow.left.arrow.right', android: 'sync_alt', web: 'sync_alt' }}
                  size={15}
                  tintColor={theme.accent}
                />
              </View>
              <View style={styles.grow}>
                <ThemedText type={TextRole.rowTitle} numberOfLines={1}>
                  {txn.counterpartyName || txn.remarks || txn.rawDetails || 'Transaction'}
                </ThemedText>
                <ThemedText type={TextRole.rowSecondary} themeColor="textSecondary" numberOfLines={1}>
                  {txn.direction === 'out'
                    ? 'Money out'
                    : txn.direction === 'in'
                      ? 'Money in'
                      : 'Self-transfer'}{' '}
                  · {txn.isoDate}
                </ThemedText>
              </View>
              <ThemedText
                type={TextRole.rowAmount}
                numberOfLines={1}
                style={{
                  fontVariant: ['tabular-nums'],
                  color:
                    txn.direction === 'out'
                      ? theme.spend
                      : txn.direction === 'in'
                        ? theme.income
                        : theme.textSecondary,
                }}
              >
                {txn.direction === 'out' ? '−' : txn.direction === 'in' ? '+' : ''}
                {formatINR(txn.paise)}
              </ThemedText>
            </View>
          )}

          {/* Mode toggle — shown whenever there are loans to split across (including converting an
              already-attached payment into a split, e.g. one repayment that clears two loans). */}
          {loans.length > 0 && (
            <SegmentedControl
              accessibilityLabel="Money Lent mode"
              options={[
                { value: 'single', label: 'One loan' },
                { value: 'split', label: 'Split across loans' },
              ]}
              value={mode}
              onChange={setMode}
            />
          )}

          {/* What this transaction is — for a single attach. In split mode each slice picks its own part. */}
          {mode !== 'split' && (
            <>
              <ThemedText type="overline" themeColor="textSecondary" style={styles.groupTitle}>
                THIS TRANSACTION IS
              </ThemedText>
              <SegmentedControl
                accessibilityLabel="Loan part"
                options={LOAN_FLOWS.map((option) => ({ value: option.flow, label: option.label }))}
                value={flow}
                onChange={setFlow}
              />
              {singleError ? (
                <ThemedText type="small" style={{ color: theme.spend }} accessibilityLiveRegion="polite">
                  {singleError}
                </ThemedText>
              ) : null}
            </>
          )}

          {mode === 'split' ? (
            <>
              <View style={styles.splitHeading}>
                <ThemedText type="overline" themeColor="textSecondary">
                  SLICES
                </ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {loans.length} active {loans.length === 1 ? 'loan' : 'loans'}
                </ThemedText>
              </View>
              {splitRows.length === 0 ? (
                <Card padding="small">
                  <ThemedText type="small" themeColor="textSecondary">
                    No slices. Add one to build this split.
                  </ThemedText>
                </Card>
              ) : null}
              {splitRows.map((row, i) => {
                const selectedLoan = loans.find((loan) => loan.id === row.loanId);
                const selectedKind = kindFor(row.loanId);
                const selectedDirection =
                  selectedKind != null ? loanFlowDirection(selectedKind, row.flow) : undefined;
                const rowError = splitValidation.rowErrors[i];
                const pickerOpen = openLoanPicker === row.key;
                return (
                  <Card key={row.key} padding="small" style={styles.sliceCard}>
                    <View style={styles.sliceHeader}>
                      <ThemedText type="overline" themeColor="textSecondary">
                        SLICE {i + 1}
                      </ThemedText>
                      {selectedDirection ? (
                        <ThemedText type="caption" themeColor="textSecondary" style={styles.grow}>
                          · Money {selectedDirection}
                        </ThemedText>
                      ) : (
                        <View style={styles.grow} />
                      )}
                      <Pressable
                        onPress={() => removeRow(i)}
                        hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove slice ${i + 1}`}
                        style={({ pressed }) => ({ opacity: pressed ? Opacity.pressed : 1 })}
                      >
                        <ThemedText type="smallEmphasis" style={{ color: theme.spend }}>
                          Remove
                        </ThemedText>
                      </Pressable>
                    </View>

                    <Pressable
                      onPress={() => setOpenLoanPicker(pickerOpen ? null : row.key)}
                      accessibilityRole="button"
                      accessibilityLabel={`Choose loan for slice ${i + 1}`}
                      accessibilityState={{ expanded: pickerOpen }}
                      hitSlop={{ top: 3, bottom: 3 }}
                      style={({ pressed }) => [
                        styles.loanSelector,
                        { borderColor: row.loanId == null && rowError ? theme.spend : theme.borderStrong },
                        { opacity: pressed ? Opacity.pressed : 1 },
                      ]}
                    >
                      <ThemedText
                        type="small"
                        numberOfLines={1}
                        style={{ color: selectedLoan ? theme.text : theme.textSecondary, flex: 1 }}
                      >
                        {selectedLoan ? loanLabel(selectedLoan) : 'Choose an active loan'}
                      </ThemedText>
                      <SymbolView
                        name={{
                          ios: pickerOpen ? 'chevron.up' : 'chevron.down',
                          android: pickerOpen ? 'expand_less' : 'expand_more',
                          web: pickerOpen ? 'expand_less' : 'expand_more',
                        }}
                        size={15}
                        tintColor={theme.textSecondary}
                      />
                    </Pressable>
                    {pickerOpen ? (
                      <View style={[styles.loanOptions, { borderColor: theme.border }]}>
                        {loans.length === 0 ? (
                          <ThemedText type="small" themeColor="textSecondary" style={styles.loanOptionEmpty}>
                            Create an active loan before splitting.
                          </ThemedText>
                        ) : (
                          loans.map((loan, loanIndex) => {
                            const chosen = loan.id === row.loanId;
                            return (
                              <Pressable
                                key={loan.id}
                                onPress={() => {
                                  updateRow(i, { loanId: loan.id });
                                  setOpenLoanPicker(null);
                                }}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: chosen }}
                                style={({ pressed }) => [
                                  styles.loanOption,
                                  loanIndex > 0 && {
                                    borderTopColor: theme.border,
                                    borderTopWidth: StyleSheet.hairlineWidth,
                                  },
                                  {
                                    backgroundColor: chosen
                                      ? theme.backgroundSelected
                                      : theme.backgroundElement,
                                    opacity: pressed ? Opacity.pressed : 1,
                                  },
                                ]}
                              >
                                <ThemedText type="small" numberOfLines={1} style={styles.loanOptionLabel}>
                                  {loanLabel(loan)}
                                </ThemedText>
                                {chosen ? (
                                  <ThemedText type="smallEmphasis" style={{ color: theme.accent }}>
                                    ✓
                                  </ThemedText>
                                ) : null}
                              </Pressable>
                            );
                          })
                        )}
                      </View>
                    ) : null}

                    <SegmentedControl
                      accessibilityLabel={`Part for slice ${i + 1}`}
                      options={LOAN_FLOWS.map((option) => ({ value: option.flow, label: option.label }))}
                      value={row.flow}
                      onChange={(nextFlow) => updateRow(i, { flow: nextFlow })}
                    />
                    <TextField
                      value={row.text}
                      onChangeText={(value) => updateRow(i, { text: value })}
                      placeholder="0.00"
                      keyboardType="decimal-pad"
                      leading={
                        <ThemedText type="small" themeColor="textSecondary">
                          ₹
                        </ThemedText>
                      }
                      error={rowError?.startsWith('Enter an amount') ? rowError : undefined}
                      accessibilityLabel={`Amount for slice ${i + 1} in rupees`}
                    />
                    {rowError && !rowError.startsWith('Enter an amount') ? (
                      <ThemedText type="small" style={{ color: theme.spend }} accessibilityLiveRegion="polite">
                        {rowError}
                      </ThemedText>
                    ) : null}
                  </Card>
                );
              })}
              <Button
                label="Add slice"
                icon={{ ios: 'plus', android: 'add', web: 'add' }}
                variant="secondary"
                size="small"
                onPress={addRow}
              />

              <Card
                tone={splitValidation.errors.length > 0 ? 'danger' : 'subtle'}
                padding="small"
                style={styles.allocationCard}
              >
                <View style={styles.allocationLine}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Allocated
                  </ThemedText>
                  <ThemedText type="smallEmphasis">
                    {formatINR(allocated)} of {formatINR(total)}
                  </ThemedText>
                </View>
                <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${total > 0 ? Math.min(100, Math.round((allocated / total) * 100)) : 0}%`,
                        backgroundColor:
                          allocated > total ? theme.spend : splitValidation.valid ? theme.accent : theme.review,
                      },
                    ]}
                  />
                </View>
                <View style={styles.allocationLine}>
                  <ThemedText type="caption" themeColor="textSecondary">
                    Partial allocation is allowed
                  </ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {formatINR(splitValidation.remainingPaise)} left
                  </ThemedText>
                </View>
              </Card>
              {splitValidation.errors.map((message) => (
                <ThemedText
                  key={message}
                  type="small"
                  style={{ color: theme.spend }}
                  accessibilityLiveRegion="polite"
                >
                  {message}
                </ThemedText>
              ))}
              <ThemedText type="caption" themeColor="textSecondary">
                A debit can only be Paid and a credit only Received. Interest is received on money you lent
                and paid on money you borrowed. Paid and Received stay out of spending and income; interest
                still counts.
              </ThemedText>
              <Button label="Save split" variant="primary" onPress={submitSplit} disabled={!canSplit} style={styles.saveBtn} />
            </>
          ) : attached ? (
            <>
              <View style={[styles.currentLoan, { backgroundColor: theme.backgroundSelected, borderColor: theme.border }]}>
                <ThemedText type="caption" themeColor="textSecondary">
                  CURRENT LOAN
                </ThemedText>
                <ThemedText type="smallEmphasis" numberOfLines={1}>
                  {currentLoanName ?? 'Loan'}
                </ThemedText>
              </View>
              <Button
                label="Update Money Lent"
                variant="primary"
                onPress={submitSingle}
                disabled={!canSubmitSingle}
                style={styles.saveBtn}
              />
            </>
          ) : (
            <>
              <ThemedText type="overline" themeColor="textSecondary" style={styles.groupTitle}>
                CHOOSE A LOAN
              </ThemedText>
              {loans.length > 0 ? (
                <View style={styles.loanList}>
                  {loans.map((loan, index) => {
                    const chosen = selectedLoanId === loan.id && !creatingNew;
                    return (
                      <Pressable
                        key={loan.id}
                        onPress={() => {
                          setSelectedLoanId(loan.id);
                          setCreatingNew(false);
                        }}
                        accessibilityRole="radio"
                        accessibilityLabel={loanLabel(loan)}
                        accessibilityState={{ checked: chosen }}
                        style={({ pressed }) => [
                          styles.loanRow,
                          index > 0 && {
                            borderTopColor: theme.border,
                            borderTopWidth: StyleSheet.hairlineWidth,
                          },
                          {
                            backgroundColor: chosen
                              ? theme.backgroundSelected
                              : theme.backgroundElement,
                            opacity: pressed ? Opacity.pressed : 1,
                          },
                        ]}
                      >
                        <ThemedText type="small" numberOfLines={1} style={styles.loanOptionLabel}>
                          {loanLabel(loan)}
                        </ThemedText>
                        {chosen ? (
                          <ThemedText type="smallEmphasis" style={{ color: theme.accent }}>
                            ✓
                          </ThemedText>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Card padding="small">
                  <ThemedText type="small" themeColor="textSecondary">
                    No active loans. Create one below.
                  </ThemedText>
                </Card>
              )}
              <Button
                label="Create a new loan"
                icon={{ ios: 'plus', android: 'add', web: 'add' }}
                variant={creatingNew ? 'primary' : 'secondary'}
                size="small"
                onPress={() => {
                  setCreatingNew(true);
                  setSelectedLoanId(null);
                }}
              />

              {creatingNew && (
                <Card tone="subtle" padding="small" style={styles.newLoan}>
                  <ThemedText type="overline" themeColor="textSecondary">
                    NEW LOAN
                  </ThemedText>
                  <SegmentedControl
                    accessibilityLabel="New loan direction"
                    options={[
                      { value: 'lent', label: 'I lent' },
                      { value: 'borrowed', label: 'I borrowed' },
                    ]}
                    value={newKind}
                    onChange={setNewKind}
                  />
                  <ThemedText type="caption" themeColor="textSecondary">
                    Choose a person
                  </ThemedText>
                  <View style={styles.chips}>
                    {people.map((p) => (
                      <Chip key={p.id} label={p.name} selected={p.id === newPersonId} onPress={() => setNewPersonId(p.id)} />
                    ))}
                  </View>
                  <View style={styles.addRow}>
                    <TextField
                      value={newPerson}
                      onChangeText={setNewPerson}
                      placeholder="Add a new person…"
                      returnKeyType="done"
                      onSubmitEditing={addPerson}
                      containerStyle={styles.flexInput}
                    />
                    <Button
                      label="Add"
                      size="small"
                      onPress={addPerson}
                      disabled={newPerson.trim() === ''}
                      style={styles.addBtn}
                    />
                  </View>
                  <TextField
                    label="Loan name (optional)"
                    value={newName}
                    onChangeText={setNewName}
                    placeholder="e.g. Wedding or Emergency"
                  />
                </Card>
              )}

              <Button
                label="Add to Money Lent"
                variant="primary"
                onPress={submitSingle}
                disabled={!canSubmitSingle}
                style={styles.saveBtn}
              />
            </>
          )}

          {(attached || isSplit) && (
            <Pressable
              onPress={onDetach}
              accessibilityRole="button"
              accessibilityLabel="Remove this transaction from Money Lent"
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? Opacity.pressed : 1 }]}
            >
              <ThemedText type="smallEmphasis" style={{ color: theme.spend }}>
                Remove from Money Lent
              </ThemedText>
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  // Content-sized sheet: a single attach stays short, and adding slices grows it to the cap where
  // the body shrinks and scrolls rather than the sheet overflowing.
  flexible: { flexShrink: 1, minHeight: 0 },
  header: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
  },
  headerAction: { minHeight: 32, justifyContent: 'center' },
  body: { paddingBottom: Spacing.three, gap: Spacing.two },
  grow: { flex: 1, minWidth: 0 },
  transactionSummary: {
    minHeight: TouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupTitle: { marginTop: Spacing.one },
  splitHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
  },
  sliceCard: { gap: Spacing.two },
  sliceHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  loanSelector: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  loanOptions: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  loanOption: {
    minHeight: TouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  loanOptionEmpty: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
  loanOptionLabel: { flex: 1 },
  allocationCard: { gap: Spacing.one },
  allocationLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  progressTrack: { height: 4, borderRadius: Radius.pill, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: Radius.pill },
  currentLoan: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  loanList: { overflow: 'hidden' },
  loanRow: {
    minHeight: TouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  newLoan: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  addRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  flexInput: { flex: 1 },
  addBtn: { paddingHorizontal: Spacing.three },
  saveBtn: { marginTop: Spacing.one },
  removeBtn: {
    minHeight: TouchTarget,
    marginTop: Spacing.half,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
