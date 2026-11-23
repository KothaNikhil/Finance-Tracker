import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import type { SnapshotFile } from '@finance-tracker/core/sync/engine';
import { createDriveSyncEngine, DriveReconnectRequiredError, GoogleDriveSyncPort } from './drive';
import { closeDatabase, exportDatabase, openDatabase } from './database';
import { requestDriveAccessToken, revokeDriveAccessToken, supabase } from './auth';
import './styles.css';

const DashboardPage = lazy(() => import('./DashboardPage').then((module) => ({ default: module.DashboardPage })));
const TransactionsPage = lazy(() => import('./TransactionsPage').then((module) => ({ default: module.TransactionsPage })));
const ImportPage = lazy(() => import('./ImportPage').then((module) => ({ default: module.ImportPage })));
const LendingPage = lazy(() => import('./LendingPage').then((module) => ({ default: module.LendingPage })));
const SettingsPage = lazy(() => import('./SettingsPage').then((module) => ({ default: module.SettingsPage })));

type SaveStatus =
  | 'idle'
  | 'loading'
  | 'connecting'
  | 'saved'
  | 'saving'
  | 'unsaved'
  | 'offline'
  | 'reconnect'
  | 'conflict'
  | 'error';

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/transactions', label: 'Activity', icon: 'history', end: false },
  { to: '/import', label: 'Import', icon: 'file_download', end: false },
  { to: '/lending', label: 'Lending', icon: 'swap_horiz', end: false },
  { to: '/settings', label: 'Settings', icon: 'settings', end: false },
];

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [databaseReplacementInProgress, setDatabaseReplacementInProgress] = useState(false);
  const [message, setMessage] = useState('');
  const [driveConnected, setDriveConnected] = useState(false);
  const [freshAvailable, setFreshAvailable] = useState(false);
  const [dbEpoch, setDbEpoch] = useState(0);
  const [changeCount, setChangeCount] = useState(0);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [conflictAvailable, setConflictAvailable] = useState(false);
  const engineRef = useRef<ReturnType<typeof createDriveSyncEngine> | null>(null);
  const liveFileRef = useRef<{ id: string; revisionId: string } | null>(null);
  const driveTokenRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const changeCountRef = useRef(0);
  const dirtySinceRef = useRef<number | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const operationGenerationRef = useRef(0);
  const sessionUserIdRef = useRef<string | null>(null);
  const authEventSeenRef = useRef(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active || authEventSeenRef.current) return;
      if (error) setMessage(error.message);
      sessionUserIdRef.current = data.session?.user.id ?? null;
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authEventSeenRef.current = true;
      const nextUserId = nextSession?.user.id ?? null;
      if (sessionUserIdRef.current !== nextUserId) {
        operationGenerationRef.current += 1;
        void revokeDriveAccessToken(driveTokenRef.current);
        closeDatabase();
        engineRef.current = null;
        liveFileRef.current = null;
        driveTokenRef.current = null;
        dirtyRef.current = false;
        dirtySinceRef.current = null;
        setDriveConnected(false);
        setFreshAvailable(false);
        setDbEpoch(0);
        setStatus('idle');
      }
      sessionUserIdRef.current = nextUserId;
      setSession(nextSession);
      setAuthLoading(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const markDirty = () => {
      dirtyRef.current = true;
      dirtySinceRef.current ??= Date.now();
      changeCountRef.current += 1;
      setChangeCount(changeCountRef.current);
      setStatus((current) => (current === 'conflict' ? current : 'unsaved'));
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
      if (dirtyRef.current) setStatus('offline');
    };
    const onOnline = () => {
      if (dirtyRef.current) void saveRef.current();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  const saveNow = useCallback(async () => {
    if (!dirtyRef.current || !dbEpoch || savingRef.current) return;
    const engine = engineRef.current;
    if (!engine) {
      setStatus('reconnect');
      return;
    }
    if (!navigator.onLine) {
      setStatus('offline');
      return;
    }

    savingRef.current = true;
    const savedChangeCount = changeCountRef.current;
    let saveAgain = false;
    setStatus('saving');
    setMessage('');
    try {
      const result = await engine.save(exportDatabase(), {
        expectedFileId: liveFileRef.current?.id ?? null,
        expectedRevisionId: liveFileRef.current?.revisionId ?? null,
      });
      if (result.kind === 'conflict') {
        setStatus('conflict');
        setConflictAvailable(true);
        return;
      }
      liveFileRef.current = result.file;
      setSavedAt(new Date());
      if (changeCountRef.current === savedChangeCount) {
        dirtyRef.current = false;
        dirtySinceRef.current = null;
        setStatus('saved');
      } else {
        setStatus('unsaved');
        saveAgain = true;
      }
    } catch (error) {
      if (error instanceof DriveReconnectRequiredError) setStatus('reconnect');
      else {
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'Could not save to Google Drive.');
      }
    } finally {
      savingRef.current = false;
      if (saveAgain) window.setTimeout(() => void saveRef.current(), 250);
    }
  }, [dbEpoch]);

  useEffect(() => {
    saveRef.current = saveNow;
  }, [saveNow]);

  const connectDrive = useCallback(async () => {
    const operation = ++operationGenerationRef.current;
    setStatus('connecting');
    setMessage('');
    try {
      const token = await requestDriveAccessToken();
      if (operation !== operationGenerationRef.current) {
        await revokeDriveAccessToken(token);
        return;
      }
      driveTokenRef.current = token;
      const engine = createDriveSyncEngine(token);
      engineRef.current = engine;

      if (dbEpoch && dirtyRef.current) {
        setDriveConnected(true);
        await saveRef.current();
        return;
      }

      setStatus('loading');
      const loaded = await engine.load();
      if (operation !== operationGenerationRef.current) {
        await revokeDriveAccessToken(token);
        return;
      }
      if (loaded.kind === 'fresh') {
        liveFileRef.current = null;
        setFreshAvailable(true);
        setDriveConnected(true);
        setStatus('idle');
        return;
      }
      await openDatabase(loaded.bytes);
      liveFileRef.current = loaded.file;
      setDbEpoch((epoch) => epoch + 1);
      setFreshAvailable(false);
      setDriveConnected(true);
      dirtyRef.current = false;
      dirtySinceRef.current = null;
      setStatus('saved');
      setSavedAt(new Date(loaded.file.modifiedTime));
    } catch (error) {
      setStatus(error instanceof DriveReconnectRequiredError ? 'reconnect' : 'error');
      setMessage(error instanceof Error ? error.message : 'Could not connect to Google Drive.');
    }
  }, [dbEpoch]);

  const startFresh = useCallback(async () => {
    const operation = ++operationGenerationRef.current;
    try {
      await openDatabase();
      if (operation !== operationGenerationRef.current) {
        closeDatabase();
        return;
      }
      setDbEpoch((epoch) => epoch + 1);
      setFreshAvailable(false);
      dirtyRef.current = true;
      dirtySinceRef.current = Date.now();
      changeCountRef.current += 1;
      setChangeCount(changeCountRef.current);
      setStatus('unsaved');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Could not create a database.');
    }
  }, []);

  const reloadDriveVersion = useCallback(async () => {
    const operation = ++operationGenerationRef.current;
    const engine = engineRef.current;
    if (!engine) return;
    setStatus('loading');
    try {
      const loaded = await engine.load();
      if (operation !== operationGenerationRef.current) return;
      if (loaded.kind === 'fresh') throw new Error('The live database is no longer available.');
      await openDatabase(loaded.bytes);
      if (operation !== operationGenerationRef.current) {
        closeDatabase();
        return;
      }
      liveFileRef.current = loaded.file;
      dirtyRef.current = false;
      dirtySinceRef.current = null;
      setDbEpoch((epoch) => epoch + 1);
      setConflictAvailable(false);
      setStatus('saved');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Could not reload the Drive database.');
    }
  }, []);

  const overwriteDriveVersion = useCallback(async () => {
    const operation = ++operationGenerationRef.current;
    const engine = engineRef.current;
    if (!engine || !dbEpoch) return;
    setStatus('saving');
    try {
      const result = await engine.save(exportDatabase(), {
        expectedFileId: liveFileRef.current?.id ?? null,
        expectedRevisionId: liveFileRef.current?.revisionId ?? null,
        force: true,
      });
      if (operation !== operationGenerationRef.current) return;
      if (result.kind === 'conflict') {
        setStatus('conflict');
        return;
      }
      liveFileRef.current = result.file;
      dirtyRef.current = false;
      dirtySinceRef.current = null;
      setSavedAt(new Date());
      setConflictAvailable(false);
      setStatus('saved');
    } catch (error) {
      setStatus(error instanceof DriveReconnectRequiredError ? 'reconnect' : 'error');
      setMessage(error instanceof Error ? error.message : 'Could not overwrite the Drive database.');
    }
  }, [dbEpoch]);

  const backupNow = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !dbEpoch || savingRef.current) return false;
    savingRef.current = true;
    const savedChangeCount = changeCountRef.current;
    let saveAgain = false;
    setStatus('saving');
    setMessage('');
    try {
      const result = await engine.save(exportDatabase(), {
        expectedFileId: liveFileRef.current?.id ?? null,
        expectedRevisionId: liveFileRef.current?.revisionId ?? null,
        manualSnapshot: true,
      });
      if (result.kind === 'conflict') {
        setStatus('conflict');
        setConflictAvailable(true);
        return false;
      }
      liveFileRef.current = result.file;
      setSavedAt(new Date());
      if (changeCountRef.current === savedChangeCount) {
        dirtyRef.current = false;
        dirtySinceRef.current = null;
        setStatus('saved');
      } else {
        saveAgain = true;
        setStatus('unsaved');
      }
      return !saveAgain;
    } catch (error) {
      setStatus(error instanceof DriveReconnectRequiredError ? 'reconnect' : 'error');
      setMessage(error instanceof Error ? error.message : 'Could not create a Drive snapshot.');
      return false;
    } finally {
      savingRef.current = false;
      if (saveAgain) window.setTimeout(() => void saveRef.current(), 250);
    }
  }, [dbEpoch]);

  const listSnapshots = useCallback(async () => {
    const token = driveTokenRef.current;
    if (!token) throw new DriveReconnectRequiredError();
    return new GoogleDriveSyncPort(token).listSnapshots();
  }, []);

  const snapshotBeforeDelete = useCallback(async () => {
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
    const token = driveTokenRef.current;
    if (!token || !engineRef.current) throw new DriveReconnectRequiredError();
    setDatabaseReplacementInProgress(true);
    try {
      if (dirtyRef.current) await saveRef.current();
      if (dirtyRef.current) throw new Error('Resolve the pending Drive save before restoring a snapshot.');
      const operation = operationGenerationRef.current;
      const drive = new GoogleDriveSyncPort(token);
      setStatus('loading');
      await drive.createSnapshot(`Finance-Tracker-backup-${Date.now()}-before-restore.db`, exportDatabase());
      const bytes = await drive.download(snapshotId);
      if (operation !== operationGenerationRef.current) return;
      await openDatabase(bytes);
      if (operation !== operationGenerationRef.current) {
        closeDatabase();
        return;
      }
      dirtyRef.current = true;
      dirtySinceRef.current = Date.now();
      setDbEpoch((epoch) => epoch + 1);
      setStatus('unsaved');
      setConflictAvailable(false);
      const { touchDataUpdatedAt } = await import('@finance-tracker/core/db/repository');
      touchDataUpdatedAt();
    } catch (error) {
      setStatus(error instanceof DriveReconnectRequiredError ? 'reconnect' : 'error');
      setMessage(error instanceof Error ? error.message : 'Could not restore the Drive snapshot.');
      throw error;
    } finally {
      setDatabaseReplacementInProgress(false);
    }
  }, []);

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
      options: { redirectTo: window.location.origin, scopes: 'email profile' },
    });
    if (error) setMessage(error.message);
  }, []);

  const signOut = useCallback(async () => {
    operationGenerationRef.current += 1;
    if (dirtyRef.current) {
      await saveRef.current();
      if (dirtyRef.current || status === 'conflict' || status === 'reconnect') return;
    }
    try {
      await revokeDriveAccessToken(driveTokenRef.current);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      closeDatabase();
      engineRef.current = null;
      liveFileRef.current = null;
      driveTokenRef.current = null;
      dirtyRef.current = false;
      setDriveConnected(false);
      setFreshAvailable(false);
      setDbEpoch(0);
      setStatus('idle');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sign out safely.');
    }
  }, [status]);

  if (authLoading) return <div className="center-screen">Loading your session…</div>;
  if (!session) {
    return (
      <SignInPage
        message={message}
        onSignIn={() => void signIn()}
      />
    );
  }
  if (!driveConnected) {
    return (
      <ConnectPage
        email={session.user.email ?? 'Google account'}
        loading={status === 'connecting' || status === 'loading'}
        message={message}
        onConnect={() => void connectDrive()}
        onSignOut={signOut}
      />
    );
  }
  if (freshAvailable) {
    return (
      <FreshDatabasePage
        email={session.user.email ?? 'Google account'}
        message={message}
        onStartFresh={() => void startFresh()}
        onSignOut={signOut}
      />
    );
  }
  if (!dbEpoch) return <div className="center-screen">Opening your in-memory database…</div>;

  return (
    <BrowserRouter>
      <AppShell
        status={status}
        databaseReplacementInProgress={databaseReplacementInProgress}
        savedAt={savedAt}
        message={message}
        email={session.user.email ?? 'Google account'}
        onReconnect={() => void connectDrive()}
        onBackupNow={backupNow}
        onSignOut={signOut}
        onListSnapshots={listSnapshots}
        onRestoreSnapshot={restoreSnapshot}
        onBeforeDelete={snapshotBeforeDelete}
        onExportExcel={exportExcel}
      />
      {status === 'conflict' && conflictAvailable && (
        <ConflictDialog
          onReload={() => void reloadDriveVersion()}
          onOverwrite={() => void overwriteDriveVersion()}
        />
      )}
    </BrowserRouter>
  );
}

function SignInPage({ message, onSignIn }: { message: string; onSignIn: () => void }) {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-mark"><span className="material-symbols-rounded">account_balance_wallet</span></div>
        <p className="eyebrow">PERSONAL FINANCE</p>
        <h1>Your money, clearly.</h1>
        <p className="muted">Sign in with Google to open your Finance Tracker database from Drive.</p>
        <button className="button button-primary button-wide" onClick={onSignIn}>
          <span className="material-symbols-rounded">login</span> Continue with Google
        </button>
        {message && <p className="error-text" role="alert">{message}</p>}
        <p className="privacy-note">Your financial database stays in memory in this tab and is saved to your Google Drive.</p>
      </section>
    </main>
  );
}

function ConnectPage({
  email,
  loading,
  message,
  onConnect,
  onSignOut,
}: {
  email: string;
  loading: boolean;
  message: string;
  onConnect: () => void;
  onSignOut: () => Promise<void>;
}) {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-mark"><span className="material-symbols-rounded">cloud_sync</span></div>
        <p className="eyebrow">GOOGLE DRIVE</p>
        <h1>Connect your finance file</h1>
        <p className="muted">Signed in as <strong>{email}</strong>. Grant Drive file access to load and autosave your database.</p>
        <button className="button button-primary button-wide" disabled={loading} onClick={onConnect}>
          <span className="material-symbols-rounded">add_to_drive</span>
          {loading ? 'Connecting…' : 'Connect Google Drive'}
        </button>
        {message && <p className="error-text" role="alert">{message}</p>}
        <button className="button button-quiet" onClick={onSignOut}>Sign out</button>
      </section>
    </main>
  );
}

function FreshDatabasePage({
  email,
  message,
  onStartFresh,
  onSignOut,
}: {
  email: string;
  message: string;
  onStartFresh: () => void;
  onSignOut: () => Promise<void>;
}) {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-mark"><span className="material-symbols-rounded">database</span></div>
        <p className="eyebrow">NO DATABASE FOUND</p>
        <h1>Start with a clean file?</h1>
        <p className="muted">No live database or phone backup is visible in this Drive folder. If your phone backup was created by another app version, connect again after updating the phone app.</p>
        <button className="button button-primary button-wide" onClick={onStartFresh}>Start fresh</button>
        {message && <p className="error-text" role="alert">{message}</p>}
        <button className="button button-quiet" onClick={onSignOut}>Sign out · {email}</button>
      </section>
    </main>
  );
}

function AppShell({
  status,
  databaseReplacementInProgress,
  savedAt,
  message,
  email,
  onReconnect,
  onBackupNow,
  onSignOut,
  onListSnapshots,
  onRestoreSnapshot,
  onBeforeDelete,
  onExportExcel,
}: {
  status: SaveStatus;
  databaseReplacementInProgress: boolean;
  savedAt: Date | null;
  message: string;
  email: string;
  onReconnect: () => void;
  onBackupNow: () => Promise<boolean>;
  onSignOut: () => Promise<void>;
  onListSnapshots: () => Promise<SnapshotFile[]>;
  onRestoreSnapshot: (id: string) => Promise<void>;
  onBeforeDelete: () => Promise<void>;
  onExportExcel: (toDrive: boolean) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (!searchRef.current?.getClientRects().length) return;
      event.preventDefault();
      searchRef.current.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const statusText = status === 'saved'
    ? `Saved${savedAt ? ` · ${savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`
    : (({
        saving: 'Saving…',
        unsaved: 'Unsaved changes',
        offline: 'Offline · will retry',
        reconnect: 'Reconnect Drive',
        conflict: 'Conflict · action needed',
        error: 'Save error',
      } as Partial<Record<SaveStatus, string>>)[status] ?? 'Connected');
  const syncIcon = ({
    saved: 'cloud_done',
    saving: 'progress_activity',
    unsaved: 'cloud_upload',
    offline: 'cloud_off',
    reconnect: 'link_off',
    conflict: 'error',
    error: 'warning',
  } as Partial<Record<SaveStatus, string>>)[status] ?? 'cloud_sync';

  return (
    <>
    <div className="app-shell" inert={databaseReplacementInProgress} aria-busy={databaseReplacementInProgress}>
      <aside className="sidebar">
        <NavLink className="brand" to="/">
          <span className="brand-mark brand-mark-small"><span className="material-symbols-rounded" aria-hidden="true">account_balance_wallet</span></span>
          <span className="brand-name">Finance Tracker</span>
        </NavLink>
        <nav className="side-nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} aria-label={item.label} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <span className="material-symbols-rounded" aria-hidden="true">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="account-row"><span className="avatar">{email.slice(0, 1).toUpperCase()}</span><span className="account-email" title={email}>{email}</span></div>
          <button className="button button-quiet sidebar-signout" onClick={() => void onSignOut()}>Sign out</button>
        </div>
      </aside>
      <div className="app-column">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark brand-mark-small"><span className="material-symbols-rounded" aria-hidden="true">account_balance_wallet</span></span><strong>Finance Tracker</strong></div>
          <div className="topbar-search">
            <span className="material-symbols-rounded" aria-hidden="true">search</span>
            <input ref={searchRef} aria-label="Search transactions" aria-keyshortcuts="/" placeholder="Search transactions" value={search} onChange={(event) => setSearch(event.target.value)} />
            <kbd aria-hidden="true">/</kbd>
          </div>
          <div className="topbar-spacer" />
          <button className="backup-now" disabled={status === 'saving' || status === 'conflict' || status === 'reconnect'} onClick={() => void onBackupNow()} title="Create a Drive backup now">
            <span className="material-symbols-rounded" aria-hidden="true">backup</span><span>Back up now</span>
          </button>
          <button
            className={`save-status save-${status}`}
            disabled={status !== 'reconnect'}
            onClick={status === 'reconnect' ? onReconnect : undefined}
            aria-live="polite"
          >
            <span className="material-symbols-rounded" aria-hidden="true">{syncIcon}</span>{statusText}
          </button>
        </header>
        {status === 'reconnect' && (
          <div className="shell-banner"><span>Drive needs to reconnect. Your changes remain in this tab.</span><button className="text-button" onClick={onReconnect}>Reconnect</button></div>
        )}
        {status === 'offline' && <div className="shell-banner shell-banner-warn">Offline — changes remain in memory and will retry when you’re back online.</div>}
        {status === 'error' && <div className="shell-banner shell-banner-error" role="alert">{message}</div>}
        <main className="page-content">
          <Suspense fallback={<div className="center-screen" role="status">Loading page…</div>}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/transactions" element={<TransactionsPage search={search} />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/lending" element={<LendingPage />} />
              <Route path="/settings" element={<SettingsPage
                email={email}
                status={status}
                savedAt={savedAt}
                onBackupNow={onBackupNow}
                onListSnapshots={onListSnapshots}
                onRestoreSnapshot={onRestoreSnapshot}
                onBeforeDelete={onBeforeDelete}
                onSignOut={onSignOut}
                onExportExcel={onExportExcel}
              />} />
              <Route path="*" element={<DashboardPage />} />
            </Routes>
          </Suspense>
        </main>
        <nav className="bottom-tabs" aria-label="Mobile navigation">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} aria-label={item.label} className={({ isActive }) => `bottom-tab${isActive ? ' active' : ''}`}>
              <span className="material-symbols-rounded" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
    {databaseReplacementInProgress && <div className="database-operation-overlay" role="status" aria-live="polite">Restoring the database…</div>}
    </>
  );
}

function ConflictDialog({ onReload, onOverwrite }: { onReload: () => void; onOverwrite: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <span className="dialog-icon"><span className="material-symbols-rounded">sync_problem</span></span>
        <p className="eyebrow">DRIVE CONFLICT</p>
        <h2 id="conflict-title">This file changed on another device</h2>
        <p className="muted">Choose which version to keep. Overwriting first saves a snapshot of the current Drive file.</p>
        <div className="dialog-actions">
          <button className="button button-quiet" onClick={() => { navigate('/transactions'); onReload(); }}>Reload Drive version</button>
          <button className="button button-danger" onClick={onOverwrite}>Overwrite with mine</button>
        </div>
      </section>
    </div>
  );
}

function SignInRoot() {
  return <App />;
}

export default SignInRoot;
