/**
 * A reusable editable list used on the Manage screen for categories, sub-categories, payment
 * modes and the "For" people list. Each row can be reordered (↑/↓), renamed inline, or deleted;
 * a footer row adds a new item. Categories opt into an emoji field (`withEmoji`) and a tap
 * target to drill into their sub-categories (`onOpen`).
 */

import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const ACCENT = '#3c87f7';
const DANGER = '#e5484d';

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
  onAdd: (name: string, emoji: string | null) => void;
  onRename: (id: number, name: string, emoji: string | null) => void;
  onDelete: (item: EditableItem) => void;
  onMove: (id: number, dir: 'up' | 'down') => void;
  /** When set, tapping the row label drills in (e.g. to sub-categories). */
  onOpen?: (item: EditableItem) => void;
}

export function EditableList({
  items,
  withEmoji,
  addLabel,
  onAdd,
  onRename,
  onDelete,
  onMove,
  onOpen,
}: EditableListProps) {
  const theme = useTheme();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <View style={styles.wrap}>
      {items.map((item, i) => (
        <Row
          key={item.id}
          item={item}
          withEmoji={withEmoji}
          editing={editingId === item.id}
          isFirst={i === 0}
          isLast={i === items.length - 1}
          onStartEdit={() => setEditingId(item.id)}
          onCancelEdit={() => setEditingId(null)}
          onSave={(name, emoji) => {
            onRename(item.id, name, emoji);
            setEditingId(null);
          }}
          onDelete={() => onDelete(item)}
          onMove={(dir) => onMove(item.id, dir)}
          onOpen={onOpen ? () => onOpen(item) : undefined}
          theme={theme}
        />
      ))}

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
          style={({ pressed }) => [styles.row, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}
        >
          <ThemedText type="smallBold" style={{ color: ACCENT }}>
            ＋  {addLabel}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

function Row({
  item,
  withEmoji,
  editing,
  isFirst,
  isLast,
  onStartEdit,
  onCancelEdit,
  onSave,
  onDelete,
  onMove,
  onOpen,
  theme,
}: {
  item: EditableItem;
  withEmoji?: boolean;
  editing: boolean;
  isFirst: boolean;
  isLast: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (name: string, emoji: string | null) => void;
  onDelete: () => void;
  onMove: (dir: 'up' | 'down') => void;
  onOpen?: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  if (editing) {
    return (
      <ItemEditor
        withEmoji={withEmoji}
        initialName={item.name}
        initialEmoji={item.emoji ?? ''}
        submitLabel="Save"
        onCancel={onCancelEdit}
        onSubmit={onSave}
        theme={theme}
      />
    );
  }

  return (
    <ThemedView type="backgroundElement" style={styles.row}>
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
        <IconBtn label="↑" disabled={isFirst} onPress={() => onMove('up')} color={theme.text} />
        <IconBtn label="↓" disabled={isLast} onPress={() => onMove('down')} color={theme.text} />
        <IconBtn label="Edit" onPress={onStartEdit} color={ACCENT} />
        <IconBtn label="Delete" onPress={onDelete} color={DANGER} />
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
    <ThemedView type="backgroundElement" style={[styles.row, styles.editorRow]}>
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
        <IconBtn label={submitLabel} onPress={submit} color={ACCENT} disabled={name.trim() === ''} />
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
}: {
  label: string;
  onPress: () => void;
  color: string;
  disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6} style={styles.iconBtn}>
      <ThemedText type="smallBold" style={{ color, opacity: disabled ? 0.3 : 1 }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.one },
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
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flex: 1 },
  rowName: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  iconBtn: { paddingHorizontal: Spacing.half, paddingVertical: 2 },
  editorRow: { alignItems: 'center' },
  editorInputs: { flexDirection: 'row', gap: Spacing.two, flex: 1 },
  input: { borderRadius: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, fontSize: 15 },
  emojiInput: { width: 52, textAlign: 'center' },
  nameInput: { flex: 1 },
});
