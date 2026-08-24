/**
 * Full-screen sheet for managing one category's sub-categories (opened from the Manage screen).
 * Reuses EditableList for add / rename / reorder / delete. The parent drives `category` from a
 * live query, so edits here re-render the list automatically — no manual refresh needed.
 */

import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EditableList, type EditableItem } from '@/components/editable-list';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import type { CategoryRef } from '@/core/categorize';
import {
  addSubcategory,
  deleteSubcategory,
  renameSubcategory,
  reorderSubcategories,
} from '@/services/db/repository';

export interface SubcategoryManagerProps {
  category: CategoryRef | null;
  onClose: () => void;
}

export function SubcategoryManager({ category, onClose }: SubcategoryManagerProps) {
  const items: EditableItem[] = (category?.subcategories ?? []).map((s) => ({ id: s.id, name: s.name }));

  return (
    <Modal visible={category !== null} animationType="slide" onRequestClose={onClose}>
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={8}>
              <ThemedText type="link" themeColor="textSecondary">
                ‹ Done
              </ThemedText>
            </Pressable>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.headerTitle}>
              {category ? `${category.emoji ? category.emoji + ' ' : ''}${category.name}` : ''}
            </ThemedText>
            <View style={styles.headerSpacer} />
          </View>

          {/* iOS uses the ScrollView's own keyboard insets; Android is edge-to-edge (no window
              resize), so shrink the scroll area to keep the edited sub-category visible. */}
          <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'android' ? 'height' : undefined}>
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
            >
            <ThemedText type="smallBold">Sub-categories</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Suggestions shown when you categorize a transaction in this category.
            </ThemedText>

            {category && (
              <EditableList
                items={items}
                addLabel="New sub-category"
                onAdd={(name) => addSubcategory(category.id, name)}
                onRename={(id, name) => renameSubcategory(id, name)}
                onDelete={(item) =>
                  Alert.alert(
                    `Delete “${item.name}”?`,
                    "If it's used by any transaction it's hidden but kept in your history.",
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => deleteSubcategory(item.id) },
                    ],
                  )
                }
                onReorder={(ids) => reorderSubcategories(ids)}
              />
            )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fill: { flex: 1 },
  safeArea: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headerTitle: { flex: 1, textAlign: 'center' },
  headerSpacer: { width: 48 },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, gap: Spacing.two },
});
