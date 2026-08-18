/**
 * A dedicated "reorder" bottom sheet holding a single {@link DraggableFlatList}. Reordering lives
 * here (rather than inline on the Manage screen) because a draggable list nested inside a scroll
 * view fights it for the vertical gesture — you can't reliably scroll, and on the New Architecture
 * the nested variant misplaces the dropped row. As the sole scroller in its own sheet, the list
 * both scrolls and drags cleanly.
 *
 * Each drag is applied immediately (there's no "save" step); a "Revert to previous order" button
 * restores the order as it was when the sheet opened.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { EditableItem } from '@/components/editable-list';

export interface ReorderSheetProps {
  visible: boolean;
  /** Shown in the header, e.g. "Categories". */
  title: string;
  items: EditableItem[];
  withEmoji?: boolean;
  onClose: () => void;
  /** Persist a new order (called live on every drag, and on revert). */
  onReorder: (orderedIds: number[]) => void;
}

const sameOrder = (a: EditableItem[], b: EditableItem[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i]?.id);

export function ReorderSheet({ visible, title, items, withEmoji, onClose, onReorder }: ReorderSheetProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState<EditableItem[]>(items);
  // The order captured when the sheet opened, so "Revert" can restore it.
  const [initial, setInitial] = useState<EditableItem[]>(items);

  const [seeded, setSeeded] = useState(false);
  if (visible && !seeded) {
    setSeeded(true);
    setDraft(items);
    setInitial(items);
  } else if (!visible && seeded) {
    setSeeded(false);
  }

  // Apply each drag immediately — no explicit save step.
  const commit = (data: EditableItem[]) => {
    setDraft(data);
    onReorder(data.map((d) => d.id));
  };

  const revert = () => {
    setDraft(initial);
    onReorder(initial.map((d) => d.id));
  };

  const changed = !sameOrder(draft, initial);

  const renderItem = ({ item, drag, isActive }: RenderItemParams<EditableItem>) => (
    <ScaleDecorator activeScale={1.03}>
      <Pressable
        onLongPress={drag}
        delayLongPress={150}
        disabled={isActive}
        accessibilityRole="button"
        accessibilityLabel={`Drag to reorder ${item.name}`}
        style={[
          styles.row,
          { backgroundColor: isActive ? theme.backgroundSelected : theme.backgroundElement },
        ]}
      >
        <ThemedText type="default" themeColor="textSecondary">⋮⋮</ThemedText>
        {withEmoji && <ThemedText type="default">{item.emoji || '🏷️'}</ThemedText>}
        <ThemedText type="default" numberOfLines={1} style={styles.name}>
          {item.name}
        </ThemedText>
      </Pressable>
    </ScaleDecorator>
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} heightFraction={0.85} gestureRoot>
      <SafeAreaView edges={['bottom']} style={styles.grow}>
        <View style={styles.header}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.grow}>
            Reorder · {title}
          </ThemedText>
          <Pressable onPress={onClose} hitSlop={8}>
            <ThemedText type="link" themeColor="textSecondary">
              Close
            </ThemedText>
          </Pressable>
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          Long-press a row and drag to reorder. Changes save as you go.
        </ThemedText>
        <DraggableFlatList
          data={draft}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          onDragEnd={({ data }) => commit(data)}
          contentContainerStyle={styles.listContent}
          containerStyle={styles.grow}
          style={styles.grow}
        />
        <Button
          label="Revert to previous order"
          variant="secondary"
          onPress={revert}
          disabled={!changed}
        />
      </SafeAreaView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.one },
  hint: { marginBottom: Spacing.two },
  listContent: { gap: Spacing.one, paddingBottom: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    minHeight: 52,
  },
  name: { flex: 1 },
});
