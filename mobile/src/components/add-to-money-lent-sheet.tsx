/**
 * The single "Add to Money Lent" flow, opened from a transaction. Two modes:
 *  - One loan: pick an existing loan (or create one inline — person + direction + name), choose what
 *    this transaction is (principal / repayment / interest), and attach it.
 *  - Split across loans: divide this one payment across several loans of the same kind — e.g. a lump
 *    repayment that clears two separate loans to the same person. Enter an amount per loan.
 * If the transaction is already attached/split, this lets you change it or remove it.
 */

import { useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { TransactionRow } from '@/core/db/schema';
import { formatINR } from '@/core/domain/money';
import { LOAN_PARTS, type LoanKind, type LoanPart } from '@/core/lending/roles';
import { useTheme } from '@/hooks/use-theme';

export interface LoanChoice {
  id: number;
  name: string;
  personName: string;
  kind: LoanKind;
}

export interface AddToMoneyLentSheetProps {
  visible: boolean;
  txn: TransactionRow | null;
  loans: LoanChoice[];
  people: { id: number; name: string }[];
  /** Loan the transaction is already attached to (null when not attached / when split). */
  currentLoanId?: number | null;
  currentLoanName?: string;
  currentPart?: LoanPart | null;
  /** Existing split slices for this transaction (empty when not split). */
  currentAllocations?: { loanId: number; paise: number }[];
  onAddPerson: (name: string) => number;
  onCreateLoan: (input: { name: string; personId: number; kind: LoanKind }) => number;
  onAttach: (loanId: number, part: LoanPart) => void;
  /** Split the transaction across loans (all the same kind). Replaces any attach/split. */
  onSplit: (part: LoanPart, allocations: { loanId: number; paise: number }[]) => void;
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
  const [part, setPart] = useState<LoanPart | null>(currentPart ?? null);
  // Per-loan rupee text for split mode, keyed by loan id.
  const [amounts, setAmounts] = useState<Record<number, string>>({});

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
      setPart(currentPart ?? null);
      // Prefill split amounts (and default to split mode) when editing an existing split.
      const seed: Record<number, string> = {};
      for (const a of currentAllocations ?? []) seed[a.loanId] = String(a.paise / 100);
      setAmounts(seed);
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
  const splitSlices = loans
    .map((l) => ({ loanId: l.id, kind: l.kind, paise: textToPaise(amounts[l.id] ?? '') }))
    .filter((s): s is { loanId: number; kind: LoanKind; paise: number } => s.paise != null && s.paise > 0);
  const allocated = splitSlices.reduce((sum, s) => sum + s.paise, 0);
  const splitKinds = new Set(splitSlices.map((s) => s.kind));
  const overAllocated = total > 0 && allocated > total;
  const canSplit = part != null && splitSlices.length > 0 && !overAllocated && splitKinds.size === 1;

  const canSubmitSingle = part != null && (attached || selectedLoanId != null || (creatingNew && newPersonId != null));

  const submitSingle = () => {
    if (part == null) return;
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
    if (!canSplit || part == null) return;
    onSplit(part, splitSlices.map((s) => ({ loanId: s.loanId, paise: s.paise })));
  };

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <BottomSheet visible={visible} onClose={onClose} heightFraction={0.9}>
      <SafeAreaView edges={['bottom']} style={styles.flexible}>
        <View style={styles.header}>
          <ThemedText type="smallBold">{attached || isSplit ? 'Money lent' : 'Add to Money Lent'}</ThemedText>
          <Pressable onPress={onClose} hitSlop={8}>
            <ThemedText type="link" themeColor="textSecondary">
              Close
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView style={styles.flexible} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {txn && (
            <ThemedText type="small" themeColor="textSecondary">
              This transaction · {txn.direction === 'out' ? '−' : '+'}
              {formatINR(txn.paise)} · {txn.isoDate}
            </ThemedText>
          )}

          {/* Mode toggle — shown whenever there are loans to split across (including converting an
              already-attached payment into a split, e.g. one repayment that clears two loans). */}
          {loans.length > 0 && (
            <View style={styles.chips}>
              <Chip label="One loan" selected={mode === 'single'} onPress={() => setMode('single')} />
              <Chip label="Split across loans" selected={mode === 'split'} onPress={() => setMode('split')} />
            </View>
          )}

          {/* What this transaction is — the part applies to the attach OR to every split slice. */}
          <ThemedText type="overline" themeColor="textSecondary" style={styles.groupTitle}>
            THIS TRANSACTION IS
          </ThemedText>
          <View style={styles.chips}>
            {LOAN_PARTS.map((p) => (
              <Chip key={p.part} label={p.label} selected={p.part === part} onPress={() => setPart(p.part)} />
            ))}
          </View>

          {mode === 'split' ? (
            <>
              <ThemedText type="overline" themeColor="textSecondary" style={styles.groupTitle}>
                AMOUNT PER LOAN
              </ThemedText>
              {loans.map((l) => (
                <View key={l.id} style={styles.splitRow}>
                  <ThemedText type="small" numberOfLines={1} style={styles.splitLabel}>
                    {loanLabel(l)}
                  </ThemedText>
                  <TextInput
                    value={amounts[l.id] ?? ''}
                    onChangeText={(v) => setAmounts((m) => ({ ...m, [l.id]: v }))}
                    placeholder="₹0"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="numeric"
                    style={[inputStyle, styles.splitInput]}
                  />
                </View>
              ))}
              <ThemedText type="small" themeColor={overAllocated ? undefined : 'textSecondary'} style={overAllocated ? { color: theme.spend } : undefined}>
                Allocated {formatINR(allocated)} of {formatINR(total)}
                {allocated < total ? ` · ${formatINR(total - allocated)} left unallocated` : ''}
                {overAllocated ? ' · over the payment amount' : ''}
              </ThemedText>
              {splitKinds.size > 1 && (
                <ThemedText type="small" style={{ color: theme.spend }}>
                  Split must be across loans of the same type (all lent or all borrowed).
                </ThemedText>
              )}
              <Button label="Split across loans" variant="primary" onPress={submitSplit} disabled={!canSplit} style={styles.saveBtn} />
            </>
          ) : attached ? (
            <>
              <ThemedText type="default" style={styles.groupTitle}>
                In loan: {currentLoanName ?? 'a loan'}
              </ThemedText>
              <Button label="Update" variant="primary" onPress={submitSingle} disabled={!canSubmitSingle} style={styles.saveBtn} />
            </>
          ) : (
            <>
              <ThemedText type="overline" themeColor="textSecondary" style={styles.groupTitle}>
                CHOOSE A LOAN
              </ThemedText>
              {loans.map((l) => (
                <Pressable
                  key={l.id}
                  onPress={() => {
                    setSelectedLoanId(l.id);
                    setCreatingNew(false);
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.loanRow,
                    { backgroundColor: selectedLoanId === l.id && !creatingNew ? theme.backgroundSelected : theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <ThemedText type="default" numberOfLines={1}>
                    {loanLabel(l)}
                  </ThemedText>
                  {selectedLoanId === l.id && !creatingNew && (
                    <ThemedText type="smallBold" style={{ color: theme.accent }}>
                      ✓
                    </ThemedText>
                  )}
                </Pressable>
              ))}
              <Pressable
                onPress={() => {
                  setCreatingNew(true);
                  setSelectedLoanId(null);
                }}
                accessibilityRole="button"
                style={({ pressed }) => [styles.loanRow, { backgroundColor: creatingNew ? theme.backgroundSelected : theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}
              >
                <ThemedText type="smallBold" style={{ color: theme.accent }}>
                  ＋ New loan
                </ThemedText>
              </Pressable>

              {creatingNew && (
                <View style={styles.newLoan}>
                  <View style={styles.chips}>
                    <Chip label="I lent" selected={newKind === 'lent'} onPress={() => setNewKind('lent')} />
                    <Chip label="I borrowed" selected={newKind === 'borrowed'} onPress={() => setNewKind('borrowed')} />
                  </View>
                  <View style={styles.chips}>
                    {people.map((p) => (
                      <Chip key={p.id} label={p.name} selected={p.id === newPersonId} onPress={() => setNewPersonId(p.id)} />
                    ))}
                  </View>
                  <View style={styles.addRow}>
                    <TextInput
                      value={newPerson}
                      onChangeText={setNewPerson}
                      placeholder="Add a new person…"
                      placeholderTextColor={theme.textSecondary}
                      returnKeyType="done"
                      onSubmitEditing={addPerson}
                      style={[inputStyle, styles.flexInput]}
                    />
                    <Button label="Add" onPress={addPerson} disabled={newPerson.trim() === ''} style={styles.addBtn} />
                  </View>
                  <TextInput value={newName} onChangeText={setNewName} placeholder="Loan name (optional)" placeholderTextColor={theme.textSecondary} style={inputStyle} />
                </View>
              )}

              <Button label="Add to Money Lent" variant="primary" onPress={submitSingle} disabled={!canSubmitSingle} style={styles.saveBtn} />
            </>
          )}

          {(attached || isSplit) && (
            <Pressable onPress={onDetach} accessibilityRole="button" hitSlop={8} style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? 0.6 : 1 }]}>
              <ThemedText type="small" style={{ color: theme.spend }}>
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
  flexible: { flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.two },
  body: { paddingBottom: Spacing.four, gap: Spacing.one },
  groupTitle: { marginTop: Spacing.three },
  loanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    marginTop: Spacing.one,
  },
  newLoan: { marginTop: Spacing.two, gap: Spacing.one },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.half },
  addRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  flexInput: { flex: 1 },
  addBtn: { paddingHorizontal: Spacing.four },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 16 },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  splitLabel: { flex: 1 },
  splitInput: { width: 130, textAlign: 'right' },
  saveBtn: { marginTop: Spacing.four },
  removeBtn: { marginTop: Spacing.two, alignItems: 'center', paddingVertical: Spacing.one },
});
