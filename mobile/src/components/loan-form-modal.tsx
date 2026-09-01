/**
 * Create or edit a loan (a money-lent grouping): a name, the person it's with, and the direction
 * (you lent / you borrowed). Self-contained — person is inline chips + add, no nested sheets.
 */

import { useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { InfoDisclosure } from '@/components/info-disclosure';
import { SegmentedControl } from '@/components/segmented-control';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { LoanKind } from '@/core/lending/roles';
import { useTheme } from '@/hooks/use-theme';

const LOAN_NOTE = 'A loan groups principal, repayments and interest with one person.';

export interface LoanFormValues {
  name: string;
  personId: number;
  kind: LoanKind;
}

export interface LoanFormModalProps {
  visible: boolean;
  mode: 'create' | 'edit';
  initial?: { name: string; personId: number; kind: LoanKind };
  people: { id: number; name: string }[];
  onAddPerson: (name: string) => number;
  onSubmit: (values: LoanFormValues) => void;
  onClose: () => void;
}

export function LoanFormModal({ visible, mode, initial, people, onAddPerson, onSubmit, onClose }: LoanFormModalProps) {
  const theme = useTheme();
  const [name, setName] = useState(initial?.name ?? '');
  const [personId, setPersonId] = useState<number | null>(initial?.personId ?? null);
  const [kind, setKind] = useState<LoanKind>(initial?.kind ?? 'lent');
  const [newPerson, setNewPerson] = useState('');

  // Seed the form from `initial` each time the sheet opens.
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setName(initial?.name ?? '');
      setPersonId(initial?.personId ?? null);
      setKind(initial?.kind ?? 'lent');
      setNewPerson('');
    }
  }

  const addPerson = () => {
    const n = newPerson.trim();
    if (n === '') return;
    Keyboard.dismiss();
    setPersonId(onAddPerson(n));
    setNewPerson('');
  };

  const submit = () => {
    if (personId == null) return;
    onSubmit({ name: name.trim(), personId, kind });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SafeAreaView edges={['bottom']} style={styles.flexible}>
        <View style={styles.header}>
          <InfoDisclosure label="What a loan groups together" text={LOAN_NOTE} style={styles.grow}>
            <ThemedText type="smallEmphasis">{mode === 'create' ? 'New loan' : 'Edit loan'}</ThemedText>
          </InfoDisclosure>
          <Pressable onPress={onClose} hitSlop={14} accessibilityRole="button" accessibilityLabel="Close loan form">
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
          <ThemedText type="overline" themeColor="textSecondary">
            DIRECTION
          </ThemedText>
          <SegmentedControl
            accessibilityLabel="Loan direction"
            options={[
              { value: 'lent', label: 'I lent' },
              { value: 'borrowed', label: 'I borrowed' },
            ]}
            value={kind}
            onChange={setKind}
          />
          <ThemedText type="caption" themeColor="textSecondary">
            {kind === 'lent' ? 'They owe the outstanding principal to you.' : 'You owe the outstanding principal to them.'}
          </ThemedText>

          <ThemedText type="overline" themeColor="textSecondary" style={styles.groupTitle}>
            WITH WHOM
          </ThemedText>
          <View style={styles.chips}>
            {people.map((p) => (
              <Chip key={p.id} label={p.name} selected={p.id === personId} onPress={() => setPersonId(p.id)} />
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
            <Button label="Add" onPress={addPerson} disabled={newPerson.trim() === ''} style={styles.addBtn} />
          </View>

          <ThemedText type="overline" themeColor="textSecondary" style={styles.groupTitle}>
            NAME (OPTIONAL)
          </ThemedText>
          <TextField
            value={name}
            onChangeText={setName}
            placeholder="e.g. Wedding or Emergency"
            accessibilityLabel="Loan name, optional"
          />

          <Button
            label={mode === 'create' ? 'Create loan' : 'Save changes'}
            variant="primary"
            onPress={submit}
            disabled={personId == null}
            style={styles.saveBtn}
          />
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
  addRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two, alignItems: 'center' },
  grow: { flex: 1 },
  flexInput: { flex: 1 },
  addBtn: { paddingHorizontal: Spacing.four },
  saveBtn: { marginTop: Spacing.four },
});
