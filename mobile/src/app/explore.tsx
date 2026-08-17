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
import { ConfirmDeleteModal } from '@/components/confirm-delete-modal';
import { EditableList, type EditableItem } from '@/components/editable-list';
import { SubcategoryManager } from '@/components/subcategory-manager';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useBusyAction } from '@/hooks/use-busy-action';
import { useCategoryIndex, useLists } from '@/hooks/use-reference-data';
import { signOut } from '@/services/auth/auth';
import { restoreFromPickedFile, saveBackupToFolder, shareBackup } from '@/services/backup';
import { backupToDrive, restoreLatestFromDrive } from '@/services/drive';
import {
  addCategory,
  addPaymentMode,
  addPerson,
  clearAllTransactions,
  deleteCategory,
  deletePaymentMode,
  deletePerson,
  getAllTransactions,
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
          <DangerSection />
          <AccountSection />
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
        <Button label="Back up" variant="primary" onPress={onBackup} disabled={busy} style={styles.grow} />
      </View>
      <View style={styles.backupButtons}>
        <Button label="Restore from file" onPress={onRestore} disabled={busy} style={styles.grow} />
        {driveEnabled && (
          <Button label="Restore from Drive" onPress={onRestoreDrive} disabled={busy} style={styles.grow} />
        )}
      </View>
      {busy && <ActivityIndicator style={{ marginTop: Spacing.two }} />}
    </View>
  );
}

/**
 * "Delete all data" — the one destructive, irreversible action, deliberately behind a type-DELETE
 * modal and placed next to Backup so the user is one tap from saving first. Categories/lists are
 * kept; only transactions are removed.
 */
function DangerSection() {
  const { busy, run } = useBusyAction();
  const driveEnabled = Platform.OS !== 'web';
  const [modalVisible, setModalVisible] = useState(false);
  const [count, setCount] = useState(0);

  const onOpen = useCallback(() => {
    setCount(getAllTransactions().length);
    setModalVisible(true);
  }, []);

  const onBackupFirst = useCallback(
    () =>
      run(async () => {
        const res = await backupToDrive();
        if (res.done) Alert.alert('Backed up to Drive', `Saved ${res.fileName} to your Google Drive (${res.account}).`);
      }),
    [run],
  );

  const onConfirm = useCallback(
    () =>
      run(async () => {
        clearAllTransactions();
        setModalVisible(false);
        Alert.alert('Deleted', 'All transactions were removed from this device.');
      }),
    [run],
  );

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Danger zone</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.sectionSubtitle}>
        Permanently delete every transaction on this device. Your categories and lists are kept.
        Back up first if you might want the data later.
      </ThemedText>
      <View style={styles.backupButtons}>
        <Button label="Delete all data" variant="danger" onPress={onOpen} disabled={busy} style={styles.grow} />
      </View>

      <ConfirmDeleteModal
        visible={modalVisible}
        count={count}
        busy={busy}
        onCancel={() => setModalVisible(false)}
        onConfirm={onConfirm}
        onBackupFirst={driveEnabled ? onBackupFirst : undefined}
      />
    </View>
  );
}

/** Shows the signed-in account + a sign-out button — only when login is configured and active. */
function AccountSection() {
  const { session, configured } = useAuth();
  const { busy, run } = useBusyAction();
  const driveEnabled = Platform.OS !== 'web';

  const onSignOut = useCallback(
    () =>
      run(
        async () => {
          // Back up to Drive first so data isn't stranded when this device signs out. If it fails
          // (offline, Drive error, sign-in cancelled), block the sign-out and tell the user to back
          // up manually — never sign out with unsaved data on a device that may then be wiped.
          if (driveEnabled) {
            let backedUp = false;
            try {
              backedUp = (await backupToDrive()).done;
            } catch {
              backedUp = false;
            }
            if (!backedUp) {
              Alert.alert(
                'Back up before signing out',
                'We couldn’t back up your data to Google Drive automatically. Tap “Back up” above to ' +
                  'save it (Google Drive, or Save to a folder), then sign out — so nothing is lost.',
              );
              return; // stay signed in
            }
          }
          await signOut();
        },
        { errorTitle: 'Could not sign out' },
      ),
    [run, driveEnabled],
  );

  if (!configured || !session) return null;

  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">Account</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.sectionSubtitle}>
        Signed in as {session.user.email ?? 'your account'}. Signing out backs up to Drive first.
      </ThemedText>
      <View style={styles.backupButtons}>
        <Button label="Sign out" onPress={onSignOut} disabled={busy} style={styles.grow} />
      </View>
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
  grow: { flex: 1 },
});
