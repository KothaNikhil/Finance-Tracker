/**
 * Create or edit a loan (a money-lent grouping): a name, the person it's with, and the direction
 * (you lent / you borrowed). Self-contained — person is inline chips + add, no nested sheets.
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { LoanKind } from '@/core/lending/roles';
import { useTheme } from '@/hooks/use-theme';

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
  const [kbHeight, setKbHeight] = useState(0);

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
    setPersonId(onAddPerson(n));
    setNewPerson('');
  };

  const submit = () => {
    if (personId == null) return;
    onSubmit({ name: name.trim(), personId, kind });
  };

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <BottomSheet visible={visible} onClose={onClose} heightFraction={0.85} backdropPaddingBottom={kbHeight}>
      <SafeAreaView edges={kbHeight > 0 ? [] : ['bottom']} style={styles.flexible}>
        <View style={styles.header}>
          <ThemedText type="smallBold">{mode === 'create' ? 'New loan' : 'Edit loan'}</ThemedText>
          <Pressable onPress={onClose} hitSlop={8}>
            <ThemedText type="link" themeColor="textSecondary">
              Close
            </ThemedText>
          </Pressable>
        </View>

        <ScrollView style={styles.flexible} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <ThemedText type="overline" themeColor="textSecondary">
            DIRECTION
          </ThemedText>
          <View style={styles.chips}>
            <Chip label="I lent (they owe me)" selected={kind === 'lent'} onPress={() => setKind('lent')} />
            <Chip label="I borrowed (I owe them)" selected={kind === 'borrowed'} onPress={() => setKind('borrowed')} />
          </View>

          <ThemedText type="overline" themeColor="textSecondary" style={styles.groupTitle}>
            WITH WHOM
          </ThemedText>
          <View style={styles.chips}>
            {people.map((p) => (
              <Chip key={p.id} label={p.name} selected={p.id === personId} onPress={() => setPersonId(p.id)} />
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

          <ThemedText type="overline" themeColor="textSecondary" style={styles.groupTitle}>
            NAME (OPTIONAL)
          </ThemedText>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. interest loan"
            placeholderTextColor={theme.textSecondary}
            style={inputStyle}
          />

          <Button label={mode === 'create' ? 'Create loan' : 'Save'} variant="primary" onPress={submit} disabled={personId == null} style={styles.saveBtn} />
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
  flexInput: { flex: 1 },
  addBtn: { paddingHorizontal: Spacing.four },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 16 },
  saveBtn: { marginTop: Spacing.four },
});
