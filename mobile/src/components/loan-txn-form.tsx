/**
 * Add a hand-entered transaction into a loan (e.g. a cash repayment or interest). Amount, date,
 * part (principal / repayment / interest) and an optional note.
 */

import { useEffect, useState } from 'react';
import { Alert, Keyboard, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { decimalStringToPaise } from '@/core/domain/money';
import { LOAN_PARTS, type LoanPart } from '@/core/lending/roles';
import { useTheme } from '@/hooks/use-theme';

export interface LoanTxnFormValues {
  part: LoanPart;
  paise: number;
  isoDate: string;
  remarks: string | null;
}

export interface LoanTxnFormProps {
  visible: boolean;
  onSubmit: (values: LoanTxnFormValues) => void;
  onClose: () => void;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function LoanTxnForm({ visible, onSubmit, onClose }: LoanTxnFormProps) {
  const theme = useTheme();
  const [amount, setAmount] = useState('');
  const [part, setPart] = useState<LoanPart | null>(null);
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [kbHeight, setKbHeight] = useState(0);

  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setAmount('');
      setPart(null);
      setDate(todayIso());
      setNote('');
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

  const submit = () => {
    let paise: number;
    try {
      paise = decimalStringToPaise(amount.trim().replace(/[,\s₹]/g, ''));
    } catch {
      Alert.alert('Enter an amount', 'Please enter a valid rupee amount.');
      return;
    }
    if (paise <= 0) return Alert.alert('Enter an amount', 'The amount must be more than zero.');
    if (part == null) return Alert.alert('Pick a type', 'Choose principal, repayment or interest.');
    if (!ISO_DATE_RE.test(date.trim())) return Alert.alert('Check the date', 'Use the format YYYY-MM-DD.');
    onSubmit({ part, paise, isoDate: date.trim(), remarks: note.trim() || null });
  };

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <BottomSheet visible={visible} onClose={onClose} heightFraction={0.85} backdropPaddingBottom={kbHeight}>
      <SafeAreaView edges={kbHeight > 0 ? [] : ['bottom']} style={styles.flexible}>
        <View style={styles.header}>
          <ThemedText type="smallBold">Add to this loan</ThemedText>
          <Pressable onPress={onClose} hitSlop={8}>
            <ThemedText type="link" themeColor="textSecondary">
              Close
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView style={styles.flexible} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <ThemedText type="overline" themeColor="textSecondary">
            AMOUNT (₹)
          </ThemedText>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={theme.textSecondary}
            keyboardType="decimal-pad"
            style={inputStyle}
          />

          <ThemedText type="overline" themeColor="textSecondary" style={styles.groupTitle}>
            TYPE
          </ThemedText>
          <View style={styles.chips}>
            {LOAN_PARTS.map((p) => (
              <Chip key={p.part} label={p.label} selected={p.part === part} onPress={() => setPart(p.part)} />
            ))}
          </View>

          <ThemedText type="overline" themeColor="textSecondary" style={styles.groupTitle}>
            DATE
          </ThemedText>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle}
          />

          <ThemedText type="overline" themeColor="textSecondary" style={styles.groupTitle}>
            NOTE (OPTIONAL)
          </ThemedText>
          <TextInput value={note} onChangeText={setNote} placeholder="e.g. cash repayment" placeholderTextColor={theme.textSecondary} style={inputStyle} />

          <Button label="Add" variant="primary" onPress={submit} style={styles.saveBtn} />
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
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 16 },
  saveBtn: { marginTop: Spacing.four },
});
