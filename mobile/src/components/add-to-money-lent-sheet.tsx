/**
 * The single "Add to Money Lent" flow, opened from a transaction. Pick an existing loan (or create
 * one inline — person + direction + name), choose what this transaction is (principal / repayment /
 * interest), and attach it. If the transaction is already in a loan, this instead lets you change
 * the part or remove it. Replaces the old separate "set transfer type" + "set person" steps.
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
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
  /** Loan the transaction is already attached to (null when not attached). */
  currentLoanId?: number | null;
  currentLoanName?: string;
  currentPart?: LoanPart | null;
  onAddPerson: (name: string) => number;
  onCreateLoan: (input: { name: string; personId: number; kind: LoanKind }) => number;
  onAttach: (loanId: number, part: LoanPart) => void;
  onDetach: () => void;
  onClose: () => void;
}

const loanLabel = (l: LoanChoice) =>
  `${l.personName}${l.name ? ` · ${l.name}` : ''} · ${l.kind === 'lent' ? 'lent' : 'borrowed'}`;

export function AddToMoneyLentSheet({
  visible,
  txn,
  loans,
  people,
  currentLoanId,
  currentLoanName,
  currentPart,
  onAddPerson,
  onCreateLoan,
  onAttach,
  onDetach,
  onClose,
}: AddToMoneyLentSheetProps) {
  const theme = useTheme();
  const [selectedLoanId, setSelectedLoanId] = useState<number | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newKind, setNewKind] = useState<LoanKind>('lent');
  const [newPersonId, setNewPersonId] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [newPerson, setNewPerson] = useState('');
  const [part, setPart] = useState<LoanPart | null>(currentPart ?? null);
  const [kbHeight, setKbHeight] = useState(0);

  const attached = currentLoanId != null;

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
    }
  }

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const addPerson = () => {
    const n = newPerson.trim();
    if (n === '') return;
    Keyboard.dismiss();
    setNewPersonId(onAddPerson(n));
    setNewPerson('');
  };

  const canSubmit = part != null && (attached || selectedLoanId != null || (creatingNew && newPersonId != null));

  const submit = () => {
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

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <BottomSheet visible={visible} onClose={onClose} heightFraction={0.9} backdropPaddingBottom={kbHeight}>
      <SafeAreaView edges={kbHeight > 0 ? [] : ['bottom']} style={styles.flexible}>
        <View style={styles.header}>
          <ThemedText type="smallBold">{attached ? 'Money lent' : 'Add to Money Lent'}</ThemedText>
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

          {attached ? (
            <ThemedText type="default" style={styles.groupTitle}>
              In loan: {currentLoanName ?? 'a loan'}
            </ThemedText>
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
            </>
          )}

          <ThemedText type="overline" themeColor="textSecondary" style={styles.groupTitle}>
            THIS TRANSACTION IS
          </ThemedText>
          <View style={styles.chips}>
            {LOAN_PARTS.map((p) => (
              <Chip key={p.part} label={p.label} selected={p.part === part} onPress={() => setPart(p.part)} />
            ))}
          </View>

          <Button
            label={attached ? 'Update' : 'Add to Money Lent'}
            variant="primary"
            onPress={submit}
            disabled={!canSubmit}
            style={styles.saveBtn}
          />
          {attached && (
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
  saveBtn: { marginTop: Spacing.four },
  removeBtn: { marginTop: Spacing.two, alignItems: 'center', paddingVertical: Spacing.one },
});
