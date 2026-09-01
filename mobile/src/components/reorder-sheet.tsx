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

import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { InfoDisclosure } from '@/components/info-disclosure';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
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

const REORDER_HINT = 'Long-press a row and drag to reorder. Changes save as you go.';

/**
 * A virtualized list needs a bounded viewport, so the sheet cannot simply hug its content. Rows are
 * a fixed height and reordering only permutes them, so the row count gives an exact content height
 * that is stable for the whole of a drag. Long lists fall back to a fraction of the screen.
 */
const ROW_HEIGHT = 44;
const ROW_GAP = Spacing.one;
const MAX_LIST_FRACTION = 0.6;

const listHeightFor = (rowCount: number) =>
  Math.min(
    Math.max(rowCount, 1) * (ROW_HEIGHT + ROW_GAP),
    Math.round(Dimensions.get('window').height * MAX_LIST_FRACTION),
  );

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

  const move = (itemId: number, delta: -1 | 1) => {
    const from = draft.findIndex((item) => item.id === itemId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= draft.length) return;
    const data = [...draft];
    const [moved] = data.splice(from, 1);
    data.splice(to, 0, moved);
    commit(data);
  };

  const revert = () => {
    setDraft(initial);
    onReorder(initial.map((d) => d.id));
  };

  const changed = !sameOrder(draft, initial);

  const renderItem = ({ item, drag, isActive }: RenderItemParams<EditableItem>) => {
    const position = draft.findIndex((candidate) => candidate.id === item.id);
    return (
      <ScaleDecorator activeScale={1.03}>
        <Pressable
          onLongPress={drag}
          delayLongPress={150}
          disabled={isActive}
          accessibilityRole="adjustable"
          accessibilityLabel={`Reorder ${item.name}`}
          accessibilityHint="Long-press and drag, or swipe up and down with a screen reader"
          accessibilityState={{ disabled: isActive }}
          accessibilityValue={{
            min: 1,
            max: draft.length,
            now: position + 1,
            text: `${position + 1} of ${draft.length}`,
          }}
          accessibilityActions={[
            { name: 'decrement', label: `Move ${item.name} up` },
            { name: 'increment', label: `Move ${item.name} down` },
          ]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'decrement') move(item.id, -1);
            if (event.nativeEvent.actionName === 'increment') move(item.id, 1);
          }}
          style={[
            styles.row,
            {
              backgroundColor: isActive ? theme.backgroundSelected : theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
        >
          <SymbolView
            name={{ ios: 'line.3.horizontal', android: 'drag_handle', web: 'drag_handle' }}
            size={18}
            tintColor={theme.textSecondary}
          />
          {withEmoji && <ThemedText type="default">{item.emoji || '🏷️'}</ThemedText>}
          <ThemedText type="label" numberOfLines={1} style={styles.name}>
            {item.name}
          </ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {position + 1}
          </ThemedText>
        </Pressable>
      </ScaleDecorator>
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} gestureRoot>
      <SafeAreaView edges={['bottom']} style={styles.sheetBody}>
        <View style={styles.header}>
          <InfoDisclosure label="How to reorder this list" text={REORDER_HINT} style={styles.grow}>
            <ThemedText type="smallEmphasis" numberOfLines={1}>
              Reorder · {title}
            </ThemedText>
          </InfoDisclosure>
          <Pressable onPress={onClose} hitSlop={14}>
            <ThemedText type="link" themeColor="textSecondary">
              Close
            </ThemedText>
          </Pressable>
        </View>
        <DraggableFlatList
          data={draft}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          onDragEnd={({ data }) => commit(data)}
          contentContainerStyle={styles.listContent}
          containerStyle={{ height: listHeightFor(draft.length) }}
          style={styles.grow}
        />
        <Button
          label="Revert to previous order"
          variant="secondary"
          onPress={revert}
          disabled={!changed}
          style={styles.revertButton}
        />
      </SafeAreaView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  sheetBody: { flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.two },
  listContent: { gap: Spacing.one, paddingBottom: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    height: ROW_HEIGHT,
  },
  name: { flex: 1 },
  revertButton: { marginBottom: Spacing.two },
});
