/**
 * A reusable editable list used on the Manage screen for categories, sub-categories, payment
 * modes and the "For" people list. Rows can be reordered by long-press-and-drag, renamed
 * inline, or deleted; a footer row adds a new item. Categories opt into an emoji field
 * (`withEmoji`) and a tap target to drill into their sub-categories (`onOpen`).
 */

import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import DraggableFlatList, {
  ScaleDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';

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
  /** New order as the full sequence of ids (from a drag). */
  onReorder: (orderedIds: number[]) => void;
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
  onReorder,
  onOpen,
}: EditableListProps) {
  const theme = useTheme();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const renderItem = ({ item, drag, isActive }: RenderItemParams<EditableItem>) => {
    if (editingId === item.id) {
      return (
        <ItemEditor
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
      );
    }
    return (
      <ScaleDecorator activeScale={1.03}>
        <Row
          item={item}
          withEmoji={withEmoji}
          isActive={isActive}
          onDrag={drag}
          onStartEdit={() => setEditingId(item.id)}
          onDelete={() => onDelete(item)}
          onOpen={onOpen ? () => onOpen(item) : undefined}
          theme={theme}
        />
      </ScaleDecorator>
    );
  };

  return (
    <View style={styles.wrap}>
      <DraggableFlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        onDragEnd={({ data }) => onReorder(data.map((d) => d.id))}
        scrollEnabled={false}
        activationDistance={12}
        containerStyle={styles.listContainer}
      />

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
  isActive,
  onDrag,
  onStartEdit,
  onDelete,
  onOpen,
  theme,
}: {
  item: EditableItem;
  withEmoji?: boolean;
  isActive: boolean;
  onDrag: () => void;
  onStartEdit: () => void;
  onDelete: () => void;
  onOpen?: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.row, styles.rowSpacing, isActive && { backgroundColor: theme.backgroundSelected }]}
    >
      {/* Long-press the grip (or the row) to drag. */}
      <Pressable onLongPress={onDrag} delayLongPress={200} hitSlop={6} style={styles.grip}>
        <ThemedText type="default" themeColor="textSecondary">
          ⋮⋮
        </ThemedText>
      </Pressable>

      <Pressable style={styles.rowMain} onPress={onOpen} onLongPress={onDrag} delayLongPress={200} disabled={!onOpen}>
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
  listContainer: {},
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
  grip: { paddingRight: Spacing.one, paddingVertical: Spacing.one },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flex: 1 },
  rowName: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  iconBtn: { paddingHorizontal: Spacing.half, paddingVertical: 2 },
  editorInputs: { flexDirection: 'row', gap: Spacing.two, flex: 1 },
  input: { borderRadius: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, fontSize: 15 },
  emojiInput: { width: 52, textAlign: 'center' },
  nameInput: { flex: 1 },
});
