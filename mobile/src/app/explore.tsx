/**
 * Manage screen (the second tab): edit the lists the rest of the app draws from —
 * categories and their nested sub-categories, payment modes, and the "For" people list.
 * Everything here is add / rename / reorder / delete; deletes keep history (a row still used
 * by a transaction is hidden rather than dropped — see the repository).
 */

import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EditableList, type EditableItem } from '@/components/editable-list';
import { SubcategoryManager } from '@/components/subcategory-manager';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useCategoryIndex, useLists } from '@/hooks/use-reference-data';
import {
  addCategory,
  addPaymentMode,
  addPerson,
  deleteCategory,
  deletePaymentMode,
  deletePerson,
  renameCategory,
  renamePaymentMode,
  renamePerson,
  reorderCategories,
  reorderPaymentModes,
  reorderPeople,
  setCategoryEmoji,
} from '@/services/db/repository';

export default function ManageScreen() {
  const [openCategoryId, setOpenCategoryId] = useState<number | null>(null);

  const index = useCategoryIndex();
  const lists = useLists();

  const categoryItems: EditableItem[] = index.categories.map((c) => ({
    id: c.id,
    name: c.name,
    emoji: c.emoji,
    hint: `${c.subcategories.length} sub${c.subcategories.length === 1 ? '' : 's'}`,
  }));

  const openCategory = openCategoryId != null ? index.byId.get(openCategoryId) ?? null : null;

  const confirmDelete = (kind: string, item: EditableItem, run: () => void) => {
    Alert.alert(
      `Delete “${item.name}”?`,
      `This removes the ${kind}. If it's still used by any transaction it's hidden from lists but kept in your history.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: run },
      ],
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle">Manage</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Edit your categories, payment modes and people. Changes apply to auto-categorization
            and the pickers.
          </ThemedText>

          <Section
            title="Categories"
            subtitle="Tap a category to edit its sub-categories."
          >
            <EditableList
              items={categoryItems}
              withEmoji
              addLabel="New category"
              onAdd={(name, emoji) => {
                addCategory(name, emoji);
              }}
              onRename={(id, name, emoji) => {
                renameCategory(id, name);
                setCategoryEmoji(id, emoji);
              }}
              onDelete={(item) => confirmDelete('category', item, () => deleteCategory(item.id))}
              onReorder={(ids) => reorderCategories(ids)}
              onOpen={(item) => setOpenCategoryId(item.id)}
            />
          </Section>

          <Section title="Payment modes">
            <EditableList
              items={lists.paymentModes}
              addLabel="New payment mode"
              onAdd={(name) => {
                addPaymentMode(name);
              }}
              onRename={(id, name) => {
                renamePaymentMode(id, name);
              }}
              onDelete={(item) => confirmDelete('payment mode', item, () => deletePaymentMode(item.id))}
              onReorder={(ids) => reorderPaymentModes(ids)}
            />
          </Section>

          <Section title="For (people)">
            <EditableList
              items={lists.people}
              addLabel="New person"
              onAdd={(name) => {
                addPerson(name);
              }}
              onRename={(id, name) => {
                renamePerson(id, name);
              }}
              onDelete={(item) => confirmDelete('person', item, () => deletePerson(item.id))}
              onReorder={(ids) => reorderPeople(ids)}
            />
          </Section>
        </ScrollView>
      </SafeAreaView>

      <SubcategoryManager category={openCategory} onClose={() => setOpenCategoryId(null)} />
    </ThemedView>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {subtitle && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionSubtitle}>
          {subtitle}
        </ThemedText>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.five,
    gap: Spacing.two,
  },
  section: { marginTop: Spacing.four, gap: Spacing.two },
  sectionSubtitle: { marginTop: -Spacing.one },
});
