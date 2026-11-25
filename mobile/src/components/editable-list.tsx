/**
 * A reusable editable list used in Settings for categories, subcategories, payment
 * modes and the "For" people list. Rows can be renamed inline or deleted, and a footer row adds a
 * new item. Reordering is done in a dedicated {@link ReorderSheet} (opened from the "Reorder"
 * button) — not inline — so this list is a plain, freely-scrollable set of rows. Categories opt
 * into an emoji field (`withEmoji`) and a tap target to drill into their subcategories (`onOpen`).
 */

import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { IconButton } from '@/components/icon-button';
import { ReorderSheet } from '@/components/reorder-sheet';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ViewOnlyHint } from '@/components/view-only-hint';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useViewOnly } from '@/services/drive/edit-session';

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
  // View only: the list stays readable (and categories still open), but add / rename / delete /
  // reorder are disabled.
  const viewOnly = useViewOnly();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [reordering, setReordering] = useState(false);

  return (
    <View style={styles.wrap}>
      {items.length > 1 && (
        <Button
          label="Reorder"
          variant="ghost"
          size="small"
          icon={{ ios: 'arrow.up.arrow.down', android: 'swap_vert', web: 'swap_vert' }}
          onPress={() => setReordering(true)}
          disabled={viewOnly}
          accessibilityLabel={`Reorder ${reorderTitle ?? addLabel}`}
          style={styles.reorderButton}
        />
      )}

      <Card padding="none">
        {items.map((item, index) =>
          editingId === item.id && !viewOnly ? (
            <ItemEditor
              key={item.id}
              withEmoji={withEmoji}
              initialName={item.name}
              initialEmoji={item.emoji ?? ''}
              submitLabel="Save"
              divided={index > 0}
              dividerColor={theme.border}
              onCancel={() => setEditingId(null)}
              onSubmit={(name, emoji) => {
                onRename(item.id, name, emoji);
                setEditingId(null);
              }}
            />
          ) : (
            <Row
              key={item.id}
              item={item}
              withEmoji={withEmoji}
              divided={index > 0}
              dividerColor={theme.border}
              onStartEdit={() => setEditingId(item.id)}
              onDelete={() => onDelete(item)}
              onOpen={onOpen ? () => onOpen(item) : undefined}
              disabled={viewOnly}
              theme={theme}
            />
          ),
        )}

        {items.length === 0 && !adding ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
            Nothing here yet — add your first below.
          </ThemedText>
        ) : null}

        {adding && !viewOnly ? (
          <ItemEditor
            withEmoji={withEmoji}
            initialName=""
            initialEmoji=""
            submitLabel="Add"
            divided={items.length > 0}
            dividerColor={theme.border}
            onCancel={() => setAdding(false)}
            onSubmit={(name, emoji) => {
              onAdd(name, emoji);
              setAdding(false);
            }}
          />
        ) : null}
      </Card>

      {!adding || viewOnly ? (
        <Button
          label={addLabel}
          variant="secondary"
          icon={{ ios: 'plus', android: 'add', web: 'add' }}
          onPress={() => setAdding(true)}
          disabled={viewOnly}
        />
      ) : null}
      {viewOnly ? <ViewOnlyHint /> : null}

      <ReorderSheet
        visible={reordering && !viewOnly}
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
  divided,
  dividerColor,
  onStartEdit,
  onDelete,
  onOpen,
  disabled = false,
  theme,
}: {
  item: EditableItem;
  withEmoji?: boolean;
  divided: boolean;
  dividerColor: string;
  onStartEdit: () => void;
  onDelete: () => void;
  onOpen?: () => void;
  disabled?: boolean;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={[styles.row, divided && styles.divided, divided && { borderTopColor: dividerColor }]}>
      <Pressable
        style={styles.rowMain}
        onPress={onOpen}
        disabled={!onOpen}
        accessibilityRole={onOpen ? 'button' : undefined}
        accessibilityLabel={onOpen ? `${item.name}${item.hint ? `, ${item.hint}` : ''}` : undefined}
        accessibilityHint={onOpen ? 'Open subcategory settings' : undefined}
      >
        {withEmoji && <ThemedText type="default">{item.emoji || '🏷️'}</ThemedText>}
        <ThemedText type="label" numberOfLines={1} style={styles.rowName}>
          {item.name}
        </ThemedText>
        {item.hint && (
          <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
            {item.hint}
          </ThemedText>
        )}
        {onOpen && (
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={16}
            tintColor={theme.textSecondary}
          />
        )}
      </Pressable>

      <View style={styles.actions}>
        <IconButton
          name={{ ios: 'pencil', android: 'edit', web: 'edit' }}
          label={`Edit ${item.name}`}
          onPress={onStartEdit}
          variant="plain"
          disabled={disabled}
        />
        <IconButton
          name={{ ios: 'trash', android: 'delete', web: 'delete' }}
          label={`Delete ${item.name}`}
          onPress={onDelete}
          variant="danger"
          disabled={disabled}
        />
      </View>
    </View>
  );
}

function ItemEditor({
  withEmoji,
  initialName,
  initialEmoji,
  submitLabel,
  divided,
  dividerColor,
  onCancel,
  onSubmit,
}: {
  withEmoji?: boolean;
  initialName: string;
  initialEmoji: string;
  submitLabel: string;
  divided: boolean;
  dividerColor: string;
  onCancel: () => void;
  onSubmit: (name: string, emoji: string | null) => void;
}) {
  const [name, setName] = useState(initialName);
  const [emoji, setEmoji] = useState(initialEmoji);

  const submit = () => {
    if (name.trim() === '') return;
    onSubmit(name.trim(), emoji.trim() || null);
  };

  return (
    <View style={[styles.row, divided && styles.divided, divided && { borderTopColor: dividerColor }]}>
      <View style={styles.editorInputs}>
        {withEmoji && (
          <TextField
            value={emoji}
            onChangeText={setEmoji}
            placeholder="🏷️"
            accessibilityLabel="Category emoji"
            containerStyle={styles.emojiField}
            inputStyle={styles.emojiInput}
          />
        )}
        <TextField
          value={name}
          onChangeText={setName}
          autoFocus
          placeholder="Name"
          accessibilityLabel="Name"
          returnKeyType="done"
          onSubmitEditing={submit}
          containerStyle={styles.nameField}
        />
      </View>
      <View style={styles.actions}>
        <IconButton
          name={{ ios: 'checkmark', android: 'check', web: 'check' }}
          label={submitLabel}
          onPress={submit}
          variant="accent"
          disabled={name.trim() === ''}
        />
        <IconButton
          name={{ ios: 'xmark', android: 'close', web: 'close' }}
          label="Cancel"
          onPress={onCancel}
          variant="plain"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  reorderButton: { alignSelf: 'flex-end' },
  emptyHint: { padding: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    minHeight: 48,
  },
  divided: { borderTopWidth: StyleSheet.hairlineWidth },
  rowMain: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: Spacing.one,
  },
  rowName: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  editorInputs: { flexDirection: 'row', gap: Spacing.two, flex: 1, minWidth: 0 },
  emojiField: { width: 60 },
  emojiInput: { paddingHorizontal: 0, textAlign: 'center' },
  nameField: { flex: 1, minWidth: 80 },
});
