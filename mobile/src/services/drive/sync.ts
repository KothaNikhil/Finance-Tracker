import { AppState, Alert } from 'react-native';
import { addDatabaseChangeListener } from 'expo-sqlite';

import { shouldRestoreFromDrive } from '@/core/drive';
import {
  DriveSyncEngine,
  hasPendingLocalChanges,
  RevisionConflictError,
  type LiveDatabaseFile,
} from '@/core/sync/engine';
import { getDataUpdatedAt } from '@/services/db/repository';
import { getMeta, setMeta } from '@/core/db/runtime';
import { getSqlite } from '@/services/db/database';
import { restoreFromBytes, serializeDatabase } from '@/services/db/backup';
import { currentAccount, ensureSignedIn, getAccessToken } from './auth';
import { GoogleDriveSyncPort } from './sync-port';

const SYNC_FILE_ID = 'drive_sync_file_id';
const SYNC_REVISION_ID = 'drive_sync_revision_id';
const SYNC_DATA_UPDATED_AT = 'drive_sync_data_updated_at';
const DEBOUNCE_MS = 3_000;
const MAX_WAIT_MS = 30_000;

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

function reportConflict(
  drive: GoogleDriveSyncPort,
  isCurrent: () => boolean,
): void {
  if (!isCurrent() || AppState.currentState !== 'active' || conflictPromptOpen) return;
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
            if (result.kind === 'conflict') reportConflict(drive, isCurrent);
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
        },
      },
    ],
    { cancelable: false },
  );
}

let conflictPromptOpen = false;
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
  const result = await new DriveSyncEngine(drive).save(bytes, {
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
          saveSyncHead(loaded.file, localUpdatedAt);
          if (loaded.kind === 'existing') {
            reportConflict(drive, isCurrent);
            return { restored: false, found: true, conflict: true, fileName: loaded.file.name };
          }
          return { restored: false, found: true, saved: true, fileName: loaded.file.name };
        }
        await restoreFromBytes(loaded.bytes, isCurrent);
        if (!isCurrent()) return { restored: false, found: true };
        saveSyncHead(loaded.file);
        if (options.manualSnapshot) {
          const currentFile = await drive.findLiveFile();
          if (!isCurrent()) return { restored: true, found: true };
          const saved = await saveLocalChanges(drive, currentFile, false, isCurrent, true);
          if (saved.kind === 'conflict') {
            reportConflict(drive, isCurrent);
            return { restored: true, found: true, conflict: true, fileName: newest.name };
          }
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
      reportConflict(drive, isCurrent);
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
    reportConflict(drive, isCurrent);
    return { restored: false, found: true, conflict: true, fileName: current.name };
  }

  if (remoteChanged) {
    let pulled: boolean;
    try {
      pulled = await pullLatest(drive, current, isCurrent);
    } catch (error) {
      if (!(error instanceof RevisionConflictError)) throw error;
      reportConflict(drive, isCurrent);
      return { restored: false, found: true, conflict: true, fileName: current.name };
    }
    if (!pulled) return { restored: false, found: true };
    if (options.manualSnapshot) {
      const currentFile = await drive.findLiveFile();
      if (!isCurrent()) return { restored: true, found: true };
      const saved = await saveLocalChanges(drive, currentFile, false, isCurrent, true);
      if (saved.kind === 'conflict') {
        reportConflict(drive, isCurrent);
        return { restored: true, found: true, conflict: true, fileName: current.name };
      }
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
      reportConflict(drive, isCurrent);
      return { restored: false, found: true, conflict: true, fileName: current.name };
    }
    return { restored: false, found: true, saved: true, fileName: saved.file.name };
  }

  saveSyncHead(current);
  return { restored: false, found: true, fileName: current.name };
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
  const account = await ensureSignedIn();
  if (!account || !isCurrent()) return { done: false, fileName: '', account: null };
  const result = await runSerialized(async () =>
    synchronizeWithDrive(
      new GoogleDriveSyncPort(await getAccessToken()),
      { manualSnapshot: true },
      isCurrent,
    ),
  );
  return {
    done: !result.conflict,
    fileName: result.conflict ? '' : result.fileName ?? 'finance-live.db',
    account: result.conflict ? null : account.email,
  };
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
    if (errorReported || localChangesPending()) void runSync();
  }, MAX_WAIT_MS);

  const runSync = async (allowInteractiveSignIn = AppState.currentState === 'active') => {
    if (disposed) return;
    try {
      const account = allowInteractiveSignIn ? await ensureSignedIn() : currentAccount();
      if (!account || disposed) return;
      await runSerialized(async () =>
        synchronizeWithDrive(new GoogleDriveSyncPort(await getAccessToken()), {}, isCurrent),
      );
      errorReported = false;
    } catch (error) {
      if (disposed || !isCurrent()) return;
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
    if (tableName !== 'meta') scheduleSync();
  });
  const appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      errorReported = false;
      void runSync(true);
    } else if (state === 'background') {
      void runSync(false);
    }
  });

  void runSync();
  return () => {
    disposed = true;
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
