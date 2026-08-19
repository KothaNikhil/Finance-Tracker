/**
 * A reusable editable list used on the Manage screen for categories, sub-categories, payment
 * modes and the "For" people list. Rows can be renamed inline or deleted, and a footer row adds a
 * new item. Reordering is done in a dedicated {@link ReorderSheet} (opened from the "Reorder"
 * button) — not inline — so this list is a plain, freely-scrollable set of rows. Categories opt
 * into an emoji field (`withEmoji`) and a tap target to drill into their sub-categories (`onOpen`).
 */

import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ReorderSheet } from '@/components/reorder-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface EditableItem {
  id: number;
  name: string;
  emoji?: string | null;
  /** Optional right-aligned hint, e.g. "4 sub-categories". */
  hint?: string;
}

export interface EditableListProps {
  items: EditableItem[];
  withEmoji?: boolean;
  addLabel: string;
  /** Shown in the reorder sheet header, e.g. "Categories". Defaults to `addLabel`. */
  reorderTitle?: string;
  onAdd: (name: string, emoji: string | null) => void;
  onRename: (id: number, name: string, emoji: string | null) => void;
  onDelete: (item: EditableItem) => void;
  /** New order as the full sequence of ids (from the reorder sheet). */
  onReorder: (orderedIds: number[]) => void;
  /** When set, tapping the row label drills in (e.g. to sub-categories). */
  onOpen?: (item: EditableItem) => void;
}

export function EditableList({
  items,
  withEmoji,
  addLabel,
  reorderTitle,
  onAdd,
  onRename,
  onDelete,
  onReorder,
  onOpen,
}: EditableListProps) {
  const theme = useTheme();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [reordering, setReordering] = useState(false);

  return (
    <View style={styles.wrap}>
      {items.length > 1 && (
        <View style={styles.listHeader}>
          <Pressable
            onPress={() => setReordering(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Reorder ${reorderTitle ?? addLabel}`}
          >
            <ThemedText type="smallBold" style={{ color: theme.accent }}>
              ⇅ Reorder
            </ThemedText>
          </Pressable>
        </View>
      )}

      {items.map((item) =>
        editingId === item.id ? (
          <ItemEditor
            key={item.id}
            withEmoji={withEmoji}
            initialName={item.name}
            initialEmoji={item.emoji ?? ''}
            submitLabel="Save"
            onCancel={() => setEditingId(null)}
            onSubmit={(name, emoji) => {
              onRename(item.id, name, emoji);
              setEditingId(null);
            }}
            theme={theme}
          />
        ) : (
          <Row
            key={item.id}
            item={item}
            withEmoji={withEmoji}
            onStartEdit={() => setEditingId(item.id)}
            onDelete={() => onDelete(item)}
            onOpen={onOpen ? () => onOpen(item) : undefined}
            theme={theme}
          />
        ),
      )}

      {items.length === 0 && !adding && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
          Nothing here yet — add your first below.
        </ThemedText>
      )}

      {adding ? (
        <ItemEditor
          withEmoji={withEmoji}
          initialName=""
          initialEmoji=""
          submitLabel="Add"
          onCancel={() => setAdding(false)}
          onSubmit={(name, emoji) => {
            onAdd(name, emoji);
            setAdding(false);
          }}
          theme={theme}
        />
      ) : (
        <Pressable
          onPress={() => setAdding(true)}
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          style={({ pressed }) => [styles.row, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}
        >
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            ＋  {addLabel}
          </ThemedText>
        </Pressable>
      )}

      <ReorderSheet
        visible={reordering}
        title={reorderTitle ?? addLabel}
        items={items}
        withEmoji={withEmoji}
        onClose={() => setReordering(false)}
        onReorder={onReorder}
      />
    </View>
  );
}

function Row({
  item,
  withEmoji,
  onStartEdit,
  onDelete,
  onOpen,
  theme,
}: {
  item: EditableItem;
  withEmoji?: boolean;
  onStartEdit: () => void;
  onDelete: () => void;
  onOpen?: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <ThemedView type="backgroundElement" style={[styles.row, styles.rowSpacing]}>
      <Pressable style={styles.rowMain} onPress={onOpen} disabled={!onOpen}>
        {withEmoji && <ThemedText type="default">{item.emoji || '🏷️'}</ThemedText>}
        <ThemedText type="default" numberOfLines={1} style={styles.rowName}>
          {item.name}
        </ThemedText>
        {item.hint && (
          <ThemedText type="small" themeColor="textSecondary">
            {item.hint}
          </ThemedText>
        )}
        {onOpen && (
          <ThemedText type="default" themeColor="textSecondary">
            ›
          </ThemedText>
        )}
      </Pressable>

      <View style={styles.actions}>
        <IconBtn label="Edit" accessibilityLabel={`Edit ${item.name}`} onPress={onStartEdit} color={theme.accent} />
        <IconBtn label="Delete" accessibilityLabel={`Delete ${item.name}`} onPress={onDelete} color={theme.spend} />
      </View>
    </ThemedView>
  );
}

function ItemEditor({
  withEmoji,
  initialName,
  initialEmoji,
  submitLabel,
  onCancel,
  onSubmit,
  theme,
}: {
  withEmoji?: boolean;
  initialName: string;
  initialEmoji: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (name: string, emoji: string | null) => void;
  theme: ReturnType<typeof useTheme>;
}) {
  const [name, setName] = useState(initialName);
  const [emoji, setEmoji] = useState(initialEmoji);

  const submit = () => {
    if (name.trim() === '') return;
    onSubmit(name.trim(), emoji.trim() || null);
  };

  return (
    <ThemedView type="backgroundElement" style={[styles.row, styles.rowSpacing]}>
      <View style={styles.editorInputs}>
        {withEmoji && (
          <TextInput
            value={emoji}
            onChangeText={setEmoji}
            placeholder="🏷️"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, styles.emojiInput, { color: theme.text, backgroundColor: theme.background }]}
          />
        )}
        <TextInput
          value={name}
          onChangeText={setName}
          autoFocus
          placeholder="Name"
          placeholderTextColor={theme.textSecondary}
          returnKeyType="done"
          onSubmitEditing={submit}
          style={[styles.input, styles.nameInput, { color: theme.text, backgroundColor: theme.background }]}
        />
      </View>
      <View style={styles.actions}>
        <IconBtn label={submitLabel} onPress={submit} color={theme.accent} disabled={name.trim() === ''} />
        <IconBtn label="Cancel" onPress={onCancel} color={theme.textSecondary} />
      </View>
    </ThemedView>
  );
}

function IconBtn({
  label,
  onPress,
  color,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  color: string;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
      style={styles.iconBtn}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <ThemedText type="smallBold" style={{ color, opacity: disabled ? 0.3 : 1 }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
  emptyHint: { paddingVertical: Spacing.one },
  listHeader: { flexDirection: 'row', justifyContent: 'flex-end', paddingBottom: Spacing.half },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 48,
  },
  rowSpacing: { marginBottom: Spacing.one },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flex: 1 },
  rowName: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  iconBtn: { paddingHorizontal: Spacing.one, paddingVertical: Spacing.one },
  editorInputs: { flexDirection: 'row', gap: Spacing.two, flex: 1 },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, fontSize: 15 },
  emojiInput: { width: 56, textAlign: 'center' },
  nameInput: { flex: 1 },
});
