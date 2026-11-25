import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import type { LiveDatabaseFile, SnapshotFile } from '@finance-tracker/core/sync/engine';
import { UnsupportedSchemaVersionError } from '@finance-tracker/core/db/migrations';
import { ReadOnlyError, isReadOnly, isReadOnlyError, setReadOnly } from '@finance-tracker/core/db/runtime';
import {
  EditLockLostError,
  LOCK_HEARTBEAT_MS,
  discardedOfflineSnapshotName,
  type EditLock,
} from '@finance-tracker/core/sync/lock';
import { EditSession, holderName, lockTime, type EditSessionState } from '@finance-tracker/core/sync/session';
import {
  createDriveSyncEngine,
  DriveAccessMissingError,
  DriveReconnectRequiredError,
  GoogleDriveSyncPort,
} from './drive';
import { closeDatabase, exportDatabase, openDatabase } from './database';
import { VIEW_ONLY_HINT, webDevice } from './edit-session';
import { requestDriveAccessToken, revokeDriveAccessToken, supabase } from './auth';
import { DRIVE_FILE_SCOPE } from './config';
import { useDatabaseRevision } from './feature-utils';
import { friendlyDateTime, Icon, initials, TopActionsContext } from './shell';
import './styles.css';
import './app-shell.css';

const DashboardPage = lazy(() => import('./DashboardPage').then((module) => ({ default: module.DashboardPage })));
const TransactionsPage = lazy(() => import('./TransactionsPage').then((module) => ({ default: module.TransactionsPage })));
const ImportPage = lazy(() => import('./ImportPage').then((module) => ({ default: module.ImportPage })));
const LendingPage = lazy(() => import('./LendingPage').then((module) => ({ default: module.LendingPage })));
const SettingsPage = lazy(() => import('./SettingsPage').then((module) => ({ default: module.SettingsPage })));

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'offline' | 'reconnect' | 'conflict' | 'error';

type Gate = 'boot' | 'signin' | 'loading' | 'firstrun' | 'schema' | 'permission' | 'reconnect' | 'readError' | 'ready';

interface LoadInfo {
  step: 'finding' | 'downloading' | 'checking';
  file: (LiveDatabaseFile & { size: number | null }) | null;
  loaded: number;
  total: number | null;
  error: string;
}

interface Profile {
  name: string;
  email: string;
}

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/transactions', label: 'Activity', icon: 'history', end: false },
  { to: '/import', label: 'Import', icon: 'file_download', end: false },
  { to: '/lending', label: 'Lending', icon: 'swap_horiz', end: false },
  { to: '/settings', label: 'Settings', icon: 'settings', end: false },
];

const LIVE_FILE_LABEL = 'finance-live.db';

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function profileOf(session: Session): Profile {
  const metadata = session.user.user_metadata ?? {};
  const email = session.user.email ?? String(metadata.email ?? 'Google account');
  const name = String(metadata.full_name ?? metadata.name ?? email.replace(/@.*/, ''));
  return { name, email };
}

const NO_LOCK: EditSessionState = { mode: 'unknown', reason: null, holder: null, confirmedAt: null };

/** What the "Editing moved" banner says about this tab's unsaved changes. */
interface MovedInfo {
  holder: EditLock | null;
  /** Changes dropped from this tab (kept as a Drive snapshot). */
  discarded: number;
  /** Changes still in this tab because the snapshot couldn't be saved. */
  kept: number;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [gate, setGate] = useState<Gate>('boot');
  const [loadInfo, setLoadInfo] = useState<LoadInfo>({ step: 'finding', file: null, loaded: 0, total: null, error: '' });
  const [schemaInfo, setSchemaInfo] = useState<{ fileVersion: number; supported: number; savedAt: string | null }>({ fileVersion: 0, supported: 0, savedAt: null });
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [message, setMessage] = useState('');
  const [databaseReplacementInProgress, setDatabaseReplacementInProgress] = useState(false);
  const [dbEpoch, setDbEpoch] = useState(0);
  const [changeCount, setChangeCount] = useState(0);
  const [savedBaseline, setSavedBaseline] = useState(0);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [savedByTab, setSavedByTab] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [conflictDriveTime, setConflictDriveTime] = useState<string | null>(null);
  const engineRef = useRef<ReturnType<typeof createDriveSyncEngine> | null>(null);
  const liveFileRef = useRef<LiveDatabaseFile | null>(null);
  const driveTokenRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const changeCountRef = useRef(0);
  const dirtySinceRef = useRef<number | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const operationGenerationRef = useRef(0);
  const sessionUserIdRef = useRef<string | null>(null);
  const startedForUserRef = useRef<string | null>(null);
  const [signedOutElsewhere, setSignedOutElsewhere] = useState(false);
  const signedOutElsewhereRef = useRef(false);
  const finishSignOutElsewhereRef = useRef<() => void>(() => {});
  // One device edits at a time (finance-session.json in Drive). The tab is read-only unless it holds it.
  const sessionRef = useRef<EditSession | null>(null);
  const [lock, setLock] = useState<EditSessionState>(NO_LOCK);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [movedInfo, setMovedInfo] = useState<MovedInfo | null>(null);
  const [askTakeOver, setAskTakeOver] = useState(false);
  const [blockedNotice, setBlockedNotice] = useState(false);
  const lostRef = useRef<(holder: EditLock | null) => Promise<'discarded' | void>>(async () => {});
  // Set while a Drive reload announces itself, so it isn't counted as an unsaved change.
  const suppressDirtyRef = useRef(false);

  const setLive = useCallback((file: LiveDatabaseFile | null) => {
    liveFileRef.current = file;
  }, []);

  const markSaved = useCallback((savedChangeCount: number) => {
    setSavedBaseline(savedChangeCount);
    setSavedAt(new Date());
    setSavedByTab(true);
  }, []);

  const resetDriveState = useCallback(() => {
    operationGenerationRef.current += 1;
    sessionRef.current?.stopHeartbeat();
    sessionRef.current = null;
    setLock(NO_LOCK);
    setMovedInfo(null);
    setAskTakeOver(false);
    closeDatabase();
    engineRef.current = null;
    driveTokenRef.current = null;
    dirtyRef.current = false;
    dirtySinceRef.current = null;
    startedForUserRef.current = null;
    signedOutElsewhereRef.current = false;
    setSignedOutElsewhere(false);
    setLive(null);
    setDbEpoch(0);
    setStatus('saved');
  }, [setLive]);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage(error.message);
      sessionUserIdRef.current = data.session?.user.id ?? null;
      setSession(data.session);
      if (!data.session) setGate('signin');
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null;
      if (nextUserId === null && sessionUserIdRef.current !== null && dirtyRef.current) {
        // Signed out in another tab (or the session expired) while this tab has unsaved edits. The Drive
        // token is separate from the Supabase session, so save first instead of discarding them.
        // The sign-out completes after the next clean save (see save()), even if one is already running.
        signedOutElsewhereRef.current = true;
        setSignedOutElsewhere(true);
        void saveRef.current().then(() => {
          if (!dirtyRef.current && signedOutElsewhereRef.current) finishSignOutElsewhereRef.current();
        });
        return;
      }
      if (sessionUserIdRef.current !== nextUserId) {
        void revokeDriveAccessToken(driveTokenRef.current);
        resetDriveState();
      }
      sessionUserIdRef.current = nextUserId;
      setSession(nextSession);
      if (!nextSession) setGate('signin');
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [resetDriveState]);

  useEffect(() => {
    finishSignOutElsewhereRef.current = () => {
      void revokeDriveAccessToken(driveTokenRef.current);
      resetDriveState();
      sessionUserIdRef.current = null;
      setSession(null);
      setGate('signin');
    };
  }, [resetDriveState]);

  // Every Drive write first checks this tab still holds the edit lock.
  const engineFor = useCallback((token: string) => createDriveSyncEngine(token, undefined, {
    beforeWrite: async () => {
      const editSession = sessionRef.current;
      if (!editSession) throw new ReadOnlyError();
      await editSession.assertCanWrite();
    },
  }), []);

  /** Take the edit lock once data is open. If another device holds it, the tab asks Take over / View only. */
  const startEditSession = useCallback(async (token: string) => {
    const port = new GoogleDriveSyncPort(token);
    let editSession = sessionRef.current;
    if (!editSession) {
      const created = new EditSession(port, webDevice(), { onLost: (holder) => lostRef.current(holder) });
      created.subscribe(() => {
        if (sessionRef.current === created) setLock(created.getState());
      });
      sessionRef.current = created;
      editSession = created;
    } else {
      editSession.setPort(port);
    }
    if (editSession.getState().mode !== 'unknown' || !navigator.onLine) return;
    try {
      await editSession.start();
    } catch (error) {
      // A network error is retried by the heartbeat; a lapsed token needs the user.
      if (error instanceof DriveReconnectRequiredError) setStatus('reconnect');
    }
  }, []);

  /**
   * Load Drive's copy into the open tab without leaving the page (view only, or after the lock
   * moved). Skips the download when Drive hasn't changed, unless `force`.
   */
  const refreshFromDrive = useCallback(async (force = false): Promise<boolean> => {
    const token = driveTokenRef.current;
    if (!token) return false;
    const operation = operationGenerationRef.current;
    const isCurrent = () => operation === operationGenerationRef.current;
    const drive = new GoogleDriveSyncPort(token);
    const current = await drive.findLiveFile();
    if (!isCurrent() || !current) return false;
    const known = liveFileRef.current;
    if (!force && known && known.id === current.id && known.revisionId === current.revisionId) return false;
    const bytes = await drive.download(current.id);
    if (!isCurrent()) return false;
    await openDatabase(bytes);
    if (!isCurrent()) return false;
    setLive(current);
    dirtyRef.current = false;
    dirtySinceRef.current = null;
    setSavedBaseline(changeCountRef.current);
    setSavedAt(new Date(current.modifiedTime));
    setSavedByTab(false);
    setLoadedAt(new Date());
    setStatus('saved');
    setDbEpoch((epoch) => epoch + 1);
    // Tell the pages to re-read, without counting it as a change.
    suppressDirtyRef.current = true;
    try {
      window.dispatchEvent(new Event('finance-db-change'));
    } finally {
      suppressDirtyRef.current = false;
    }
    return true;
  }, [setLive]);

  const loadFromDrive = useCallback(async (token: string) => {
    const operation = ++operationGenerationRef.current;
    const isCurrent = () => operation === operationGenerationRef.current;
    driveTokenRef.current = token;
    engineRef.current = engineFor(token);
    setGate('loading');
    setMessage('');
    setLoadInfo({ step: 'finding', file: null, loaded: 0, total: null, error: '' });
    const loader = createDriveSyncEngine(token, {
      onLiveFileFound: (file) => {
        if (isCurrent()) setLoadInfo((info) => ({ ...info, step: 'downloading', file, total: file.size }));
      },
      onDownloadProgress: (loaded, total) => {
        if (isCurrent()) setLoadInfo((info) => ({ ...info, step: 'downloading', loaded, total: total ?? info.total }));
      },
    });
    try {
      const loaded = await loader.load();
      if (!isCurrent()) return;
      if (loaded.kind === 'fresh') {
        setLive(null);
        setGate('firstrun');
        return;
      }
      setLoadInfo((info) => ({ ...info, step: 'checking', loaded: loaded.bytes.byteLength, total: loaded.bytes.byteLength }));
      try {
        await openDatabase(loaded.bytes);
      } catch (error) {
        if (!isCurrent()) return;
        closeDatabase();
        if (error instanceof UnsupportedSchemaVersionError) {
          setSchemaInfo({ fileVersion: error.databaseVersion, supported: error.supportedVersion, savedAt: loaded.file.modifiedTime });
          setGate('schema');
        } else {
          setLive(loaded.file);
          setGate('readError');
        }
        return;
      }
      if (!isCurrent()) {
        closeDatabase();
        return;
      }
      setLive(loaded.file);
      dirtyRef.current = false;
      dirtySinceRef.current = null;
      setSavedBaseline(changeCountRef.current);
      setSavedAt(new Date(loaded.file.modifiedTime));
      setSavedByTab(false);
      setLoadedAt(new Date());
      setStatus('saved');
      setDbEpoch((epoch) => epoch + 1);
      setGate('ready');
      void startEditSession(token);
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof DriveAccessMissingError) setGate('permission');
      else if (error instanceof DriveReconnectRequiredError) setGate('reconnect');
      else setLoadInfo((info) => ({ ...info, error: error instanceof Error ? error.message : 'Could not open your data from Drive.' }));
    }
  }, [engineFor, setLive, startEditSession]);

  // Sign-in asks Google for drive.file directly, so a fresh session carries a Drive token and loads at once.
  useEffect(() => {
    if (!session || dbEpoch) return;
    if (startedForUserRef.current === session.user.id) return;
    startedForUserRef.current = session.user.id;
    if (session.provider_token) void loadFromDrive(session.provider_token);
    else setGate('reconnect');
  }, [session, dbEpoch, loadFromDrive]);

  useEffect(() => {
    const markDirty = () => {
      // A reload from Drive, or a stray write while view only (blocked before it changes data).
      if (suppressDirtyRef.current || isReadOnly()) return;
      dirtyRef.current = true;
      dirtySinceRef.current ??= Date.now();
      changeCountRef.current += 1;
      setChangeCount(changeCountRef.current);
      setStatus((current) => (current === 'conflict' || current === 'reconnect' ? current : 'unsaved'));
    };
    window.addEventListener('finance-db-change', markDirty);
    return () => window.removeEventListener('finance-db-change', markDirty);
  }, []);

  useEffect(() => {
    if (!dirtyRef.current) return;
    const elapsed = Date.now() - (dirtySinceRef.current ?? Date.now());
    const delay = Math.min(3000, Math.max(0, 30_000 - elapsed));
    const timer = window.setTimeout(() => void saveRef.current(), delay);
    return () => window.clearTimeout(timer);
  }, [changeCount]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  useEffect(() => {
    const onOffline = () => {
      setOnline(false);
      if (dirtyRef.current) setStatus('offline');
    };
    const onOnline = () => {
      setOnline(true);
      // Re-check the lock first: another device may have taken over while this tab was offline.
      void (async () => {
        const editSession = sessionRef.current;
        if (editSession) {
          try {
            if (editSession.getState().mode === 'unknown') await editSession.start();
            else await editSession.tick();
          } catch {
            // The heartbeat retries.
          }
        }
        if (dirtyRef.current) await saveRef.current();
      })();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  const save = useCallback(async (options: { manualSnapshot?: boolean } = {}) => {
    if (!dbEpoch || savingRef.current) return false;
    if (!dirtyRef.current && !options.manualSnapshot) return true;
    const engine = engineRef.current;
    if (!engine) {
      setStatus('reconnect');
      return false;
    }
    if (!navigator.onLine) {
      setStatus('offline');
      return false;
    }
    // Only the device holding the edit lock saves. Changes wait until this tab takes over.
    if (sessionRef.current?.getState().mode !== 'editing') return false;
    savingRef.current = true;
    const savedChangeCount = changeCountRef.current;
    let saveAgain = false;
    setStatus('saving');
    setMessage('');
    try {
      const result = await engine.save(exportDatabase(), {
        expectedFileId: liveFileRef.current?.id ?? null,
        expectedRevisionId: liveFileRef.current?.revisionId ?? null,
        manualSnapshot: options.manualSnapshot,
      });
      if (result.kind === 'conflict') {
        setConflictDriveTime(result.current?.modifiedTime ?? null);
        setStatus('conflict');
        return false;
      }
      setLive(result.file);
      markSaved(savedChangeCount);
      if (changeCountRef.current === savedChangeCount) {
        dirtyRef.current = false;
        dirtySinceRef.current = null;
        setStatus('saved');
        if (signedOutElsewhereRef.current) window.setTimeout(() => finishSignOutElsewhereRef.current(), 0);
        return true;
      }
      saveAgain = true;
      setStatus('unsaved');
      return false;
    } catch (error) {
      // Another device holds the edit lock: the lost-lock handler already dealt with the changes.
      if (error instanceof EditLockLostError || isReadOnlyError(error)) setStatus(dirtyRef.current ? 'unsaved' : 'saved');
      else if (error instanceof DriveReconnectRequiredError || error instanceof DriveAccessMissingError) setStatus('reconnect');
      else {
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'Could not save to Google Drive.');
      }
      return false;
    } finally {
      savingRef.current = false;
      if (saveAgain) window.setTimeout(() => void saveRef.current(), 250);
    }
  }, [dbEpoch, markSaved, setLive]);

  useEffect(() => {
    saveRef.current = async () => {
      await save();
    };
  }, [save]);

  // The lock moved to another device while this tab was editing. Keep unsaved changes as a Drive
  // snapshot (30 days), then show Drive's copy. If the snapshot fails, keep them in the tab instead.
  useEffect(() => {
    lostRef.current = async (holder) => {
      const pending = dirtyRef.current ? Math.max(1, changeCount - savedBaseline) : 0;
      if (pending) {
        const token = driveTokenRef.current;
        try {
          if (!token) throw new DriveReconnectRequiredError();
          await new GoogleDriveSyncPort(token).createSnapshot(discardedOfflineSnapshotName(new Date()), exportDatabase());
        } catch {
          setMovedInfo({ holder, discarded: 0, kept: pending });
          return;
        }
      }
      setMovedInfo({ holder, discarded: pending, kept: 0 });
      try {
        await refreshFromDrive(pending > 0);
      } catch {
        // The view-only refresh retries on the next heartbeat.
      }
      return pending ? 'discarded' : undefined;
    };
  }, [changeCount, savedBaseline, refreshFromDrive]);

  // Heartbeat: keep the lock fresh while editing; while view only, follow who holds it and load what
  // they save. A tab that couldn't check the lock yet (offline at open) tries again.
  useEffect(() => {
    if (gate !== 'ready') return;
    const timer = window.setInterval(() => {
      const editSession = sessionRef.current;
      if (!editSession || !driveTokenRef.current || !navigator.onLine) return;
      void (async () => {
        if (editSession.getState().mode === 'unknown') await editSession.start();
        else await editSession.tick();
        if (editSession.getState().mode === 'view-only' && !dirtyRef.current) await refreshFromDrive();
      })().catch((error: unknown) => {
        if (error instanceof DriveReconnectRequiredError) setStatus('reconnect');
      });
    }, LOCK_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [gate, refreshFromDrive]);

  // Editing again (took over, or the lock was free): save what waited, drop the "moved" banner.
  useEffect(() => {
    if (lock.mode !== 'editing') return;
    setMovedInfo(null);
    setAskTakeOver(false);
    if (dirtyRef.current) void saveRef.current();
  }, [lock.mode]);

  // Read-only unless this tab holds the lock, is online and connected to Drive.
  const readOnly = gate === 'ready' && (lock.mode !== 'editing' || !online || status === 'reconnect');
  useEffect(() => {
    setReadOnly(readOnly);
  }, [readOnly]);
  useEffect(() => () => setReadOnly(false), []);

  // Closing or reloading the tab gives the lock up, so the phone can edit straight away.
  useEffect(() => {
    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      if (sessionRef.current?.editing) sessionRef.current.releaseNow();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  // Anything a page didn't disable fails with ReadOnlyError: show a short notice, not a crash.
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isReadOnlyError(event.reason)) return;
      event.preventDefault();
      setBlockedNotice(true);
    };
    const onError = (event: ErrorEvent) => {
      if (!isReadOnlyError(event.error)) return;
      event.preventDefault();
      setBlockedNotice(true);
    };
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, []);
  useEffect(() => {
    if (!blockedNotice) return;
    const timer = window.setTimeout(() => setBlockedNotice(false), 4000);
    return () => window.clearTimeout(timer);
  }, [blockedNotice]);

  const takeOver = useCallback(async () => {
    const editSession = sessionRef.current;
    const token = driveTokenRef.current;
    if (!editSession || !token) throw new DriveReconnectRequiredError();
    editSession.setPort(new GoogleDriveSyncPort(token));
    await editSession.takeOver();
    if (!editSession.editing) throw new Error('Another device took the edit lock first. Try again.');
    // Kept changes are saved by the editing effect (a Drive change since load shows the conflict
    // dialog). Otherwise load what the other device saved.
    if (!dirtyRef.current) await refreshFromDrive();
  }, [refreshFromDrive]);

  const stayViewOnly = useCallback(() => {
    sessionRef.current?.chooseViewOnly();
    setAskTakeOver(false);
  }, []);

  const reconnectDrive = useCallback(async () => {
    try {
      const token = await requestDriveAccessToken();
      driveTokenRef.current = token;
      engineRef.current = engineFor(token);
      if (dbEpoch) {
        await startEditSession(token);
        if (dirtyRef.current) await saveRef.current();
        else setStatus('saved');
        return;
      }
      await loadFromDrive(token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not reconnect Google Drive.');
      if (!dbEpoch) setGate((current) => (current === 'permission' ? 'permission' : 'reconnect'));
    }
  }, [dbEpoch, engineFor, loadFromDrive, startEditSession]);

  const startFresh = useCallback(async () => {
    const operation = ++operationGenerationRef.current;
    try {
      await openDatabase();
      if (operation !== operationGenerationRef.current) {
        closeDatabase();
        return;
      }
      setLive(null);
      setLoadedAt(new Date());
      dirtyRef.current = true;
      dirtySinceRef.current = Date.now();
      changeCountRef.current += 1;
      setChangeCount(changeCountRef.current);
      setStatus('unsaved');
      setDbEpoch((epoch) => epoch + 1);
      setGate('ready');
      if (driveTokenRef.current) void startEditSession(driveTokenRef.current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create a database.');
    }
  }, [setLive, startEditSession]);

  const loadDriveVersion = useCallback(async () => {
    const token = driveTokenRef.current;
    if (!token) return;
    // Keep the tab's version recoverable before it is replaced.
    try {
      await new GoogleDriveSyncPort(token).createSnapshot(`Finance-Tracker-backup-${Date.now()}-this-tab.db`, exportDatabase());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save a snapshot of this tab.');
      return;
    }
    resetDriveState();
    // Stop the session effect from starting a second load with the sign-in token.
    startedForUserRef.current = sessionUserIdRef.current;
    await loadFromDrive(token);
  }, [loadFromDrive, resetDriveState]);

  const keepTabVersion = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !dbEpoch) return;
    const savedChangeCount = changeCountRef.current;
    setStatus('saving');
    try {
      const result = await engine.save(exportDatabase(), {
        expectedFileId: liveFileRef.current?.id ?? null,
        expectedRevisionId: liveFileRef.current?.revisionId ?? null,
        force: true,
      });
      if (result.kind === 'conflict') {
        setConflictDriveTime(result.current?.modifiedTime ?? null);
        setStatus('conflict');
        return;
      }
      setLive(result.file);
      markSaved(savedChangeCount);
      dirtyRef.current = changeCountRef.current !== savedChangeCount;
      if (!dirtyRef.current) dirtySinceRef.current = null;
      setStatus(dirtyRef.current ? 'unsaved' : 'saved');
      if (!dirtyRef.current && signedOutElsewhereRef.current) window.setTimeout(() => finishSignOutElsewhereRef.current(), 0);
    } catch (error) {
      setStatus(error instanceof DriveReconnectRequiredError ? 'reconnect' : 'error');
      setMessage(error instanceof Error ? error.message : 'Could not overwrite the Drive database.');
    }
  }, [dbEpoch, markSaved, setLive]);

  const listSnapshots = useCallback(async () => {
    const token = driveTokenRef.current;
    if (!token) throw new DriveReconnectRequiredError();
    return new GoogleDriveSyncPort(token).listSnapshots();
  }, []);

  const snapshotBeforeDelete = useCallback(async () => {
    if (isReadOnly()) throw new ReadOnlyError();
    if (dirtyRef.current) await saveRef.current();
    if (dirtyRef.current) throw new Error('Resolve the pending Drive save before deleting data.');
    const token = driveTokenRef.current;
    if (!token) throw new DriveReconnectRequiredError();
    await new GoogleDriveSyncPort(token).createSnapshot(
      `Finance-Tracker-backup-${Date.now()}-before-delete-all-data.db`,
      exportDatabase(),
    );
  }, []);

  const restoreSnapshot = useCallback(async (snapshotId: string) => {
    if (isReadOnly()) throw new ReadOnlyError();
    const token = driveTokenRef.current;
    if (!token || !engineRef.current) throw new DriveReconnectRequiredError();
    setDatabaseReplacementInProgress(true);
    try {
      const hasOpenDatabase = dbEpoch > 0;
      if (hasOpenDatabase && dirtyRef.current) await saveRef.current();
      if (hasOpenDatabase && dirtyRef.current) throw new Error('Resolve the pending Drive save before restoring a snapshot.');
      const operation = operationGenerationRef.current;
      const drive = new GoogleDriveSyncPort(token);
      if (hasOpenDatabase) {
        await drive.createSnapshot(`Finance-Tracker-backup-${Date.now()}-before-restore.db`, exportDatabase());
      }
      const bytes = await drive.download(snapshotId);
      if (operation !== operationGenerationRef.current) return;
      await openDatabase(bytes);
      if (operation !== operationGenerationRef.current) {
        closeDatabase();
        return;
      }
      setLoadedAt(new Date());
      setDbEpoch((epoch) => epoch + 1);
      setGate('ready');
      const { touchDataUpdatedAt } = await import('@finance-tracker/core/db/repository');
      touchDataUpdatedAt();
      // Opened from the damaged-file screen: take the lock so the restored copy can be saved.
      void startEditSession(token);
    } catch (error) {
      // openDatabase leaves the current data untouched on failure; the caller shows the error.
      if (error instanceof DriveReconnectRequiredError) setStatus('reconnect');
      throw error;
    } finally {
      setDatabaseReplacementInProgress(false);
    }
  }, [dbEpoch, startEditSession]);

  const exportExcel = useCallback(async (toDrive: boolean) => {
    if (!toDrive) {
      const { downloadExport } = await import('./export-workbook');
      downloadExport();
      return;
    }
    const token = driveTokenRef.current;
    if (!token) throw new DriveReconnectRequiredError();
    const { buildExportBytes } = await import('./export-workbook');
    const { bytes, fileName } = buildExportBytes();
    await new GoogleDriveSyncPort(token).uploadFile(
      fileName,
      bytes,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }, []);

  const signIn = useCallback(async () => {
    setMessage('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: `email profile ${DRIVE_FILE_SCOPE}`,
        queryParams: { include_granted_scopes: 'true' },
      },
    });
    if (error) setMessage(error.message);
  }, []);

  const signOut = useCallback(async () => {
    if (dirtyRef.current) {
      await saveRef.current();
      if (dirtyRef.current) throw new Error('Your changes aren’t saved to Drive yet. Fix the save status at the top, then sign out.');
    }
    try {
      // Give the edit lock up so the phone can edit straight away (best effort; it expires anyway).
      if (sessionRef.current?.editing) await sessionRef.current.release().catch(() => undefined);
      await revokeDriveAccessToken(driveTokenRef.current);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      resetDriveState();
      setGate('signin');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sign out safely.');
      throw error;
    }
  }, [resetDriveState]);

  const profile = session ? profileOf(session) : null;

  if (gate === 'boot') return <main className="si" aria-busy="true" />;
  if (!session || !profile || gate === 'signin') {
    return <SignInScreen view="signin" message={message} onSignIn={() => void signIn()} />;
  }
  if (gate !== 'ready' && gate !== 'readError') {
    return (
      <SignInScreen
        view={gate}
        profile={profile}
        loadInfo={loadInfo}
        schemaInfo={schemaInfo}
        message={message}
        onSignIn={() => void signIn()}
        onGrant={() => void reconnectDrive()}
        onRetry={() => (driveTokenRef.current ? void loadFromDrive(driveTokenRef.current) : void reconnectDrive())}
        onStartFresh={() => void startFresh()}
        onSignOut={() => void signOut().catch(() => undefined)}
      />
    );
  }

  return (
    <BrowserRouter>
      <AppShell
        profile={profile}
        status={status}
        pendingChanges={Math.max(0, changeCount - savedBaseline)}
        savedAt={savedAt}
        savedByTab={savedByTab}
        loadedAt={loadedAt}
        message={message}
        readError={gate === 'readError'}
        signedOutElsewhere={signedOutElsewhere}
        databaseReplacementInProgress={databaseReplacementInProgress}
        dbEpoch={dbEpoch}
        onReconnect={() => void reconnectDrive()}
        onSaveNow={() => void save()}
        onRetryLoad={() => (driveTokenRef.current ? void loadFromDrive(driveTokenRef.current) : void reconnectDrive())}
        onBackupNow={() => save({ manualSnapshot: true })}
        onSaveNowAsync={() => save()}
        onSignOut={signOut}
        onListSnapshots={listSnapshots}
        onRestoreSnapshot={restoreSnapshot}
        onBeforeDelete={snapshotBeforeDelete}
        onExportExcel={exportExcel}
        lock={lock}
        online={online}
        readOnly={readOnly}
        movedInfo={movedInfo}
        blockedNotice={blockedNotice}
        onAskTakeOver={() => setAskTakeOver(true)}
      />
      {gate === 'ready' && lock.mode === 'view-only' && (lock.reason === 'in-use' || askTakeOver) && (
        <InUseDialog holder={lock.holder} onTakeOver={takeOver} onViewOnly={stayViewOnly} />
      )}
      {status === 'conflict' && (
        <ConflictDialog
          driveTime={conflictDriveTime}
          loadedAt={loadedAt}
          pendingChanges={Math.max(0, changeCount - savedBaseline)}
          onLoadDrive={() => void loadDriveVersion()}
          onKeepTab={() => void keepTabVersion()}
        />
      )}
    </BrowserRouter>
  );
}

/* ================= Sign in & loading (signin.html) ================= */

function Brand({ className = '' }: { className?: string }) {
  return (
    <div className={`w-brand ${className}`.trim()} style={{ padding: 0 }}>
      <span className="w-brand__mark"><Icon name="account_balance_wallet" /></span>
      <span className="t-heading">Finance Tracker</span>
    </div>
  );
}

function SignInScreen({
  view,
  profile,
  loadInfo,
  schemaInfo,
  message,
  onSignIn,
  onGrant,
  onRetry,
  onStartFresh,
  onSignOut,
}: {
  view: 'signin' | 'loading' | 'firstrun' | 'schema' | 'permission' | 'reconnect';
  profile?: Profile;
  loadInfo?: LoadInfo;
  schemaInfo?: { fileVersion: number; supported: number; savedAt: string | null };
  message: string;
  onSignIn: () => void;
  onGrant?: () => void;
  onRetry?: () => void;
  onStartFresh?: () => void;
  onSignOut?: () => void;
}) {
  return (
    <div className="si">
      <section className="si__hero">
        <Brand />
        <span className="t-display" style={{ maxWidth: 460 }}>Your spending, on the big screen.</span>
        <div className="si__pts">
          <div className="si__pt"><Icon name="file_download" /><div className="col gap-0"><span className="t-label">Import many statements at once</span><span className="t-small muted">Drop a quarter’s worth of bank, UPI and card files and review them in one table.</span></div></div>
          <div className="si__pt"><Icon name="sync" /><div className="col gap-0"><span className="t-label">Same data as your phone</span><span className="t-small muted">Both use one file on your Google Drive. One device edits at a time; you can take over or just view.</span></div></div>
          <div className="si__pt"><Icon name="shield" /><div className="col gap-0"><span className="t-label">Nothing kept in this browser</span><span className="t-small muted">Data loads into this tab from Drive and is gone when you close it.</span></div></div>
        </div>
      </section>

      <main className="si__main">
        {view === 'signin' && (
          <div className="si__card">
            <Brand className="si__brand" />
            <div className="col gap-1"><h1 className="t-title" style={{ margin: 0 }}>Sign in</h1><span className="t-small muted">Use the Google account you use in the phone app.</span></div>
            <button type="button" className="gbtn" onClick={onSignIn}><span className="gbtn__g" />Continue with Google</button>
            {message && <div className="banner banner--danger" role="alert"><Icon name="error" /><div className="banner__copy t-small">{message}</div></div>}
            <div className="card card--subtle col gap-2">
              <div className="row gap-2"><Icon name="lock" className="ms-14 c-accent" /><span className="t-small-em">What the app can see</span></div>
              <span className="t-small muted">Only the files it created in your Drive. Not your other files, email or contacts.</span>
            </div>
            <span className="t-caption muted">Needs an internet connection. Your data is never sent anywhere except your own Google Drive.</span>
          </div>
        )}

        {view === 'loading' && profile && loadInfo && <LoadingCard profile={profile} info={loadInfo} onRetry={onRetry} onSignOut={onSignOut} />}

        {view === 'firstrun' && profile && (
          <div className="si__card">
            <div className="col gap-1"><h1 className="t-title" style={{ margin: 0 }}>No data file yet</h1><span className="t-small muted">There’s no {LIVE_FILE_LABEL} in {profile.email}’s Drive.</span></div>
            <div className="choice"><span className="em-box"><Icon name="phone_android" /></span><div className="grow col gap-1"><span className="t-label">I use the phone app</span><span className="t-small muted">Open it, go to Settings › Drive &amp; backups and tap <b>Back up now</b>. Then reload this page.</span></div></div>
            <button type="button" className="choice" onClick={onStartFresh}><span className="em-box"><Icon name="add" /></span><div className="grow col gap-1"><span className="t-label">Start fresh on the web</span><span className="t-small muted">Creates an empty file with the default categories. The phone app can use it too.</span></div></button>
            {message && <div className="banner banner--danger" role="alert"><Icon name="error" /><div className="banner__copy t-small">{message}</div></div>}
            <div className="row gap-2"><button type="button" className="btn btn--primary" onClick={onRetry}><Icon name="refresh" />Check again</button><button type="button" className="btn btn--ghost" onClick={onSignOut}>Use a different account</button></div>
          </div>
        )}

        {view === 'schema' && schemaInfo && (
          <div className="si__card">
            <span className="w-dialog__icon w-dialog__icon--review"><Icon name="update" /></span>
            <div className="col gap-1"><h1 className="t-title" style={{ margin: 0 }}>The website needs an update</h1><span className="t-small muted">Your data file was saved by a newer phone app (data version {schemaInfo.fileVersion}). This website understands up to version {schemaInfo.supported}, so it won’t open the file and risk damaging it.</span></div>
            <div className="card card--subtle col gap-2">
              <div className="row row--between"><span className="t-small muted">File version</span><span className="t-small-em">{schemaInfo.fileVersion}{schemaInfo.savedAt ? ` · saved ${friendlyDateTime(new Date(schemaInfo.savedAt)).replace(/,.*$/, '').toLowerCase()}` : ''}</span></div>
              <div className="row row--between"><span className="t-small muted">Website supports</span><span className="t-small-em">up to {schemaInfo.supported}</span></div>
            </div>
            <div className="row gap-2"><button type="button" className="btn btn--primary" onClick={() => window.location.reload()}><Icon name="refresh" />Reload website</button><button type="button" className="btn btn--ghost" onClick={onSignOut}>Sign out</button></div>
            <span className="t-caption muted">Nothing was changed on Drive.</span>
          </div>
        )}

        {view === 'permission' && (
          <div className="si__card">
            <span className="w-dialog__icon w-dialog__icon--danger"><Icon name="folder_off" /></span>
            <div className="col gap-1"><h1 className="t-title" style={{ margin: 0 }}>Drive access wasn’t given</h1><span className="t-small muted">You signed in, but the box that lets the app use its own Drive files was left unticked. Without it the website can’t open your data.</span></div>
            <button type="button" className="gbtn" onClick={onGrant}><span className="gbtn__g" />Grant Drive access</button>
            {message && <div className="banner banner--danger" role="alert"><Icon name="error" /><div className="banner__copy t-small">{message}</div></div>}
            <span className="t-caption muted">On Google’s screen, tick “See, edit, create and delete only the specific Google Drive files you use with this app”.</span>
            <button type="button" className="btn btn--ghost" style={{ alignSelf: 'flex-start' }} onClick={onSignOut}>Sign out</button>
          </div>
        )}

        {/* A restored session has no Drive token (Google only hands it out at sign-in), so ask for it again. */}
        {view === 'reconnect' && profile && (
          <div className="si__card">
            <div className="row gap-3"><span className="avatar" style={{ width: 40, height: 40 }}>{initials(profile.name)}</span><div className="col gap-0"><span className="t-label">{profile.name}</span><span className="t-caption muted">{profile.email}</span></div></div>
            <div className="col gap-1"><h1 className="t-title" style={{ margin: 0 }}>Open your data</h1><span className="t-small muted">You’re still signed in. Allow Drive access again to load {LIVE_FILE_LABEL} into this tab.</span></div>
            <button type="button" className="gbtn" onClick={onGrant}><span className="gbtn__g" />Continue with Google Drive</button>
            {message && <div className="banner banner--danger" role="alert"><Icon name="error" /><div className="banner__copy t-small">{message}</div></div>}
            <button type="button" className="btn btn--ghost" style={{ alignSelf: 'flex-start' }} onClick={onSignOut}>Sign out</button>
          </div>
        )}
      </main>
    </div>
  );
}

function LoadingCard({ profile, info, onRetry, onSignOut }: { profile: Profile; info: LoadInfo; onRetry?: () => void; onSignOut?: () => void }) {
  const total = info.total ?? info.file?.size ?? null;
  const percent = info.step === 'checking' ? 100 : info.step === 'downloading' && total ? Math.min(100, (info.loaded / total) * 100) : 6;
  const stepClass = (step: LoadInfo['step']) => {
    const order: LoadInfo['step'][] = ['finding', 'downloading', 'checking'];
    const current = order.indexOf(info.step);
    const index = order.indexOf(step);
    if (index < current) return 'step step--done';
    if (index === current) return info.error ? 'step step--todo' : 'step step--now';
    return 'step step--todo';
  };
  const stepIcon = (step: LoadInfo['step']) => {
    const cls = stepClass(step);
    if (cls.includes('done')) return 'check_circle';
    if (cls.includes('now')) return 'progress_activity';
    return 'radio_button_unchecked';
  };
  const savedAt = info.file ? friendlyDateTime(new Date(info.file.modifiedTime)).replace(/^Today/, 'today').replace(/^Yesterday/, 'yesterday') : '';
  return (
    <div className="si__card" aria-live="polite">
      <div className="row gap-3"><span className="avatar" style={{ width: 40, height: 40 }}>{initials(profile.name)}</span><div className="col gap-0"><span className="t-label">{profile.name}</span><span className="t-caption muted">{profile.email}</span></div></div>
      <div className="col gap-1"><h1 className="t-title" style={{ margin: 0 }}>Opening your data</h1><span className="t-small muted">Downloading {LIVE_FILE_LABEL} from Drive{total ? ` (${megabytes(total)} MB)` : ''}.</span></div>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><span style={{ width: `${percent}%` }} /></div>
      <div className="steps">
        <div className="step step--done"><Icon name="check_circle" /><span className="t-small">Signed in</span></div>
        <div className={stepClass('finding')}><Icon name={stepIcon('finding')} /><span className="t-small">{info.file ? `Found ${LIVE_FILE_LABEL} · saved ${savedAt}` : `Looking for ${LIVE_FILE_LABEL}…`}</span></div>
        <div className={stepClass('downloading')}><Icon name={stepIcon('downloading')} /><span className="t-small">{info.step === 'downloading' && total ? `Downloading… ${megabytes(info.loaded)} of ${megabytes(total)} MB` : 'Downloading'}</span></div>
        <div className={stepClass('checking')}><Icon name={stepIcon('checking')} /><span className="t-small">Checking the data</span></div>
      </div>
      {info.error ? (
        <>
          <div className="banner banner--danger banner--wrap" role="alert"><Icon name="error" /><div className="banner__copy"><div className="t-small-em">Couldn’t open your data</div><div className="t-small muted">{info.error}</div></div></div>
          <div className="row gap-2"><button type="button" className="btn btn--primary" onClick={onRetry}><Icon name="refresh" />Try again</button><button type="button" className="btn btn--ghost" onClick={onSignOut}>Sign out</button></div>
        </>
      ) : (
        <div className="banner banner--review banner--wrap"><Icon name="phone_android" /><div className="banner__copy t-small">If your phone is editing, you'll be asked to take over or view only.</div></div>
      )}
    </div>
  );
}

/* ================= App shell (web.js buildShell) ================= */

const PAGE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/transactions': 'Activity',
  '/activity': 'Activity',
  '/import': 'Import',
  '/lending': 'Lending',
  '/settings': 'Settings',
};

function useReviewCount(dbEpoch: number): number {
  const revision = useDatabaseRevision();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!dbEpoch) {
      setCount(0);
      return;
    }
    let active = true;
    void import('@finance-tracker/core/db/repository').then(({ getAllTransactions }) => {
      if (active) setCount(getAllTransactions().filter((txn) => txn.needsReview).length);
    });
    return () => {
      active = false;
    };
  }, [dbEpoch, revision]);
  return count;
}

function relativeSaved(savedAt: Date | null, now: number): string {
  if (!savedAt) return 'Saved to Drive';
  const minutes = Math.floor((now - savedAt.getTime()) / 60_000);
  if (minutes < 1) return 'Saved to Drive · just now';
  if (minutes < 60) return `Saved to Drive · ${minutes} min ago`;
  return `Saved to Drive · ${friendlyDateTime(savedAt).replace(/^Today, /, '')}`;
}

function AppShell({
  profile,
  status,
  pendingChanges,
  savedAt,
  savedByTab,
  loadedAt,
  message,
  readError,
  signedOutElsewhere,
  databaseReplacementInProgress,
  dbEpoch,
  onReconnect,
  onSaveNow,
  onRetryLoad,
  onBackupNow,
  onSaveNowAsync,
  onSignOut,
  onListSnapshots,
  onRestoreSnapshot,
  onBeforeDelete,
  onExportExcel,
  lock,
  online,
  readOnly,
  movedInfo,
  blockedNotice,
  onAskTakeOver,
}: {
  profile: Profile;
  status: SaveStatus;
  pendingChanges: number;
  savedAt: Date | null;
  savedByTab: boolean;
  loadedAt: Date | null;
  message: string;
  readError: boolean;
  signedOutElsewhere: boolean;
  databaseReplacementInProgress: boolean;
  dbEpoch: number;
  onReconnect: () => void;
  onSaveNow: () => void;
  onRetryLoad: () => void;
  onBackupNow: () => Promise<boolean>;
  onSaveNowAsync: () => Promise<boolean>;
  onSignOut: () => Promise<void>;
  onListSnapshots: () => Promise<SnapshotFile[]>;
  onRestoreSnapshot: (id: string) => Promise<void>;
  onBeforeDelete: () => Promise<void>;
  onExportExcel: (toDrive: boolean) => Promise<void>;
  lock: EditSessionState;
  online: boolean;
  readOnly: boolean;
  movedInfo: MovedInfo | null;
  blockedNotice: boolean;
  onAskTakeOver: () => void;
}) {
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [topActions, setTopActions] = useState<HTMLElement | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const reviewCount = useReviewCount(readError ? 0 : dbEpoch);
  const isActivity = location.pathname === '/transactions' || location.pathname === '/activity';
  const title = PAGE_TITLES[location.pathname] ?? 'Home';

  useEffect(() => {
    document.title = `${title} · Finance Tracker`;
  }, [title]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
      } else if (event.key === '/' && searchRef.current?.getClientRects().length) {
        event.preventDefault();
        searchRef.current.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const content: ReactNode = readError ? (
    <div className="w-body">
      <main className="w-main">
        <div className="col gap-3" style={{ maxWidth: 560, margin: 'var(--sp-6) auto 0', width: '100%' }}>
          <div className="banner banner--danger banner--wrap" role="alert"><Icon name="error" />
            <div className="banner__copy"><div className="t-small-em">Couldn’t read your Drive file</div>
              <div className="t-small muted">{LIVE_FILE_LABEL} downloaded, but it isn’t a Finance Tracker database (it may be damaged). Nothing was changed on Drive.</div></div></div>
          <div className="row gap-2 wrap"><button type="button" className="btn btn--primary" onClick={onRetryLoad}><Icon name="refresh" />Try again</button><button type="button" className="btn" onClick={() => setRestoreOpen(true)}>Restore a snapshot</button></div>
        </div>
      </main>
    </div>
  ) : (
    <Suspense fallback={<div className="w-fallback" role="status"><span className="t-small muted">Loading…</span></div>}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/transactions" element={<TransactionsPage search={search} onSearchChange={setSearch} />} />
        <Route path="/activity" element={<TransactionsPage search={search} onSearchChange={setSearch} />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/lending" element={<LendingPage />} />
        <Route path="/settings" element={<SettingsPage
          email={profile.email}
          name={profile.name}
          status={status}
          savedAt={savedAt}
          onBackupNow={onBackupNow}
          onSaveNow={onSaveNowAsync}
          onListSnapshots={onListSnapshots}
          onRestoreSnapshot={onRestoreSnapshot}
          onBeforeDelete={onBeforeDelete}
          onSignOut={onSignOut}
          onExportExcel={onExportExcel}
        />} />
        <Route path="*" element={<DashboardPage />} />
      </Routes>
    </Suspense>
  );

  return (
    <TopActionsContext.Provider value={topActions}>
      <div className="w-app" inert={databaseReplacementInProgress} aria-busy={databaseReplacementInProgress}>
        <aside className="w-side">
          <div className="w-brand"><span className="w-brand__mark"><Icon name="account_balance_wallet" /></span><span className="w-brand__name t-heading">Finance Tracker</span></div>
          <nav className="w-nav" aria-label="Main">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} title={item.label} aria-label={item.label} className={({ isActive }) => `w-nav__item${isActive || (item.to === '/transactions' && location.pathname === '/activity') ? ' is-active' : ''}`}>
                <Icon name={item.icon} /><span className="w-nav__label">{item.label}</span>
                {item.to === '/transactions' && reviewCount > 0 && <span className="pill-count w-nav__count" title={`${reviewCount} need review`}>{reviewCount}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="w-side__spacer" />
          <div className="w-side__foot">
            <button type="button" className="w-nav__item" title="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}><Icon name="keyboard" /><span className="w-nav__label">Shortcuts</span><span className="kbd w-nav__count">?</span></button>
            <Link className="w-account" to="/settings?section=account" title={profile.name}><span className="avatar">{initials(profile.name)}</span>
              <span className="w-account__copy col gap-0" style={{ minWidth: 0 }}><span className="t-small-em truncate">{profile.name}</span><span className="t-caption muted truncate">{profile.email}</span></span></Link>
          </div>
        </aside>

        <div className="w-col">
          <header className="w-top">
            <h1 className="w-top__title t-heading truncate">{title}</h1>
            <div className="w-top__spacer" />
            {isActivity && (
              <label className="w-search"><Icon name="search" /><input ref={searchRef} className="grow" aria-label="Search payee, note, amount" aria-keyshortcuts="/" placeholder="Search payee, note, amount…" value={search} onChange={(event) => setSearch(event.target.value)} /><span className="kbd" aria-hidden="true">/</span></label>
            )}
            <SyncPill status={status} lock={online ? lock : null} pendingChanges={pendingChanges} savedAt={savedAt} savedByTab={savedByTab} loadedAt={loadedAt} onSaveNow={onSaveNow} onReconnect={onReconnect} onTakeOver={onAskTakeOver} />
            <div ref={setTopActions} style={{ display: 'contents' }} />
          </header>

          {online && lock.mode === 'view-only' && <LockBanner lock={lock} movedInfo={movedInfo} onTakeOver={onAskTakeOver} />}
          {status === 'reconnect' && (
            <div className="w-shell-banner"><div className="banner banner--review banner--wrap"><Icon name="link_off" /><div className="banner__copy"><div className="t-small-em">Google Drive disconnected · editing paused</div><div className="t-small muted">{pendingChanges > 0 ? `Your ${pendingChanges} ${pendingChanges === 1 ? 'change is' : 'changes are'} kept in this tab. Reconnect to save them. Don’t close the tab until then.` : 'Reconnect to keep saving changes from this tab.'}</div></div><button type="button" className="banner__action" onClick={onReconnect}>Reconnect</button></div></div>
          )}
          {signedOutElsewhere && (
            <div className="w-shell-banner"><div className="banner banner--review banner--wrap" role="alert"><Icon name="logout" /><div className="banner__copy"><div className="t-small-em">You were signed out</div><div className="t-small muted">This tab still has unsaved changes. It closes your data as soon as they’re saved to Drive. Don’t close the tab until then.</div></div></div></div>
          )}
          {!online && (
            <div className="w-shell-banner"><div className="banner banner--review banner--wrap"><Icon name="cloud_off" /><div className="banner__copy"><div className="t-small-em">You’re offline · editing paused</div><div className="t-small muted">{pendingChanges > 0 ? `You can still browse. ${pendingChanges} ${pendingChanges === 1 ? 'change' : 'changes'} not yet saved ${pendingChanges === 1 ? 'is' : 'are'} kept in this tab and save when you’re back, unless another device takes over editing first.` : 'You can still browse. Editing resumes when you’re back online.'}</div></div></div></div>
          )}
          {blockedNotice && readOnly && (
            <div className="w-shell-banner"><div className="banner banner--review" role="status"><Icon name="visibility" /><div className="banner__copy t-small">{lock.mode === 'view-only' ? VIEW_ONLY_HINT : 'Editing is paused until this tab is online and connected to Google Drive.'}</div></div></div>
          )}
          {status === 'error' && message && (
            <div className="w-shell-banner"><div className="banner banner--danger banner--wrap" role="alert"><Icon name="error" /><div className="banner__copy"><div className="t-small-em">Couldn’t save to Drive</div><div className="t-small muted">{message}</div></div><button type="button" className="banner__action" onClick={onSaveNow}>Retry</button></div></div>
          )}

          {content}
        </div>

        <nav className="w-tabs" aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `tab${isActive || (item.to === '/transactions' && location.pathname === '/activity') ? ' is-active' : ''}`}>
              <span className="tab-ind"><Icon name={item.icon} />{item.to === '/transactions' && reviewCount > 0 && <span className="tab-badge">{reviewCount}</span>}</span><span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {restoreOpen && <RestoreSnapshotDialog onClose={() => setRestoreOpen(false)} onList={onListSnapshots} onRestore={onRestoreSnapshot} />}
      {databaseReplacementInProgress && (
        <div className="w-modal" role="status" aria-live="polite"><div className="w-dialog"><div className="w-dialog__head"><span className="w-dialog__icon"><Icon name="history" /></span><div className="col gap-1"><span className="t-heading">Restoring snapshot…</span><span className="t-small muted">Keep this tab open until the restore finishes.</span></div></div><div className="progress"><span style={{ width: '60%' }} /></div></div></div>
      )}
    </TopActionsContext.Provider>
  );
}

const SYNC_ICON: Record<SaveStatus, string> = {
  saved: 'cloud_done',
  saving: 'progress_activity',
  unsaved: 'cloud_upload',
  offline: 'cloud_off',
  reconnect: 'link_off',
  conflict: 'error',
  error: 'error',
};

function SyncPill({
  status,
  lock,
  pendingChanges,
  savedAt,
  savedByTab,
  loadedAt,
  onSaveNow,
  onReconnect,
  onTakeOver,
}: {
  status: SaveStatus;
  /** The edit lock, or null while offline (the save status says that). */
  lock: EditSessionState | null;
  pendingChanges: number;
  savedAt: Date | null;
  savedByTab: boolean;
  loadedAt: Date | null;
  onSaveNow: () => void;
  onReconnect: () => void;
  onTakeOver: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const anchorRef = useRef<HTMLSpanElement>(null);
  const size = useMemo(() => (open ? exportSize() : ''), [open]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const text = {
    saved: relativeSaved(savedAt, now),
    saving: 'Saving…',
    unsaved: `Unsaved · ${pendingChanges} ${pendingChanges === 1 ? 'change' : 'changes'}`,
    offline: 'Offline · will retry',
    reconnect: 'Reconnect Drive',
    conflict: 'Conflict · action needed',
    error: 'Not saved · retry',
  }[status];
  // While another device edits, the lock state replaces the save state.
  const lockPill = lock?.mode === 'view-only' && status !== 'reconnect'
    ? lock.reason === 'in-use'
      ? { cls: 'inuse', icon: 'devices', text: `In use on ${holderName(lock.holder, 'web')}` }
      : lock.reason === 'moved' || lock.reason === 'discarded'
        ? { cls: 'moved', icon: 'phonelink_lock', text: 'View only · editing moved' }
        : { cls: 'viewonly', icon: 'visibility', text: 'View only' }
    : null;
  const pillClass = lockPill?.cls ?? (status === 'error' ? 'conflict' : status);
  const pillIcon = lockPill?.icon ?? SYNC_ICON[status];
  const pillText = lockPill?.text ?? text;

  return (
    <span className="anchor" ref={anchorRef}>
      <button type="button" className={`sync sync--${pillClass}`} aria-haspopup="dialog" aria-expanded={open} aria-live="polite" onClick={() => setOpen((value) => !value)}>
        <Icon name={pillIcon} /><span className="sync__text">{pillText}</span>
      </button>
      {open && (
        <div className="pop" role="dialog" aria-label="Google Drive save status" style={{ top: 40, right: 0, width: 320 }}>
          <div style={{ padding: 'var(--sp-3) var(--sp-3) var(--sp-2)' }} className="col gap-1"><span className="t-overline muted">GOOGLE DRIVE</span>
            <span className="t-small-em">{pillText}</span></div>
          <div className="dl" style={{ padding: '0 var(--sp-3)' }}>
            <div className="dl__row"><span className="dl__k">File</span><span className="dl__v">Finance Tracker / {LIVE_FILE_LABEL}</span></div>
            <div className="dl__row"><span className="dl__k">Last saved</span><span className="dl__v">{savedAt ? `${friendlyDateTime(savedAt)}${savedByTab ? ' · this tab' : ''}` : 'Not saved yet'}</span></div>
            <div className="dl__row"><span className="dl__k">Loaded at</span><span className="dl__v">{loadedAt ? friendlyDateTime(loadedAt) : '—'}</span></div>
            <div className="dl__row"><span className="dl__k">Size</span><span className="dl__v">{size}</span></div>
          </div>
          <div className="pop__foot">
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setOpen(false); navigate('/settings?section=drive'); }}>Snapshots</button>
            {lockPill
              ? <button type="button" className="btn btn--sm btn--primary" onClick={() => { setOpen(false); onTakeOver(); }}><Icon name="edit" />Take over</button>
              : status === 'reconnect'
              ? <button type="button" className="btn btn--sm btn--primary" onClick={() => { setOpen(false); onReconnect(); }}><Icon name="link" />Reconnect</button>
              : <button type="button" className="btn btn--sm btn--primary" disabled={status === 'saving' || status === 'conflict'} onClick={() => { setOpen(false); onSaveNow(); }}><Icon name="cloud_upload" />Save now</button>}
          </div>
        </div>
      )}
    </span>
  );
}

function exportSize(): string {
  try {
    return `${megabytes(exportDatabase().byteLength)} MB`;
  } catch {
    return '—';
  }
}

function LockBanner({ lock, movedInfo, onTakeOver }: { lock: EditSessionState; movedInfo: MovedInfo | null; onTakeOver: () => void }) {
  const moved = (lock.reason === 'moved' || lock.reason === 'discarded') && movedInfo;
  if (moved) {
    const who = holderName(movedInfo.holder, 'web');
    const at = movedInfo.holder ? ` at ${lockTime(movedInfo.holder.acquiredAt)}` : '';
    const count = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`;
    const detail = movedInfo.discarded
      ? `This tab is now view only. ${count(movedInfo.discarded)} it hadn’t saved yet ${movedInfo.discarded === 1 ? 'was' : 'were'} kept as a Drive snapshot for 30 days.`
      : movedInfo.kept
        ? `This tab is now view only. Its ${count(movedInfo.kept)} not yet saved ${movedInfo.kept === 1 ? 'is' : 'are'} still here; take over to save ${movedInfo.kept === 1 ? 'it' : 'them'}.`
        : 'This tab is now view only and shows the other device’s changes as they’re saved.';
    return (
      <div className="w-shell-banner"><div className="banner banner--review banner--wrap" role="status"><Icon name="phonelink_lock" /><div className="banner__copy"><div className="t-small-em">Editing moved to {who}{at}</div><div className="t-small muted">{detail}</div></div><button type="button" className="banner__action" onClick={onTakeOver}>Take over</button></div></div>
    );
  }
  const holder = lock.holder;
  const detail = holder
    ? `${capitalize(holderName(holder, 'web'))} is editing (since ${lockTime(holder.acquiredAt)}). You can browse and search, but nothing here is saved.`
    : 'No device is editing right now. Take over to edit here.';
  return (
    <div className="w-shell-banner"><div className="banner banner--wrap" role="status"><Icon name="visibility" /><div className="banner__copy"><div className="t-small-em">View only</div><div className="t-small muted">{detail}</div></div><button type="button" className="banner__action" onClick={onTakeOver}>Take over</button></div></div>
  );
}

function InUseDialog({ holder, onTakeOver, onViewOnly }: { holder: EditLock | null; onTakeOver: () => Promise<void>; onViewOnly: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onViewOnly();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onViewOnly]);
  const who = holderName(holder, 'web');
  const minutes = holder ? Math.max(0, Math.round((Date.now() - Date.parse(holder.refreshedAt)) / 60_000)) : null;
  const lastActive = minutes === null || !Number.isFinite(minutes) ? '' : minutes === 0 ? ' and was last active just now' : ` and was last active ${minutes} min ago`;
  const other = holder?.platform === 'phone' ? 'The phone' : 'The other device';
  const takeOver = () => {
    setBusy(true);
    setError('');
    onTakeOver().catch((reason: unknown) => {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : 'Could not take over editing.');
    });
  };
  return (
    <div className="w-modal">
      <div className="w-dialog" role="alertdialog" aria-modal="true" aria-labelledby="iu-t">
        <div className="w-dialog__head"><span className="w-dialog__icon w-dialog__icon--review"><Icon name="devices" /></span>
          <div className="col gap-1"><span id="iu-t" className="t-heading">In use on {who}</span>
            <span className="t-small muted">Only one device can edit at a time, so changes never overwrite each other.{holder ? ` ${capitalize(who)} has been editing since ${lockTime(holder.acquiredAt)}${lastActive}.` : ''}</span></div></div>
        <div className="card card--subtle col gap-2">
          <div className="row gap-2"><Icon name="edit" className="ms-24 c-accent" /><div className="col gap-0"><span className="t-small-em">Take over</span><span className="t-caption muted">This tab edits. {other} switches to view only. Anything it hasn’t saved yet is kept as a Drive snapshot.</span></div></div>
          <div className="row gap-2"><Icon name="visibility" className="ms-24 muted" /><div className="col gap-0"><span className="t-small-em">View only</span><span className="t-caption muted">Browse and search here. Nothing is saved. You can take over later from the banner.</span></div></div>
        </div>
        {error && <div className="banner banner--danger" role="alert"><Icon name="error" /><div className="banner__copy t-small">{error}</div></div>}
        <div className="w-dialog__actions">
          <button type="button" className="btn" disabled={busy} onClick={onViewOnly}>View only</button>
          <button type="button" className="btn btn--primary" disabled={busy} autoFocus onClick={takeOver}><Icon name="edit" />{busy ? 'Taking over…' : 'Take over'}</button>
        </div>
      </div>
    </div>
  );
}

function ConflictDialog({
  driveTime,
  loadedAt,
  pendingChanges,
  onLoadDrive,
  onKeepTab,
}: {
  driveTime: string | null;
  loadedAt: Date | null;
  pendingChanges: number;
  onLoadDrive: () => void;
  onKeepTab: () => void;
}) {
  const navigate = useNavigate();
  const driveDate = driveTime ? new Date(driveTime) : null;
  const time = (date: Date) => date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
  const changes = `${pendingChanges} unsaved ${pendingChanges === 1 ? 'change' : 'changes'}`;
  return (
    <div className="w-modal">
      <div className="w-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cf-t">
        <div className="w-dialog__head"><span className="w-dialog__icon w-dialog__icon--danger"><Icon name="sync_problem" /></span>
          <div className="col gap-1"><span id="cf-t" className="t-heading">Drive has a newer version</span>
            <span className="t-small muted">Another device saved changes to Drive{driveDate ? ` at ${time(driveDate)}` : ''}, after this tab loaded the file{loadedAt ? ` at ${time(loadedAt)}` : ''}. This tab also has {changes}. Only one version can be kept.</span></div></div>
        <div className="card card--subtle col gap-2">
          <div className="row row--between"><span className="t-small">On Drive</span><span className="t-small-em">{driveDate ? friendlyDateTime(driveDate).replace(',', '') : 'Changed elsewhere'}</span></div>
          <div className="row row--between"><span className="t-small">In this tab</span><span className="t-small-em">{pendingChanges} {pendingChanges === 1 ? 'change' : 'changes'} · not saved</span></div></div>
        <div className="row gap-1 t-caption muted"><Icon name="history" className="ms-14" />A snapshot of the version you don’t keep is saved to Drive, so you can restore it from Settings.</div>
        <div className="w-dialog__actions">
          <button type="button" className="btn btn--danger" onClick={onKeepTab}>Keep this tab’s version</button>
          <button type="button" className="btn btn--primary" onClick={() => { navigate('/'); onLoadDrive(); }}><Icon name="download" />Load Drive’s version</button>
        </div>
      </div>
    </div>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const rows: [string, string][] = [
    ['/', 'Search Activity'],
    ['?', 'Show keyboard shortcuts'],
    ['Esc', 'Close a panel, menu or dialog'],
  ];
  return (
    <div className="w-modal" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="w-dialog" role="dialog" aria-modal="true" aria-labelledby="ks-t">
        <div className="w-dialog__head"><span className="w-dialog__icon"><Icon name="keyboard" /></span>
          <div className="col gap-1"><span id="ks-t" className="t-heading">Keyboard shortcuts</span><span className="t-small muted">Work faster on a big screen.</span></div></div>
        <div className="col gap-0">
          {rows.map(([key, label]) => <div key={key} className="shortcut-row"><span className="t-small">{label}</span><span className="kbd">{key}</span></div>)}
        </div>
        <div className="w-dialog__actions"><button type="button" className="btn btn--primary" autoFocus onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

function RestoreSnapshotDialog({
  onClose,
  onList,
  onRestore,
}: {
  onClose: () => void;
  onList: () => Promise<SnapshotFile[]>;
  onRestore: (id: string) => Promise<void>;
}) {
  const [snapshots, setSnapshots] = useState<SnapshotFile[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    onList().then((files) => active && setSnapshots(files)).catch((reason) => active && setError(reason instanceof Error ? reason.message : 'Could not list snapshots.'));
    return () => {
      active = false;
    };
  }, [onList]);
  return (
    <div className="w-modal">
      <div className="w-dialog" role="dialog" aria-modal="true" aria-labelledby="rs-t">
        <div className="w-dialog__head"><span className="w-dialog__icon"><Icon name="history" /></span>
          <div className="col gap-1"><span id="rs-t" className="t-heading">Restore a snapshot</span><span className="t-small muted">Opens an earlier copy of your data. It replaces {LIVE_FILE_LABEL} on Drive the next time this tab saves.</span></div></div>
        {error && <div className="banner banner--danger" role="alert"><Icon name="error" /><div className="banner__copy t-small">{error}</div></div>}
        <div className="card card--none">
          {!snapshots && !error && <div className="lrow"><span className="t-small muted">Loading snapshots…</span></div>}
          {snapshots?.length === 0 && <div className="lrow"><span className="t-small muted">No snapshots on Drive yet.</span></div>}
          {snapshots?.slice(0, 8).map((file) => (
            <div key={file.id} className="lrow"><Icon name="description" className="muted" /><div className="grow col gap-0"><span className="t-label">{friendlyDateTime(new Date(file.modifiedTime))}</span><span className="t-caption muted truncate">{file.name}</span></div>
              <button type="button" className="btn btn--sm" disabled={busyId !== null} onClick={() => { setBusyId(file.id); onRestore(file.id).then(onClose).catch((reason) => { setBusyId(null); setError(reason instanceof Error ? reason.message : 'Could not restore.'); }); }}>{busyId === file.id ? 'Restoring…' : 'Restore'}</button></div>
          ))}
        </div>
        <div className="w-dialog__actions"><button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}

export default App;
