/**
 * Add a hand-entered transaction into a loan (e.g. a cash repayment or interest). Amount, date,
 * part (principal / repayment / interest) and an optional note.
 */

import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { DateField, todayIso } from '@/components/date-field';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { decimalStringToPaise, paiseToRupees } from '@/core/domain/money';
import { LOAN_FLOWS, loanFlowOf, loanPartForFlow, type LoanFlow, type LoanKind, type LoanPart } from '@/core/lending/roles';
import { useTheme } from '@/hooks/use-theme';

export interface LoanTxnFormValues {
  part: LoanPart;
  paise: number;
  isoDate: string;
  remarks: string | null;
}

export interface LoanTxnFormProps {
  visible: boolean;
  mode?: 'create' | 'edit';
  /** Seeds the form when correcting an existing hand-entered row. */
  initial?: { part: LoanPart; paise: number; isoDate: string; remarks: string | null };
  /** The loan's kind turns Paid / Received into the stored principal or repayment part. */
  loanKind?: LoanKind;
  onSubmit: (values: LoanTxnFormValues) => void;
  /** Offered only in edit mode; the caller confirms before removing the entry. */
  onDelete?: () => void;
  onClose: () => void;
}

export function LoanTxnForm({
  visible,
  mode = 'create',
  initial,
  loanKind = 'lent',
  onSubmit,
  onDelete,
  onClose,
}: LoanTxnFormProps) {
  const theme = useTheme();
  const editing = mode === 'edit';
  const [amount, setAmount] = useState(() => (initial ? paiseToRupees(initial.paise).toFixed(2) : ''));
  const [flow, setFlow] = useState<LoanFlow | null>(loanFlowOf(loanKind, initial?.part));
  const [date, setDate] = useState<string | null>(initial?.isoDate ?? todayIso());
  const [note, setNote] = useState(initial?.remarks ?? '');

  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setAmount(initial ? paiseToRupees(initial.paise).toFixed(2) : '');
      setFlow(loanFlowOf(loanKind, initial?.part));
      setDate(initial?.isoDate ?? todayIso());
      setNote(initial?.remarks ?? '');
    }
  }

  const confirmDelete = () => {
    Alert.alert(
      'Delete this entry?',
      'This removes the entry you added by hand. The loan balance updates to match.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDelete?.() },
      ],
    );
  };

  const submit = () => {
    let paise: number;
    try {
      paise = decimalStringToPaise(amount.trim().replace(/[,\s₹]/g, ''));
    } catch {
      Alert.alert('Enter an amount', 'Please enter a valid rupee amount.');
      return;
    }
    if (paise <= 0) return Alert.alert('Enter an amount', 'The amount must be more than zero.');
    if (flow == null) return Alert.alert('Pick a type', 'Choose Paid, Received or Interest.');
    if (date == null) return Alert.alert('Check the date', 'Choose the date for this entry.');
    onSubmit({ part: loanPartForFlow(loanKind, flow), paise, isoDate: date, remarks: note.trim() || null });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SafeAreaView edges={['bottom']} style={styles.flexible}>
        <View style={styles.header}>
          <ThemedText type="smallEmphasis">{editing ? 'Edit entry' : 'Add manual entry'}</ThemedText>
          <Pressable onPress={onClose} hitSlop={14} accessibilityRole="button" accessibilityLabel="Close manual entry form">
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
            label="Amount (₹)"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            keyboardType="decimal-pad"
            accessibilityLabel="Entry amount in rupees"
          />

          <ThemedText type="overline" themeColor="textSecondary" style={styles.groupTitle}>
            TYPE
          </ThemedText>
          <View style={styles.chips}>
            {LOAN_FLOWS.map((f) => (
              <Chip key={f.flow} label={f.label} selected={f.flow === flow} onPress={() => setFlow(f.flow)} />
            ))}
          </View>

          <View style={styles.groupTitle}>
            <DateField label="Date" value={date} onChange={setDate} testID="loan-txn-date" />
          </View>

          <TextField
            label="Note (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Cash repayment"
            containerStyle={styles.groupTitle}
          />

          <Button
            label={editing ? 'Save changes' : 'Add entry'}
            variant="primary"
            onPress={submit}
            style={styles.saveBtn}
          />
          {editing && onDelete ? (
            <Button
              label="Delete entry"
              icon={{ ios: 'trash', android: 'delete', web: 'delete' }}
              variant="danger"
              onPress={confirmDelete}
              accessibilityHint="Opens a confirmation before removing this entry"
              style={styles.deleteBtn}
            />
          ) : null}
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.half },
  saveBtn: { marginTop: Spacing.four },
  deleteBtn: { marginTop: Spacing.two },
});
