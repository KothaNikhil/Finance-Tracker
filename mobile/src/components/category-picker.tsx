/**
 * A two-step category picker used to fix or set a transaction's category.
 *
 * Step 1 lists categories; picking one either assigns it straight away (if it has no
 * sub-categories) or moves to step 2, its nested sub-category list. Both steps end with an
 * "add new" option, so the user can grow their own category/sub-category lists on the fly —
 * sub-categories are free-text-with-suggestions, remembered under their parent category.
 *
 * Assigning here is what teaches the auto-categorizer (the caller passes the choice to
 * `setTransactionCategory`).
 */

import { useEffect, useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { CategoryRef } from '@/core/categorize';
import { useTheme } from '@/hooks/use-theme';

export interface CategoryPickerProps {
  visible: boolean;
  categories: CategoryRef[];
  /** Label shown at the top, e.g. the transaction's merchant name. */
  title?: string;
  onClose: () => void;
  onPick: (categoryId: number, subcategoryId: number | null) => void;
  /** Create a category (or reuse an existing one); returns its id. */
  onAddCategory: (name: string, emoji: string | null) => number;
  /** Create a sub-category under a category (or reuse one); returns its id. */
  onAddSubcategory: (categoryId: number, name: string) => number;
}

export function CategoryPicker({
  visible,
  categories,
  title,
  onClose,
  onPick,
  onAddCategory,
  onAddSubcategory,
}: CategoryPickerProps) {
  const theme = useTheme();
  const [selected, setSelected] = useState<CategoryRef | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftEmoji, setDraftEmoji] = useState('');
  // Height of the on-screen keyboard, so we can lift the bottom sheet clear of it (Android
  // doesn't resize a transparent Modal for the keyboard, so we do it ourselves).
  const [kbHeight, setKbHeight] = useState(0);

  // Reset to the category list every time the sheet opens.
  useEffect(() => {
    if (visible) {
      setSelected(null);
      setAdding(false);
      setDraftName('');
      setDraftEmoji('');
    }
  }, [visible]);

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

  const startAdding = () => {
    setDraftName('');
    setDraftEmoji('');
    setAdding(true);
  };

  const cancelAdding = () => {
    Keyboard.dismiss();
    setAdding(false);
    setDraftName('');
    setDraftEmoji('');
  };

  const onCategory = (cat: CategoryRef) => {
    if (cat.subcategories.length === 0) {
      onPick(cat.id, null);
    } else {
      setSelected(cat);
    }
  };

  const submitAdd = () => {
    const name = draftName.trim();
    if (name === '') return;
    Keyboard.dismiss();
    if (!selected) {
      // Adding a new top-level category → drop into its (empty) sub-category step.
      const id = onAddCategory(name, draftEmoji.trim() || null);
      const existing = categories.find((c) => c.id === id);
      setSelected(existing ?? { id, name, emoji: draftEmoji.trim() || null, subcategories: [] });
      cancelAdding();
    } else {
      // Adding a new sub-category under the selected category → assign it immediately.
      const subId = onAddSubcategory(selected.id, name);
      cancelAdding();
      onPick(selected.id, subId);
    }
  };

  const onBack = () => {
    if (adding) cancelAdding();
    else if (selected) setSelected(null);
    else onClose();
  };

  const headerTitle = adding
    ? selected
      ? `New sub-category`
      : 'New category'
    : selected
      ? selected.name
      : 'Choose category';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onBack}>
      <View style={[styles.backdrop, { paddingBottom: kbHeight }]}>
        <ThemedView style={styles.sheet}>
          <SafeAreaView edges={kbHeight > 0 ? [] : ['bottom']}>
              <View style={styles.header}>
                <Pressable onPress={onBack} hitSlop={8}>
                  <ThemedText type="link" themeColor="textSecondary">
                    {adding || selected ? '‹ Back' : 'Cancel'}
                  </ThemedText>
                </Pressable>
                <ThemedText type="smallBold" numberOfLines={1} style={styles.headerTitle}>
                  {headerTitle}
                </ThemedText>
                <View style={styles.headerSpacer} />
              </View>

              {title && !selected && !adding && (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.subtitle}>
                  {title}
                </ThemedText>
              )}

              {adding ? (
                <View style={styles.addForm}>
                  <View style={styles.addRow}>
                    {!selected && (
                      <TextInput
                        value={draftEmoji}
                        onChangeText={setDraftEmoji}
                        placeholder="🏷️"
                        placeholderTextColor={theme.textSecondary}
                        style={[
                          styles.input,
                          styles.emojiInput,
                          { color: theme.text, backgroundColor: theme.backgroundElement },
                        ]}
                      />
                    )}
                    <TextInput
                      value={draftName}
                      onChangeText={setDraftName}
                      autoFocus
                      placeholder={selected ? 'Sub-category name' : 'Category name'}
                      placeholderTextColor={theme.textSecondary}
                      returnKeyType="done"
                      onSubmitEditing={submitAdd}
                      style={[
                        styles.input,
                        styles.nameInput,
                        { color: theme.text, backgroundColor: theme.backgroundElement },
                      ]}
                    />
                  </View>
                  <Pressable
                    onPress={submitAdd}
                    disabled={draftName.trim() === ''}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.addBtn,
                      { backgroundColor: theme.accent, opacity: draftName.trim() === '' ? 0.4 : pressed ? 0.7 : 1 },
                    ]}
                  >
                    <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                      {selected ? 'Add & use sub-category' : 'Add category'}
                    </ThemedText>
                  </Pressable>
                </View>
              ) : (
                <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                  {!selected &&
                    categories.map((cat) => (
                      <Row
                        key={cat.id}
                        label={`${cat.emoji ? cat.emoji + '  ' : ''}${cat.name}`}
                        chevron={cat.subcategories.length > 0}
                        onPress={() => onCategory(cat)}
                        color={theme.backgroundElement}
                      />
                    ))}

                  {selected && (
                    <>
                      <Row
                        label="No sub-category"
                        onPress={() => onPick(selected.id, null)}
                        color={theme.backgroundElement}
                      />
                      {selected.subcategories.map((sub) => (
                        <Row
                          key={sub.id}
                          label={sub.name}
                          onPress={() => onPick(selected.id, sub.id)}
                          color={theme.backgroundElement}
                        />
                      ))}
                    </>
                  )}

                  <Row
                    label={selected ? '＋  New sub-category' : '＋  New category'}
                    onPress={startAdding}
                    color={theme.backgroundElement}
                    accent
                  />
                </ScrollView>
              )}
          </SafeAreaView>
        </ThemedView>
      </View>
    </Modal>
  );
}

function Row({
  label,
  onPress,
  color,
  chevron,
  accent,
}: {
  label: string;
  onPress: () => void;
  color: string;
  chevron?: boolean;
  accent?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, { backgroundColor: color, opacity: pressed ? 0.7 : 1 }]}
    >
      <ThemedText
        type={accent ? 'smallBold' : 'default'}
        numberOfLines={1}
        style={[styles.rowLabel, accent ? { color: theme.accent } : null]}
      >
        {label}
      </ThemedText>
      {chevron && (
        <ThemedText type="default" themeColor="textSecondary">
          ›
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    maxHeight: '80%',
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { flex: 1, textAlign: 'center' },
  headerSpacer: { width: 48 },
  subtitle: { textAlign: 'center', marginTop: Spacing.one },
  list: { marginTop: Spacing.two },
  listContent: { gap: Spacing.one, paddingBottom: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
  },
  rowLabel: { flex: 1 },
  addForm: { marginTop: Spacing.three, gap: Spacing.two },
  addRow: { flexDirection: 'row', gap: Spacing.two },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  emojiInput: { width: 64, textAlign: 'center' },
  nameInput: { flex: 1 },
  addBtn: {
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
