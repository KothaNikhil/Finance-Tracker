/**
 * Full-screen view for managing one category's subcategories (opened from Settings).
 * Reuses EditableList for add / rename / reorder / delete. The parent drives `category` from a
 * live query, so edits here re-render the list automatically — no manual refresh needed.
 */

import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { EditableList, type EditableItem } from '@/components/editable-list';
import { ScreenHeader } from '@/components/screen-header';
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
    <Modal
      visible={category !== null}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <Button
              label="Categories"
              accessibilityLabel="Back to Categories"
              variant="ghost"
              size="small"
              icon={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
              onPress={onClose}
              style={styles.backButton}
            />
            <ScreenHeader
              title={category ? `${category.emoji ? `${category.emoji} ` : ''}${category.name}` : ''}
              subtitle="Suggestions shown when categorizing a transaction."
              compact
            />
          </View>

          {/* iOS uses the ScrollView's own keyboard insets; Android is edge-to-edge (no window
              resize), so shrink the scroll area to keep the edited sub-category visible. */}
          <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'android' ? 'height' : undefined}>
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              automaticallyAdjustKeyboardInsets
              showsVerticalScrollIndicator={false}
            >
              {category && (
                <EditableList
                  items={items}
                  addLabel="New subcategory"
                  reorderTitle={`${category.name} subcategories`}
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
                  onReorder={reorderSubcategories}
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
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.one,
  },
  backButton: { alignSelf: 'flex-start', marginLeft: -Spacing.two },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
  },
});
