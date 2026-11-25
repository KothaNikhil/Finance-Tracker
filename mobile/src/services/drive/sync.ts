import { AppState, Alert, Linking } from 'react-native';
import { addDatabaseChangeListener } from 'expo-sqlite';

import { shouldRestoreFromDrive } from '@/core/drive';
import {
  DriveSyncEngine,
  hasPendingLocalChanges,
  RevisionConflictError,
  type LiveDatabaseFile,
} from '@/core/sync/engine';
import { getDataUpdatedAt } from '@/services/db/repository';
import { ReadOnlyError, getMeta, setMeta } from '@/core/db/runtime';
import { EditLockLostError, discardedOfflineSnapshotName, type EditLock } from '@/core/sync/lock';
import { holderName, lockTime, type EditSession } from '@/core/sync/session';
import { getSqlite } from '@/services/db/database';
import { restoreFromBytes, serializeDatabase } from '@/services/db/backup';
import { currentAccount, ensureSignedIn, getAccessToken } from './auth';
import {
  getEditSession,
  isNetworkError,
  resetEditSession,
  setLostHandler,
  setSyncHealth,
  syncHealth,
} from './edit-session';
import { GoogleDriveSyncPort } from './sync-port';

const SYNC_FILE_ID = 'drive_sync_file_id';
const SYNC_REVISION_ID = 'drive_sync_revision_id';
const SYNC_DATA_UPDATED_AT = 'drive_sync_data_updated_at';
const DEBOUNCE_MS = 3_000;
const MAX_WAIT_MS = 30_000;
const SNAPSHOT_PREFIX = 'Finance-Tracker-backup-';

export interface DriveSyncResult {
  restored: boolean;
  found: boolean;
  keptLocal?: boolean;
  saved?: boolean;
  conflict?: boolean;
  fileName?: string;
}

interface SyncOptions {
  manualSnapshot?: boolean;
}

function localChangesPending(): boolean {
  return hasPendingLocalChanges(getDataUpdatedAt(), getMeta(SYNC_DATA_UPDATED_AT));
}

function saveSyncHead(file: LiveDatabaseFile, syncedDataUpdatedAt = getDataUpdatedAt()): void {
  setMeta(SYNC_FILE_ID, file.id);
  setMeta(SYNC_REVISION_ID, file.revisionId);
  setMeta(SYNC_DATA_UPDATED_AT, syncedDataUpdatedAt ?? '');
}

async function pullLatest(
  drive: GoogleDriveSyncPort,
  file: LiveDatabaseFile,
  isCurrent: () => boolean,
  protectLocalChanges = true,
): Promise<boolean> {
  let candidate = file;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const localUpdatedAt = getDataUpdatedAt();
    const bytes = await drive.download(candidate.id);
    if (!isCurrent()) return false;
    const latest = await drive.findLiveFile();
    if (!isCurrent()) return false;
    if (!latest) throw new RevisionConflictError();
    if (latest.id !== candidate.id || latest.revisionId !== candidate.revisionId) {
      candidate = latest;
      continue;
    }
    if (protectLocalChanges && localUpdatedAt !== getDataUpdatedAt()) {
      throw new RevisionConflictError();
    }
    try {
      await restoreFromBytes(bytes, isCurrent);
    } catch (error) {
      if (!isCurrent()) return false;
      throw error;
    }
    if (!isCurrent()) return false;
    saveSyncHead(latest);
    return true;
  }
  throw new RevisionConflictError();
}

/** Identifies one conflict: the Drive head the phone disagrees with. */
function conflictKey(remote: LiveDatabaseFile | null): string {
  return remote ? `${remote.id}:${remote.revisionId}` : 'no-live-file';
}

function reportConflict(
  drive: GoogleDriveSyncPort,
  isCurrent: () => boolean,
  remote: LiveDatabaseFile | null,
): void {
  if (!isCurrent() || AppState.currentState !== 'active' || conflictPromptOpen) return;
  // "Not now" silences this exact conflict until Drive changes again or the app returns to the
  // foreground, so the 30 s retry timer doesn't bring the same prompt straight back.
  const key = conflictKey(remote);
  if (dismissedConflictKey === key) return;
  conflictPromptOpen = true;
  Alert.alert(
    'Drive sync conflict',
    'This phone and Google Drive both have changes. Choose which version to keep.',
    [
      {
        text: 'Reload Drive',
        style: 'destructive',
        onPress: () => {
          conflictPromptOpen = false;
          if (!isCurrent()) return;
          void runSerialized(async () => {
            const latest = await drive.findLiveFile();
            if (!isCurrent()) return;
            if (!latest) throw new Error('The live database is no longer available in Drive.');
            await pullLatest(drive, latest, isCurrent, false);
          }).catch((error: unknown) => {
            if (isCurrent()) reportActiveError(error);
          });
        },
      },
      {
        text: 'Overwrite with phone',
        onPress: () => {
          conflictPromptOpen = false;
          if (!isCurrent()) return;
          void runSerialized(async () => {
            const latest = await drive.findLiveFile();
            if (!isCurrent()) return;
            const result = await saveLocalChanges(drive, latest, true, isCurrent);
            if (result.kind === 'conflict') reportConflict(drive, isCurrent, result.current);
          }).catch((error: unknown) => {
            if (isCurrent()) reportActiveError(error);
          });
        },
      },
      {
        text: 'Not now',
        style: 'cancel',
        onPress: () => {
          conflictPromptOpen = false;
          dismissedConflictKey = key;
        },
      },
    ],
    { cancelable: false },
  );
}

let conflictPromptOpen = false;
let dismissedConflictKey: string | null = null;
let activeErrorHandler: ((error: Error) => void) | null = null;
let syncSessionGeneration = 0;
let syncQueue: Promise<void> = Promise.resolve();

function runSerialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = syncQueue.then(operation, operation);
  syncQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function reportActiveError(error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  if (activeErrorHandler) activeErrorHandler(normalized);
  else console.error('Google Drive sync failed', normalized);
}

async function saveLocalChanges(
  drive: GoogleDriveSyncPort,
  current: LiveDatabaseFile | null,
  force: boolean,
  isCurrent: () => boolean,
  manualSnapshot = false,
): Promise<Awaited<ReturnType<DriveSyncEngine['save']>>> {
  if (!isCurrent()) throw new Error('Drive sync was cancelled because the active account changed.');
  const serializedDataUpdatedAt = getDataUpdatedAt();
  const bytes = serializeDatabase();
  const session = await getEditSession();
  const result = await new DriveSyncEngine(drive, { beforeWrite: session.assertCanWrite }).save(bytes, {
    expectedFileId: current?.id ?? null,
    expectedRevisionId: current?.revisionId ?? null,
    force,
    manualSnapshot,
  });
  if (result.kind === 'saved' && isCurrent()) {
    saveSyncHead(result.file, serializedDataUpdatedAt);
  }
  return result;
}

async function synchronizeWithDrive(
  drive: GoogleDriveSyncPort,
  options: SyncOptions,
  isCurrent: () => boolean,
): Promise<DriveSyncResult> {
  if (!isCurrent()) return { restored: false, found: false };
  const session = await getEditSession();
  session.setPort(drive);
  if ((await resolveEditLock(drive, session, isCurrent)) === 'view-only') {
    return viewOnlySync(drive, isCurrent);
  }
  const current = await drive.findLiveFile();
  if (!isCurrent()) return { restored: false, found: false };

  if (!current) {
    const snapshots = await drive.listSnapshots();
    if (!isCurrent()) return { restored: false, found: false };
    const localUpdatedAt = getDataUpdatedAt();
    const pendingLocalChanges = localChangesPending();
    const newest = [...snapshots].sort(
      (a, b) => Date.parse(b.modifiedTime) - Date.parse(a.modifiedTime),
    )[0];
    const localWins =
      pendingLocalChanges ||
      (!!newest && !!localUpdatedAt && !shouldRestoreFromDrive(localUpdatedAt, newest.modifiedTime));

    if (newest && !localWins) {
      const loaded = await new DriveSyncEngine(drive).load();
      if (!isCurrent()) return { restored: false, found: false };
      if (loaded.kind !== 'fresh') {
        if (localUpdatedAt !== getDataUpdatedAt()) {
          // The phone changed while Drive's copy was downloading, so both sides hold changes. Ask,
          // whether the live file already existed or was just created from a snapshot. Don't record
          // a sync head here: that would make the phone's stale copy look like a plain local edit,
          // and the next sync would overwrite the newer Drive data with it.
          reportConflict(drive, isCurrent, loaded.file);
          return { restored: false, found: true, conflict: true, fileName: loaded.file.name };
        }
        await restoreFromBytes(loaded.bytes, isCurrent);
        if (!isCurrent()) return { restored: false, found: true };
        saveSyncHead(loaded.file);
        if (options.manualSnapshot) {
          const currentFile = await drive.findLiveFile();
          if (!isCurrent()) return { restored: true, found: true };
          const saved = await saveLocalChanges(drive, currentFile, false, isCurrent, true);
          if (saved.kind === 'conflict') {
            reportConflict(drive, isCurrent, saved.current);
            return { restored: true, found: true, conflict: true, fileName: newest.name };
          }
          return { restored: true, found: true, saved: true, fileName: saved.file.name };
        }
        return { restored: true, found: true, fileName: newest.name };
      }
    }

    const created = await saveLocalChanges(
      drive,
      null,
      false,
      isCurrent,
      options.manualSnapshot,
    );
    if (!isCurrent()) return { restored: false, found: true };
    if (created.kind === 'conflict') {
      reportConflict(drive, isCurrent, created.current);
      return { restored: false, found: true, conflict: true };
    }
    return { restored: false, found: true, saved: true, fileName: created.file.name };
  }

  const expectedId = getMeta(SYNC_FILE_ID);
  const expectedRevision = getMeta(SYNC_REVISION_ID);
  const localUpdatedAt = getDataUpdatedAt();
  const pendingLocalChanges = localChangesPending();
  const hasExpectedHead = expectedId !== null && expectedRevision !== null;
  const remoteChanged =
    !hasExpectedHead || current.id !== expectedId || current.revisionId !== expectedRevision;
  const localIsNewerThanUntrackedHead =
    !hasExpectedHead &&
    !!localUpdatedAt &&
    !shouldRestoreFromDrive(localUpdatedAt, current.modifiedTime);
  const hasLocalChanges = pendingLocalChanges || localIsNewerThanUntrackedHead;

  if (remoteChanged && hasLocalChanges) {
    reportConflict(drive, isCurrent, current);
    return { restored: false, found: true, conflict: true, fileName: current.name };
  }

  if (remoteChanged) {
    let pulled: boolean;
    try {
      pulled = await pullLatest(drive, current, isCurrent);
    } catch (error) {
      if (!(error instanceof RevisionConflictError)) throw error;
      reportConflict(drive, isCurrent, current);
      return { restored: false, found: true, conflict: true, fileName: current.name };
    }
    if (!pulled) return { restored: false, found: true };
    if (options.manualSnapshot) {
      const currentFile = await drive.findLiveFile();
      if (!isCurrent()) return { restored: true, found: true };
      const saved = await saveLocalChanges(drive, currentFile, false, isCurrent, true);
      if (saved.kind === 'conflict') {
        reportConflict(drive, isCurrent, saved.current);
        return { restored: true, found: true, conflict: true, fileName: current.name };
      }
      return { restored: true, found: true, saved: true, fileName: saved.file.name };
    }
    return { restored: true, found: true, fileName: current.name };
  }

  if (hasLocalChanges || options.manualSnapshot) {
    const saved = await saveLocalChanges(
      drive,
      current,
      false,
      isCurrent,
      options.manualSnapshot,
    );
    if (!isCurrent()) return { restored: false, found: true };
    if (saved.kind === 'conflict') {
      reportConflict(drive, isCurrent, saved.current);
      return { restored: false, found: true, conflict: true, fileName: current.name };
    }
    return { restored: false, found: true, saved: true, fileName: saved.file.name };
  }

  saveSyncHead(current);
  return { restored: false, found: true, fileName: current.name };
}

// ---------------------------------------------------------------------------
// One device edits at a time
// ---------------------------------------------------------------------------

const DRIVE_SNAPSHOTS_URL = 'https://drive.google.com/drive/search?q=discarded-offline';

/**
 * Decide, at the start of a sync, whether this phone may write. Returns `view-only` when another
 * device holds the edit lock. When the lock was taken while this phone had unsaved (offline) edits,
 * those edits are kept as a Drive snapshot and replaced with Drive's copy, as the user chose.
 */
async function resolveEditLock(
  drive: GoogleDriveSyncPort,
  session: EditSession,
  isCurrent: () => boolean,
): Promise<'editing' | 'view-only'> {
  const mode = session.getState().mode;
  if (mode === 'editing') return 'editing';
  if (mode === 'view-only') return 'view-only';

  const status = await session.manager.check();
  if (!isCurrent()) return 'view-only';
  if (status.kind !== 'other') {
    const started = await session.start();
    if (started.mode === 'editing') return 'editing';
  }
  const holder = session.manager.lastSeen;
  if (localChangesPending()) {
    session.markViewOnly('moved', holder);
    await discardLocalChanges(drive, holder, isCurrent);
  } else {
    session.markViewOnly('in-use', holder);
  }
  return 'view-only';
}

/** While view only, only bring in what the editing device saved. */
async function viewOnlySync(
  drive: GoogleDriveSyncPort,
  isCurrent: () => boolean,
): Promise<DriveSyncResult> {
  const current = await drive.findLiveFile();
  if (!isCurrent() || !current) return { restored: false, found: !!current };
  const changed =
    current.id !== getMeta(SYNC_FILE_ID) || current.revisionId !== getMeta(SYNC_REVISION_ID);
  if (!changed) return { restored: false, found: true, fileName: current.name };
  const pulled = await pullLatest(drive, current, isCurrent, false);
  return { restored: pulled, found: true, fileName: current.name };
}

/**
 * Another device took over while this phone held edits Drive doesn't have. Keep the phone's copy
 * as a protected snapshot (30 days), load Drive's copy, and tell the user.
 */
async function discardLocalChanges(
  drive: GoogleDriveSyncPort,
  holder: EditLock | null,
  isCurrent: () => boolean,
): Promise<void> {
  await drive.createSnapshot(discardedOfflineSnapshotName(new Date()), serializeDatabase());
  if (!isCurrent()) return;
  const live = await drive.findLiveFile();
  if (live && isCurrent()) await pullLatest(drive, live, isCurrent, false);
  if (!isCurrent()) return;
  (await getEditSession()).markViewOnly('discarded', holder);
  setSyncHealth({ pendingChanges: false });
  const who = holderName(holder, 'phone');
  const at = holder ? ` at ${lockTime(holder.acquiredAt)}` : '';
  Alert.alert(
    'Offline changes not saved',
    `${capitalize(who)} took over editing${at} while this phone had unsaved changes, so they weren’t saved. This phone now shows the latest data from Drive.\n\nA copy of this phone’s data is kept in Drive snapshots for 30 days.`,
    [
      { text: 'View snapshots', onPress: () => void Linking.openURL(DRIVE_SNAPSHOTS_URL) },
      { text: 'OK', style: 'cancel' },
    ],
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The lock moved to another device while this phone was editing (heartbeat or a save found it). */
function handleLockLost(holder: EditLock | null, isCurrent: () => boolean): void {
  // Queue the cleanup behind whatever sync is running (the save that found the loss holds the queue).
  void runSerialized(async () => {
    if (!isCurrent()) return;
    const drive = new GoogleDriveSyncPort(await getAccessToken());
    if (localChangesPending()) {
      await discardLocalChanges(drive, holder, isCurrent);
      return;
    }
    await viewOnlySync(drive, isCurrent);
    if (!isCurrent() || AppState.currentState !== 'active') return;
    const who = holderName(holder, 'phone');
    const detail = holder ? `${holder.deviceLabel} took over at ${lockTime(holder.acquiredAt)}. ` : '';
    Alert.alert(
      `Editing moved to ${who}`,
      `${detail}This phone is now view only and shows the other device’s changes as they’re saved.`,
      [
        { text: 'Take back', onPress: () => void takeOverEditing().catch(reportActiveError) },
        { text: 'OK', style: 'cancel' },
      ],
    );
  }).catch((error: unknown) => {
    if (isCurrent()) reportActiveError(error);
  });
}

/** Take the edit lock from the other device, then load what it saved. */
export async function takeOverEditing(): Promise<void> {
  const generation = syncSessionGeneration;
  const isCurrent = () => generation === syncSessionGeneration;
  const account = await ensureSignedIn();
  if (!account || !isCurrent()) return;
  await runSerialized(async () => {
    const drive = new GoogleDriveSyncPort(await getAccessToken());
    const session = await getEditSession();
    session.setPort(drive);
    await session.takeOver();
    if (!isCurrent() || !session.editing) return;
    await synchronizeWithDrive(drive, {}, isCurrent);
  });
}

/** The user chose View only in the In-use question. */
export async function stayViewOnly(): Promise<void> {
  (await getEditSession()).chooseViewOnly();
}

/** Sign-out: give the lock up so the other device can edit straight away. Best effort. */
export async function releaseEditLock(): Promise<void> {
  const session = await getEditSession();
  try {
    if (session.editing) {
      session.setPort(new GoogleDriveSyncPort(await getAccessToken()));
      await session.release();
    }
  } catch {
    // Offline or signed out of Google already: the lock simply expires.
  } finally {
    resetEditSession();
  }
}

function assertEditing(session: EditSession): void {
  if (session.getState().mode === 'view-only') throw new ReadOnlyError();
}

export async function syncDownFromDrive(): Promise<DriveSyncResult> {
  const generation = syncSessionGeneration;
  const isCurrent = () => generation === syncSessionGeneration;
  const account = await ensureSignedIn();
  if (!account || !isCurrent()) return { restored: false, found: false };
  return runSerialized(async () =>
    synchronizeWithDrive(new GoogleDriveSyncPort(await getAccessToken()), {}, isCurrent),
  );
}

export async function backupLiveDatabaseToDrive(): Promise<{
  done: boolean;
  fileName: string;
  account: string | null;
}> {
  const generation = syncSessionGeneration;
  const isCurrent = () => generation === syncSessionGeneration;
  assertEditing(await getEditSession());
  const account = await ensureSignedIn();
  if (!account || !isCurrent()) return { done: false, fileName: '', account: null };
  const result = await runSerialized(async () =>
    synchronizeWithDrive(
      new GoogleDriveSyncPort(await getAccessToken()),
      { manualSnapshot: true },
      isCurrent,
    ),
  );
  if (result.conflict) return { done: false, fileName: '', account: null };
  if (!result.saved) {
    // The run stopped early (account switched, or Drive changed mid-download) without uploading.
    throw new Error('The Drive backup didn’t finish. Check your connection and try again.');
  }
  return { done: true, fileName: result.fileName ?? 'finance-live.db', account: account.email };
}

/**
 * Replace the phone's data with the latest copy in Drive: the live file `finance-live.db`, falling
 * back to the newest snapshot only when no live file exists yet. Unsynced phone changes are kept as
 * a `before-restore` snapshot first. Runs in the sync queue so it can't interleave with autosave.
 */
export async function restoreLatestFromDriveLive(): Promise<{
  restored: boolean;
  found: boolean;
  fileName?: string;
}> {
  const generation = syncSessionGeneration;
  const isCurrent = () => generation === syncSessionGeneration;
  const account = await ensureSignedIn();
  if (!account || !isCurrent()) return { restored: false, found: false };
  assertEditing(await getEditSession());
  return runSerialized(async () => {
    const drive = new GoogleDriveSyncPort(await getAccessToken());
    if (localChangesPending()) {
      await drive.createSnapshot(`${SNAPSHOT_PREFIX}${Date.now()}-before-restore.db`, serializeDatabase());
      if (!isCurrent()) return { restored: false, found: false };
    }
    const live = await drive.findLiveFile();
    if (!isCurrent()) return { restored: false, found: false };
    if (live) {
      const pulled = await pullLatest(drive, live, isCurrent, false);
      return { restored: pulled, found: true, fileName: live.name };
    }
    const newest = [...(await drive.listSnapshots())].sort(
      (a, b) => Date.parse(b.modifiedTime) - Date.parse(a.modifiedTime),
    )[0];
    if (!newest || !isCurrent()) return { restored: false, found: !!newest };
    await restoreFromBytes(await drive.download(newest.id), isCurrent);
    // No live file yet, so the next sync creates one from this restored copy, as intended.
    return { restored: isCurrent(), found: true, fileName: newest.name };
  });
}

export function startDriveSync(onError: (error: Error) => void): () => void {
  getSqlite();
  activeErrorHandler = onError;

  let disposed = false;
  const generation = ++syncSessionGeneration;
  const isCurrent = () => !disposed && generation === syncSessionGeneration;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let errorReported = false;
  const retryTimer = setInterval(() => {
    if (errorReported || localChangesPending() || syncHealth().offline) void runSync();
  }, MAX_WAIT_MS);
  setLostHandler((holder) => handleLockLost(holder, isCurrent));

  const startHeartbeat = () => {
    void getEditSession().then((session) => {
      if (disposed) return;
      session.startHeartbeat((error) => {
        if (isNetworkError(error)) setSyncHealth({ offline: true });
      });
    });
  };
  const stopHeartbeat = () => {
    void getEditSession().then((session) => session.stopHeartbeat());
  };

  const runSync = async (allowInteractiveSignIn = AppState.currentState === 'active') => {
    if (disposed) return;
    try {
      const account = allowInteractiveSignIn ? await ensureSignedIn() : currentAccount();
      if (!account || disposed) return;
      const pendingBefore = localChangesPending();
      const wasOffline = syncHealth().offline;
      const result = await runSerialized(async () =>
        synchronizeWithDrive(new GoogleDriveSyncPort(await getAccessToken()), {}, isCurrent),
      );
      errorReported = false;
      setSyncHealth({
        offline: false,
        pendingChanges: localChangesPending(),
        ...(wasOffline && pendingBefore && result.saved ? { savedAfterOffline: Date.now() } : {}),
      });
    } catch (error) {
      if (disposed || !isCurrent()) return;
      // Handled by the lock-lost path (alert + view only); not a sync failure.
      if (error instanceof EditLockLostError) return;
      if (isNetworkError(error)) {
        // Offline: keep editing locally. The banner warns once there are unsaved changes.
        setSyncHealth({ offline: true, pendingChanges: localChangesPending() });
        return;
      }
      if (!errorReported) {
        errorReported = true;
        reportActiveError(error);
      }
    }
  };

  const scheduleSync = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (maxWaitTimer) clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
      void runSync();
    }, DEBOUNCE_MS);
    if (!maxWaitTimer) {
      maxWaitTimer = setTimeout(() => {
        maxWaitTimer = null;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = null;
        void runSync();
      }, MAX_WAIT_MS);
    }
  };

  const databaseSubscription = addDatabaseChangeListener(({ tableName }) => {
    if (tableName === 'meta') return;
    if (syncHealth().offline) setSyncHealth({ pendingChanges: true });
    scheduleSync();
  });
  const appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      errorReported = false;
      dismissedConflictKey = null;
      startHeartbeat();
      void runSync(true);
    } else if (state === 'background') {
      // Keep the lock (it expires on its own after 3 minutes); just stop refreshing it.
      stopHeartbeat();
      void runSync(false);
    }
  });

  if (AppState.currentState === 'active') startHeartbeat();
  void runSync();
  return () => {
    disposed = true;
    stopHeartbeat();
    setLostHandler(null);
    databaseSubscription.remove();
    appStateSubscription.remove();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (maxWaitTimer) clearTimeout(maxWaitTimer);
    clearInterval(retryTimer);
    if (activeErrorHandler === onError) {
      activeErrorHandler = null;
    }
    if (generation === syncSessionGeneration) syncSessionGeneration += 1;
  };
}
