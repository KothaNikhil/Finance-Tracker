/**
 * Manage screen (the second tab): edit the lists the rest of the app draws from —
 * categories and their nested sub-categories, payment modes, and the "For" people list.
 * Everything here is add / rename / reorder / delete; deletes keep history (a row still used
 * by a transaction is hidden rather than dropped — see the repository).
 */

import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { EditableList, type EditableItem } from '@/components/editable-list';
import { SubcategoryManager } from '@/components/subcategory-manager';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useBusyAction } from '@/hooks/use-busy-action';
import { useCategoryIndex, useLists } from '@/hooks/use-reference-data';
import { restoreFromPickedFile, saveBackupToFolder, shareBackup } from '@/services/backup';
import { backupToDrive, restoreLatestFromDrive } from '@/services/drive';
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

          <BackupSection />
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

/**
 * Back up all data to a `.db` file (save to the device or share — e.g. drop it in Google Drive),
 * and restore from a backup file. Restore is destructive, so it's behind a confirm.
 */
function BackupSection() {
  const { busy, run } = useBusyAction();
  const driveEnabled = Platform.OS !== 'web';

  const onBackup = useCallback(() => {
    const options = [
      {
        text: 'Save to a folder',
        onPress: () =>
          run(async () => {
            const res = await saveBackupToFolder();
            if (res.saved) Alert.alert('Backed up', `Saved ${res.fileName} to the folder you chose.`);
          }),
      },
      {
        text: 'Share…',
        onPress: () =>
          run(async () => {
            await shareBackup();
          }),
      },
    ];
    if (driveEnabled) {
      options.push({
        text: 'Google Drive',
        onPress: () =>
          run(async () => {
            const res = await backupToDrive();
            if (res.done) {
              Alert.alert('Backed up to Drive', `Saved ${res.fileName} to your Google Drive (${res.account}).`);
            }
          }),
      });
    }
    Alert.alert('Back up', 'Save your data as a backup file, or send it to Google Drive.', [
      ...options,
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [run, driveEnabled]);

  const onRestore = useCallback(() => {
    Alert.alert(
      'Restore from a file?',
      'This replaces ALL current data in the app with the contents of the backup file you pick. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Choose file & restore',
          style: 'destructive',
          onPress: () =>
            run(async () => {
              const res = await restoreFromPickedFile();
              if (res.restored) Alert.alert('Restored', 'Your data was restored from the backup.');
            }),
        },
      ],
    );
  }, [run]);

  const onRestoreDrive = useCallback(() => {
    Alert.alert(
      'Restore latest from Drive?',
      'This finds your most recent Google Drive backup and replaces ALL current data with it. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore latest',
          style: 'destructive',
          onPress: () =>
            run(async () => {
              const res = await restoreLatestFromDrive();
              if (!res.found) {
                Alert.alert('No backup found', 'There are no Finance Tracker backups in your Google Drive yet.');
              } else if (res.restored) {
                Alert.alert('Restored', `Restored ${res.fileName} from your Google Drive.`);
              }
            }),
        },
      ],
    );
  }, [run]);

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Backup &amp; restore</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.sectionSubtitle}>
        Save a backup file of everything in the app (keep it safe in Google Drive), or restore from
        one. Restoring replaces all current data.
      </ThemedText>

      <View style={styles.backupButtons}>
        <Button label="Back up" variant="primary" onPress={onBackup} disabled={busy} />
      </View>
      <View style={styles.backupButtons}>
        <Button label="Restore from file" onPress={onRestore} disabled={busy} />
        {driveEnabled && (
          <Button label="Restore from Drive" onPress={onRestoreDrive} disabled={busy} />
        )}
      </View>
      {busy && <ActivityIndicator style={{ marginTop: Spacing.two }} />}
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
  backupButtons: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
});
