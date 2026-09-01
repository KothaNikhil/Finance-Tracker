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

import { useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Opacity, Radius, Spacing, TouchTarget } from '@/constants/theme';
import type { CategoryRef } from '@/core/categorize';
import { useTheme } from '@/hooks/use-theme';

interface PickerRow {
  key: string;
  label: string;
  onPress: () => void;
  chevron?: boolean;
  accent?: boolean;
  selected?: boolean;
}

export interface CategoryPickerProps {
  visible: boolean;
  categories: CategoryRef[];
  /** Label shown at the top, e.g. the transaction's merchant name. */
  title?: string;
  selectedCategoryId?: number | null;
  selectedSubcategoryId?: number | null;
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
  selectedCategoryId,
  selectedSubcategoryId,
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
  const [wasVisible, setWasVisible] = useState(visible);

  // Reset to the category list every time the sheet opens.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setSelected(null);
      setAdding(false);
      setDraftName('');
      setDraftEmoji('');
    }
  }

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

  const rows: PickerRow[] = selected
    ? [
        {
          key: 'no-sub',
          label: 'No sub-category',
          onPress: () => onPick(selected.id, null),
          selected: selected.id === selectedCategoryId && selectedSubcategoryId == null,
        },
        ...selected.subcategories.map<PickerRow>((sub) => ({
          key: `sub-${sub.id}`,
          label: sub.name,
          onPress: () => onPick(selected.id, sub.id),
          selected: selected.id === selectedCategoryId && sub.id === selectedSubcategoryId,
        })),
        { key: 'add', label: '＋  New sub-category', onPress: startAdding, accent: true },
      ]
    : [
        ...categories.map<PickerRow>((cat) => ({
          key: `cat-${cat.id}`,
          label: `${cat.emoji ? cat.emoji + '  ' : ''}${cat.name}`,
          onPress: () => onCategory(cat),
          chevron: cat.subcategories.length > 0,
          selected: cat.id === selectedCategoryId,
        })),
        { key: 'add', label: '＋  New category', onPress: startAdding, accent: true },
      ];

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={adding || selected ? 'Back' : 'Cancel category selection'}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            style={({ pressed }) => [styles.headerAction, { opacity: pressed ? Opacity.pressed : 1 }]}
          >
            <ThemedText type="link" themeColor="textSecondary">
              {adding || selected ? '‹ Back' : 'Cancel'}
            </ThemedText>
          </Pressable>
          <ThemedText type="smallEmphasis" numberOfLines={1} style={styles.headerTitle}>
            {headerTitle}
          </ThemedText>
          <View style={styles.headerSpacer} />
        </View>

        {title && !selected && !adding ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.subtitle}>
            {title}
          </ThemedText>
        ) : null}

        {adding ? (
          <View style={styles.addForm}>
            <View style={styles.addRow}>
              {!selected ? (
                <TextInput
                  value={draftEmoji}
                  onChangeText={setDraftEmoji}
                  placeholder="🏷️"
                  placeholderTextColor={theme.textSecondary}
                  style={[
                    styles.input,
                    styles.emojiInput,
                    { color: theme.text, backgroundColor: theme.background, borderColor: theme.borderStrong },
                  ]}
                  accessibilityLabel="Category emoji"
                />
              ) : null}
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
                  { color: theme.text, backgroundColor: theme.background, borderColor: theme.borderStrong },
                ]}
                accessibilityLabel={selected ? 'New subcategory name' : 'New category name'}
              />
            </View>
            <Button
              label={selected ? 'Add & use subcategory' : 'Add category'}
              onPress={submitAdd}
              disabled={draftName.trim() === ''}
              variant="primary"
              size="small"
            />
          </View>
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View>
              {rows.map((row, index) => (
                <Row key={row.key} row={row} border={index > 0} />
              ))}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </BottomSheet>
  );
}

function Row({ row, border }: { row: PickerRow; border: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={row.onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!row.selected }}
      style={({ pressed }) => [
        styles.row,
        border ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border } : null,
        {
          backgroundColor: row.selected ? theme.backgroundSelected : 'transparent',
          opacity: pressed ? Opacity.pressed : 1,
        },
      ]}
    >
      <ThemedText
        type={row.accent ? 'smallEmphasis' : 'label'}
        numberOfLines={1}
        style={[styles.rowLabel, row.accent ? { color: theme.accent } : null]}
      >
        {row.label}
      </ThemedText>
      <View style={styles.rowTrailing}>
        {row.selected ? (
          <ThemedText type="smallEmphasis" style={{ color: theme.accent }}>
            ✓
          </ThemedText>
        ) : null}
        {row.chevron ? (
          <ThemedText type="label" themeColor="textSecondary">
            ›
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Content-sized sheet: the sub-category step and the create form stay short instead of being
  // padded out to a fixed fraction; a long category list clamps at the cap and scrolls.
  safeArea: { flexShrink: 1 },
  header: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerAction: { minWidth: 56, minHeight: 32, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center' },
  headerSpacer: { width: 56 },
  subtitle: { textAlign: 'center', marginTop: Spacing.half },
  list: { marginTop: Spacing.two, flexShrink: 1 },
  listContent: { paddingBottom: Spacing.two },
  row: {
    minHeight: TouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  rowLabel: { flex: 1 },
  rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  addForm: { marginTop: Spacing.two, gap: Spacing.two },
  addRow: { flexDirection: 'row', gap: Spacing.two },
  input: {
    minHeight: TouchTarget,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  emojiInput: { width: 52, textAlign: 'center' },
  nameInput: { flex: 1 },
});
