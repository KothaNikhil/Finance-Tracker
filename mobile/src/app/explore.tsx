/**
 * Settings landing and focused management views. Reference-data deletions remain history-safe:
 * rows still used by transactions are archived by the repository instead of being dropped.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ConfirmDeleteModal } from '@/components/confirm-delete-modal';
import { EditableList, type EditableItem } from '@/components/editable-list';
import { InfoDisclosure } from '@/components/info-disclosure';
import { ScreenHeader } from '@/components/screen-header';
import { SegmentedControl } from '@/components/segmented-control';
import {
  SettingsGroup,
  SettingsLanding,
  type SettingsRowDefinition,
} from '@/components/settings-landing';
import { SubcategoryManager } from '@/components/subcategory-manager';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAppLock } from '@/hooks/use-app-lock';
import { useAuth } from '@/hooks/use-auth';
import { useBusyAction } from '@/hooks/use-busy-action';
import { useCategoryIndex, useLists } from '@/hooks/use-reference-data';
import { useThemePreference, type ThemeMode } from '@/hooks/use-theme-preference';
import { signOut } from '@/services/auth/auth';
import { restoreFromPickedFile, saveBackupToFolder, shareBackup } from '@/services/backup';
import { backupToDrive, driveAvailable, restoreLatestFromDrive } from '@/services/drive';
import {
  addCategory,
  addPaymentMode,
  addPerson,
  clearAllTransactions,
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
import { getDb } from '@/services/db/database';
import { txnCountQuery } from '@/services/db/queries/transactions';

type SettingsPanel = 'categories' | 'payment-modes' | 'people' | 'appearance' | 'backup' | 'account';

// Subtitles are single-line by design; keep each short enough to read whole on a phone.
const PANEL_COPY: Record<SettingsPanel, { title: string; subtitle: string }> = {
  categories: {
    title: 'Categories',
    subtitle: 'Rename, reorder, delete, or open one for its subcategories.',
  },
  'payment-modes': {
    title: 'Payment modes',
    subtitle: 'The payment choices used by transaction pickers.',
  },
  people: {
    title: 'People & groups',
    subtitle: 'Used in “For” pickers and in lending.',
  },
  appearance: {
    title: 'Appearance',
    subtitle: 'Light, dark, or follow your phone’s system setting.',
  },
  backup: {
    title: 'Backup & restore',
    subtitle: 'Restoring replaces all current data.',
  },
  account: {
    title: 'Account',
    subtitle: 'Review your signed-in account and sign out safely.',
  },
};

const ACTION_ICONS = {
  folder: { ios: 'folder', android: 'folder', web: 'folder' },
  share: { ios: 'square.and.arrow.up', android: 'share', web: 'share' },
  drive: { ios: 'icloud.and.arrow.up', android: 'cloud_upload', web: 'cloud_upload' },
  restoreFile: { ios: 'doc.badge.arrow.up', android: 'upload_file', web: 'upload_file' },
  restoreDrive: { ios: 'icloud.and.arrow.down', android: 'cloud_download', web: 'cloud_download' },
} satisfies Record<string, SettingsRowDefinition['icon']>;

export default function SettingsScreen() {
  const [activePanel, setActivePanel] = useState<SettingsPanel | null>(null);
  const [openCategoryId, setOpenCategoryId] = useState<number | null>(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteCount, setDeleteCount] = useState(0);

  const index = useCategoryIndex();
  const lists = useLists();
  const auth = useAuth();
  const lock = useAppLock();
  const { mode, setMode } = useThemePreference();
  const { busy: deleteBusy, run: runDelete } = useBusyAction();
  const driveEnabled = driveAvailable();
  const accountEmail =
    auth.configured && auth.session ? (auth.session.user.email ?? 'your account') : undefined;

  const categoryItems: EditableItem[] = index.categories.map((c) => ({
    id: c.id,
    name: c.name,
    emoji: c.emoji,
    hint: `${c.subcategories.length} subcategor${c.subcategories.length === 1 ? 'y' : 'ies'}`,
  }));

  const openCategory = openCategoryId != null ? index.byId.get(openCategoryId) ?? null : null;

  useEffect(() => {
    if (activePanel === null || openCategoryId !== null) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setActivePanel(null);
      return true;
    });
    return () => subscription.remove();
  }, [activePanel, openCategoryId]);

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

  const openDeleteModal = useCallback(() => {
    setDeleteCount(txnCountQuery(getDb(), {}).get()?.n ?? 0);
    setDeleteModalVisible(true);
  }, []);

  const backupBeforeDelete = useCallback(() => {
    void runDelete(async () => {
      const res = await backupToDrive();
      if (res.done) {
        const account = res.account ? ` (${res.account})` : '';
        Alert.alert('Backed up to Drive', `Saved ${res.fileName} to your Google Drive${account}.`);
      }
    });
  }, [runDelete]);

  const confirmDeleteAll = useCallback(() => {
    void runDelete(async () => {
      clearAllTransactions();
      setDeleteModalVisible(false);
      Alert.alert('Deleted', 'All transactions were removed from this device.');
    });
  }, [runDelete]);

  const closeFocusedPanel = useCallback(() => {
    setOpenCategoryId(null);
    setActivePanel(null);
  }, []);

  const panelCopy = activePanel ? PANEL_COPY[activePanel] : null;
  const appearanceLabel = THEME_OPTIONS.find((option) => option.value === mode)?.label ?? 'System';
  const appLockLabel = !lock.ready ? 'Checking…' : lock.enabled ? 'Protected' : 'Unavailable';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* iOS uses the ScrollView's own keyboard insets; Android is edge-to-edge (no window resize),
            so shrink the scroll area with a KeyboardAvoidingView to keep the edited row visible. */}
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'android' ? 'height' : undefined}>
          <ScrollView
            key={activePanel ?? 'landing'}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            showsVerticalScrollIndicator={false}
          >
            {activePanel === null ? (
              <SettingsLanding
                categoryCount={categoryItems.length}
                paymentModeCount={lists.paymentModes.length}
                peopleCount={lists.people.length}
                appearanceLabel={appearanceLabel}
                appLockLabel={appLockLabel}
                accountEmail={accountEmail}
                driveEnabled={driveEnabled}
                onOpenCategories={() => setActivePanel('categories')}
                onOpenPaymentModes={() => setActivePanel('payment-modes')}
                onOpenPeople={() => setActivePanel('people')}
                onOpenAppearance={() => setActivePanel('appearance')}
                onOpenBackup={() => setActivePanel('backup')}
                onOpenAccount={
                  accountEmail
                    ? () => {
                        setActivePanel('account');
                      }
                    : undefined
                }
                onDeleteAll={openDeleteModal}
              />
            ) : (
              <>
                <FocusedHeader
                  title={panelCopy?.title ?? ''}
                  subtitle={panelCopy?.subtitle ?? ''}
                  onBack={closeFocusedPanel}
                />

                {activePanel === 'categories' ? (
                  <EditableList
                    items={categoryItems}
                    withEmoji
                    addLabel="New category"
                    reorderTitle="Categories"
                    onAdd={(name, emoji) => addCategory(name, emoji)}
                    onRename={(id, name, emoji) => {
                      renameCategory(id, name);
                      setCategoryEmoji(id, emoji);
                    }}
                    onDelete={(item) =>
                      confirmDelete('category', item, () => deleteCategory(item.id))
                    }
                    onReorder={reorderCategories}
                    onOpen={(item) => setOpenCategoryId(item.id)}
                  />
                ) : null}

                {activePanel === 'payment-modes' ? (
                  <EditableList
                    items={lists.paymentModes}
                    addLabel="New payment mode"
                    reorderTitle="Payment modes"
                    onAdd={(name) => addPaymentMode(name)}
                    onRename={(id, name) => renamePaymentMode(id, name)}
                    onDelete={(item) =>
                      confirmDelete('payment mode', item, () => deletePaymentMode(item.id))
                    }
                    onReorder={reorderPaymentModes}
                  />
                ) : null}

                {activePanel === 'people' ? (
                  <EditableList
                    items={lists.people}
                    addLabel="New person or group"
                    reorderTitle="People & groups"
                    onAdd={(name) => addPerson(name)}
                    onRename={(id, name) => renamePerson(id, name)}
                    onDelete={(item) => confirmDelete('person', item, () => deletePerson(item.id))}
                    onReorder={reorderPeople}
                  />
                ) : null}

                {activePanel === 'appearance' ? (
                  <AppearanceSettings mode={mode} onChange={setMode} />
                ) : null}
                {activePanel === 'backup' ? <BackupSettings driveEnabled={driveEnabled} /> : null}
                {activePanel === 'account' && accountEmail ? (
                  <AccountSettings email={accountEmail} driveEnabled={driveEnabled} />
                ) : null}
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <SubcategoryManager category={openCategory} onClose={() => setOpenCategoryId(null)} />
      <ConfirmDeleteModal
        visible={deleteModalVisible}
        count={deleteCount}
        busy={deleteBusy}
        onCancel={() => setDeleteModalVisible(false)}
        onConfirm={confirmDeleteAll}
        onBackupFirst={driveEnabled ? backupBeforeDelete : undefined}
      />
    </ThemedView>
  );
}

function FocusedHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
}) {
  return (
    <View style={styles.focusedHeader}>
      <Button
        label="Settings"
        accessibilityLabel="Back to Settings"
        variant="ghost"
        size="small"
        icon={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
        onPress={onBack}
        style={styles.backButton}
      />
      <ScreenHeader title={title} subtitle={subtitle} compact />
    </View>
  );
}

const APPEARANCE_NOTE =
  'System follows your device setting. Light and Dark stay fixed until you change them.';

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function AppearanceSettings({
  mode,
  onChange,
}: {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}) {
  return (
    <Card padding="small">
      <InfoDisclosure label="How appearance modes work" text={APPEARANCE_NOTE}>
        <SegmentedControl
          options={THEME_OPTIONS}
          value={mode}
          onChange={onChange}
          accessibilityLabel="Appearance"
        />
      </InfoDisclosure>
    </Card>
  );
}

function BackupSettings({ driveEnabled }: { driveEnabled: boolean }) {
  const { busy, run } = useBusyAction();

  const onSaveToFolder = useCallback(() => {
    void run(async () => {
      const res = await saveBackupToFolder();
      if (res.saved) Alert.alert('Backed up', `Saved ${res.fileName} to the folder you chose.`);
    });
  }, [run]);

  const onShare = useCallback(() => {
    void run(async () => {
      await shareBackup();
    });
  }, [run]);

  const onBackupDrive = useCallback(() => {
    void run(async () => {
      const res = await backupToDrive();
      if (res.done) {
        const account = res.account ? ` (${res.account})` : '';
        Alert.alert('Backed up to Drive', `Saved ${res.fileName} to your Google Drive${account}.`);
      }
    });
  }, [run]);

  const onRestore = useCallback(() => {
    Alert.alert(
      'Restore from a file?',
      'This replaces ALL current data in the app with the contents of the backup file you pick. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Choose file & restore',
          style: 'destructive',
          onPress: () => {
            void run(async () => {
              const res = await restoreFromPickedFile();
              if (res.restored) Alert.alert('Restored', 'Your data was restored from the backup.');
            });
          },
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
          onPress: () => {
            void run(async () => {
              const res = await restoreLatestFromDrive();
              if (!res.found) {
                Alert.alert('No backup found', 'There are no Finance Tracker backups in your Google Drive yet.');
              } else if (res.restored) {
                Alert.alert('Restored', `Restored ${res.fileName} from your Google Drive.`);
              }
            });
          },
        },
      ],
    );
  }, [run]);

  return (
    <>
      <SettingsGroup
        title="BACK UP"
        rows={[
          {
            id: 'folder',
            title: 'Save to a folder',
            description: 'Choose a folder and save a complete .db backup.',
            icon: ACTION_ICONS.folder,
            onPress: onSaveToFolder,
            disabled: busy,
          },
          {
            id: 'share',
            title: 'Share backup',
            description: 'Send a complete backup with your device share sheet.',
            icon: ACTION_ICONS.share,
            onPress: onShare,
            disabled: busy,
          },
          ...(driveEnabled
            ? [
                {
                  id: 'drive',
                  title: 'Google Drive',
                  description: 'Save a complete backup to your Finance Tracker Drive folder.',
                  icon: ACTION_ICONS.drive,
                  onPress: onBackupDrive,
                  disabled: busy,
                } satisfies SettingsRowDefinition,
              ]
            : []),
        ]}
      />

      <SettingsGroup
        title="RESTORE"
        rows={[
          {
            id: 'restore-file',
            title: 'Restore from file',
            description: 'Pick a Finance Tracker backup from this device.',
            icon: ACTION_ICONS.restoreFile,
            onPress: onRestore,
            disabled: busy,
            destructive: true,
          },
          ...(driveEnabled
            ? [
                {
                  id: 'restore-drive',
                  title: 'Restore latest from Drive',
                  description: 'Use the most recent backup in your Drive folder.',
                  icon: ACTION_ICONS.restoreDrive,
                  onPress: onRestoreDrive,
                  disabled: busy,
                  destructive: true,
                } satisfies SettingsRowDefinition,
              ]
            : []),
        ]}
      />

      {busy ? (
        <View style={styles.busyRow} accessibilityLiveRegion="polite">
          <ActivityIndicator />
          <ThemedText type="small" themeColor="textSecondary">
            Working on your data…
          </ThemedText>
        </View>
      ) : null}
    </>
  );
}

function AccountSettings({ email, driveEnabled }: { email: string; driveEnabled: boolean }) {
  const { busy, run } = useBusyAction();

  const onSignOut = useCallback(
    () => {
      void run(
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
      );
    },
    [run, driveEnabled],
  );

  return (
    <Card style={styles.accountPanel}>
      <ThemedText type="overline" themeColor="textSecondary">
        GOOGLE ACCOUNT
      </ThemedText>
      <ThemedText type="label" selectable>
        {email}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {driveEnabled
          ? `Signed in as ${email}. Signing out backs up to Drive first.`
          : `Signed in as ${email}. Google Drive backup is unavailable on web.`}
      </ThemedText>
      <Button
        label="Sign out"
        onPress={onSignOut}
        disabled={busy}
        loading={busy}
        accessibilityHint={
          driveEnabled ? 'Backs up to Google Drive before signing out' : 'Signs out of this browser'
        }
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fill: { flex: 1 },
  safeArea: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MaxContentWidth },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.five,
    gap: Spacing.two,
  },
  focusedHeader: { gap: Spacing.half, marginBottom: Spacing.half },
  backButton: { alignSelf: 'flex-start', marginLeft: -Spacing.two },
  busyRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  accountPanel: { gap: Spacing.one },
});
