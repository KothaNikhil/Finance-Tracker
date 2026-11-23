import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { asc, eq, sql } from 'drizzle-orm';
import {
  addCategory,
  addPaymentMode,
  addPerson,
  addSubcategory,
  clearAllData,
  deleteCategory,
  deletePaymentMode,
  deletePerson,
  deleteSubcategory,
  renameCategory,
  renamePaymentMode,
  renamePerson,
  renameSubcategory,
  reorderCategories,
  reorderPaymentModes,
  reorderPeople,
  reorderSubcategories,
  setCategoryEmoji,
} from '@finance-tracker/core/db/repository';
import { categories, paymentModes, people, subcategories, transactions } from '@finance-tracker/core/db/schema';
import { getDb } from '@finance-tracker/core/db/runtime';
import { getImportLog, subscribeImportLog } from '@finance-tracker/core/import/import-log';
import type { SnapshotFile } from '@finance-tracker/core/sync/engine';
import { moveItem, useDatabaseRevision } from './feature-utils';
import { exportDatabase } from './database';

type SettingsSection = 'categories' | 'modes' | 'people' | 'appearance' | 'drive' | 'account' | 'danger' | 'debug';
type Theme = 'system' | 'light' | 'dark';

interface SettingsPageProps {
  email: string;
  status: string;
  savedAt: Date | null;
  onBackupNow: () => Promise<boolean>;
  onListSnapshots: () => Promise<SnapshotFile[]>;
  onRestoreSnapshot: (id: string) => Promise<void>;
  onBeforeDelete: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onExportExcel: (toDrive: boolean) => Promise<void>;
}

const SECTIONS: { id: SettingsSection; label: string; icon: string }[] = [
  { id: 'categories', label: 'Categories', icon: 'category' },
  { id: 'modes', label: 'Payment modes', icon: 'credit_card' },
  { id: 'people', label: 'People & groups', icon: 'group' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'drive', label: 'Drive & backups', icon: 'cloud' },
  { id: 'account', label: 'Google account', icon: 'account_circle' },
  { id: 'danger', label: 'Delete all data', icon: 'delete_forever' },
  { id: 'debug', label: 'Debug logs', icon: 'terminal' },
];

export function SettingsPage(props: SettingsPageProps) {
  const revision = useDatabaseRevision();
  const [params, setParams] = useSearchParams();
  const db = getDb();
  const requested = params.get('section') as SettingsSection | null;
  const section = SECTIONS.some((item) => item.id === requested) ? requested! : 'categories';
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('finance-tracker-theme') as Theme) || 'system');
  const [snapshots, setSnapshots] = useState<SnapshotFile[]>([]);
  const [snapshotsError, setSnapshotsError] = useState('');
  const [dangerConfirm, setDangerConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [logs, setLogs] = useState<string[]>(getImportLog());
  const categoryRows = useMemo(() => db.select().from(categories).where(eq(categories.isArchived, false)).orderBy(asc(categories.sortOrder), asc(categories.id)).all(), [db, revision]);
  const paymentRows = useMemo(() => db.select().from(paymentModes).where(eq(paymentModes.isArchived, false)).orderBy(asc(paymentModes.sortOrder), asc(paymentModes.id)).all(), [db, revision]);
  const peopleRows = useMemo(() => db.select().from(people).where(eq(people.isArchived, false)).orderBy(asc(people.sortOrder), asc(people.id)).all(), [db, revision]);
  const subcategoryRows = useMemo(() => db.select().from(subcategories).where(eq(subcategories.isArchived, false)).orderBy(asc(subcategories.sortOrder), asc(subcategories.id)).all(), [db, revision]);
  const selectedCategory = categoryRows.find((item) => item.id === selectedCategoryId) ?? categoryRows[0] ?? null;
  const selectedSubcategories = selectedCategory
    ? subcategoryRows.filter((item) => item.categoryId === selectedCategory.id)
    : [];
  const databaseSize = useMemo(() => exportDatabase().byteLength, [revision]);
  const transactionCount = useMemo(
    () => db.select({ count: sql<number>`count(*)` }).from(transactions).get()?.count ?? 0,
    [db, revision],
  );

  useEffect(() => {
    const root = document.documentElement;
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    root.dataset.theme = resolved;
    localStorage.setItem('finance-tracker-theme', theme);
  }, [theme]);

  useEffect(() => subscribeImportLog(setLogs), []);

  useEffect(() => {
    if (section !== 'drive') return;
    let active = true;
    setSnapshotsError('');
    void props.onListSnapshots().then((items) => {
      if (active) setSnapshots(items);
    }).catch((reason: unknown) => {
      if (active) setSnapshotsError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { active = false; };
  }, [section, props.onListSnapshots]);

  const run = async (action: () => Promise<void> | void) => {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const downloadDatabase = () => {
    const bytes = exportDatabase();
    const buffer = new Uint8Array(bytes.byteLength);
    buffer.set(bytes);
    const blob = new Blob([buffer.buffer], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'finance-live.db';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const chooseSection = (next: SettingsSection) => setParams({ section: next });

  return (
    <section className="settings-layout">
      <nav className="settings-nav" aria-label="Settings">
        <span className="eyebrow">ORGANIZE</span>
        {SECTIONS.slice(0, 3).map((item) => <SectionButton key={item.id} item={item} active={section === item.id} onClick={() => chooseSection(item.id)} />)}
        <span className="eyebrow">PREFERENCES</span>
        <SectionButton item={SECTIONS[3]} active={section === 'appearance'} onClick={() => chooseSection('appearance')} />
        <span className="eyebrow">DATA</span>
        {SECTIONS.slice(4).map((item) => <SectionButton key={item.id} item={item} active={section === item.id} onClick={() => chooseSection(item.id)} danger={item.id === 'danger'} />)}
      </nav>

      <div className="settings-content">
        {message && <p className="success-text" role="status">{message}</p>}
        {error && <p className="error-text" role="alert">{error}</p>}
        {section === 'categories' && <div className="page-stack">
          <div className="page-heading"><div><p className="eyebrow">ORGANIZE</p><h1>Categories</h1><p className="muted">Manage the categories and sub-categories used on web and phone.</p></div><button className="button button-primary" onClick={() => {
            const name = window.prompt('Category name');
            if (name == null) return;
            const emoji = window.prompt('Emoji (optional)', '') ?? '';
            try { const id = addCategory(name, emoji); setSelectedCategoryId(id); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
          }}>＋ New category</button></div>
          <div className="settings-two-pane">
            <div className="card feature-card">
              <div className="card-heading"><h2>Categories</h2><span className="muted">{categoryRows.length}</span></div>
              <div className="editable-list">{categoryRows.map((item, index) => <div className={`editable-row${item.id === selectedCategory?.id ? ' active' : ''}`} key={item.id} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(item.id))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
                const fromId = Number(event.dataTransfer.getData('text/plain'));
                const ordered = [...categoryRows];
                const from = ordered.findIndex((row) => row.id === fromId);
                if (from < 0) return;
                const [moved] = ordered.splice(from, 1);
                ordered.splice(index, 0, moved);
                reorderCategories(ordered.map((row) => row.id));
              }}>
                <span className="drag-handle" aria-hidden="true">⋮⋮</span><button className="list-item-main" onClick={() => setSelectedCategoryId(item.id)}><span>{item.emoji || '•'}</span><strong>{item.name}</strong></button>
                <button className="icon-button" aria-label={`Move ${item.name} up`} disabled={index === 0} onClick={() => reorderCategories(moveItem(categoryRows, item.id, -1).map((row) => row.id))}>↑</button>
                <button className="icon-button" aria-label={`Move ${item.name} down`} disabled={index === categoryRows.length - 1} onClick={() => reorderCategories(moveItem(categoryRows, item.id, 1).map((row) => row.id))}>↓</button>
                <button className="icon-button" aria-label={`Edit ${item.name}`} onClick={() => {
                  const name = window.prompt('Category name', item.name);
                  if (name != null) try { renameCategory(item.id, name); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
                  const emoji = window.prompt('Emoji (optional)', item.emoji ?? '');
                  if (emoji != null) setCategoryEmoji(item.id, emoji);
                }}>✎</button>
                <button className="icon-button" aria-label={`Delete ${item.name}`} onClick={() => { if (window.confirm(`Delete category “${item.name}”? Used categories are archived to preserve history.`)) deleteCategory(item.id); }}>×</button>
              </div>)}</div>
            </div>
            <div className="card feature-card">
              <div className="card-heading"><h2>{selectedCategory ? `${selectedCategory.emoji ? `${selectedCategory.emoji} ` : ''}${selectedCategory.name} · sub-categories` : 'Sub-categories'}</h2><button className="button button-quiet" disabled={!selectedCategory} onClick={() => {
                if (!selectedCategory) return;
                const name = window.prompt('Sub-category name');
                if (name != null) try { addSubcategory(selectedCategory.id, name); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
              }}>＋ Add</button></div>
              {selectedSubcategories.map((item, index) => <div className="editable-row" key={item.id} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(item.id))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
                const fromId = Number(event.dataTransfer.getData('text/plain'));
                const ordered = [...selectedSubcategories];
                const from = ordered.findIndex((row) => row.id === fromId);
                if (from < 0) return;
                const [moved] = ordered.splice(from, 1);
                ordered.splice(index, 0, moved);
                reorderSubcategories(ordered.map((row) => row.id));
              }}><span className="drag-handle" aria-hidden="true">⋮⋮</span><strong className="grow">{item.name}</strong>
                <button className="icon-button" aria-label={`Move ${item.name} up`} disabled={index === 0} onClick={() => reorderSubcategories(moveItem(selectedSubcategories, item.id, -1).map((row) => row.id))}>↑</button>
                <button className="icon-button" aria-label={`Move ${item.name} down`} disabled={index === selectedSubcategories.length - 1} onClick={() => reorderSubcategories(moveItem(selectedSubcategories, item.id, 1).map((row) => row.id))}>↓</button>
                <button className="icon-button" aria-label={`Rename ${item.name}`} onClick={() => { const name = window.prompt('Sub-category name', item.name); if (name != null) try { renameSubcategory(item.id, name); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }}>✎</button>
                <button className="icon-button" aria-label={`Delete ${item.name}`} onClick={() => { if (window.confirm(`Delete “${item.name}”?`)) deleteSubcategory(item.id); }}>×</button>
              </div>)}
              {selectedSubcategories.length === 0 && <p className="muted">No sub-categories.</p>}
            </div>
          </div>
        </div>}

        {section === 'modes' && <NameList title="Payment modes" copy="How you paid. Shown in transaction details." items={paymentRows} add={addPaymentMode} rename={renamePaymentMode} remove={deletePaymentMode} reorder={reorderPaymentModes} />}
        {section === 'people' && <NameList title="People & groups" copy="People are used for “For” on transactions and in Lending. Group lists are not stored in this database yet." items={peopleRows} add={addPerson} rename={renamePerson} remove={deletePerson} reorder={reorderPeople} />}
        {section === 'appearance' && <div className="page-stack"><div className="page-heading"><div><p className="eyebrow">PREFERENCES</p><h1>Appearance</h1><p className="muted">Saved on this browser only. The phone has its own setting.</p></div></div><div className="theme-options">{(['system', 'light', 'dark'] as const).map((item) => <button key={item} className={`theme-option${theme === item ? ' selected' : ''}`} onClick={() => setTheme(item)}><span className={`theme-preview theme-${item}`} /><strong>{item === 'system' ? 'System' : item[0].toUpperCase() + item.slice(1)}</strong><span className="muted">{theme === item ? 'Selected' : 'Choose theme'}</span></button>)}</div></div>}

        {section === 'drive' && <div className="page-stack"><div className="page-heading"><div><p className="eyebrow">DATA</p><h1>Drive & backups</h1><p className="muted">Your database is stored in Google Drive and shared with the phone app.</p></div></div>
          <div className="card feature-card">
            <div className="card-heading"><h2>finance-live.db</h2><span className={`badge save-${props.status}`}>{props.status}</span></div>
            <div className="summary-row"><span>Database size</span><strong>{(databaseSize / (1024 * 1024)).toFixed(2)} MB</strong></div>
            <div className="summary-row"><span>Transactions</span><strong>{transactionCount.toLocaleString()}</strong></div>
            <div className="summary-row"><span>Last saved</span><strong>{props.savedAt?.toLocaleString() ?? 'Not saved this session'}</strong></div>
            <p className="muted">Autosave runs a few seconds after changes. The same live file syncs to your phone.</p>
            <div className="row gap-2 wrap">
              <button className="button button-primary" disabled={busy} onClick={() => void run(async () => { if (!await props.onBackupNow()) throw new Error('Could not save a Drive snapshot. Resolve the sync status and try again.'); setMessage('Saved the live database and created a snapshot.'); })}>Save now</button>
              <button className="button button-quiet" disabled={busy} onClick={() => void run(async () => { if (!await props.onBackupNow()) throw new Error('Could not create a Drive snapshot.'); setMessage('Snapshot created.'); setSnapshots(await props.onListSnapshots()); })}>Take a snapshot</button>
              <button className="button button-quiet" onClick={downloadDatabase}>Download a copy</button>
              <button className="button button-quiet" disabled={busy} onClick={() => void run(async () => { await props.onExportExcel(false); setMessage('Excel workbook downloaded.'); })}>Export to Excel</button>
              <button className="button button-quiet" disabled={busy} onClick={() => void run(async () => { await props.onExportExcel(true); setMessage('Excel workbook saved to the Finance Tracker Drive folder.'); })}>Save Excel to Drive</button>
            </div>
          </div>
          <div className="card feature-card"><div className="card-heading"><div><h2>Snapshots</h2><p className="muted">Restore replaces the live database for the phone and website; a snapshot of the current file is taken first.</p></div><button className="button button-quiet" disabled={busy} onClick={() => void run(async () => setSnapshots(await props.onListSnapshots()))}>Refresh</button></div>
            {snapshotsError && <p className="error-text" role="alert">{snapshotsError}</p>}
            {snapshots.map((snapshot) => <div className="compact-row" key={snapshot.id}><span>◷</span><span className="history-copy"><strong>{snapshot.name}</strong><small>{new Date(snapshot.modifiedTime).toLocaleString()}</small></span><button className="button button-quiet" disabled={busy} onClick={() => {
              if (!window.confirm(`Restore ${snapshot.name}? This replaces the shared live database.`)) return;
              void run(async () => { await props.onRestoreSnapshot(snapshot.id); setMessage('Snapshot restored. The restored database is syncing to Drive.'); setSnapshots(await props.onListSnapshots()); });
            }}>Restore</button></div>)}
            {!snapshots.length && !snapshotsError && <p className="muted">No snapshots found.</p>}
          </div>
        </div>}

        {section === 'account' && <div className="page-stack"><div className="page-heading"><div><p className="eyebrow">ACCOUNT</p><h1>Google account</h1><p className="muted">Used to sign in and access your Drive database.</p></div></div><div className="card feature-card account-settings"><div className="avatar">{props.email.slice(0, 1).toUpperCase()}</div><div><h2>{props.email}</h2><p className="muted">Drive access is limited to files created by this app.</p></div><div className="row gap-2"><button className="button button-quiet" onClick={() => window.open('https://myaccount.google.com/permissions', '_blank', 'noopener,noreferrer')}>Manage Google access</button><button className="button button-danger" disabled={busy} onClick={() => void run(() => props.onSignOut())}>Sign out</button></div><p className="muted">Signing out closes this tab’s in-memory database. Unsaved changes are saved first.</p></div></div>}

        {section === 'danger' && <div className="page-stack"><div className="page-heading"><div><p className="eyebrow">DATA</p><h1>Delete all data</h1><p className="muted">Removes every transaction, loan, custom category, and import.</p></div></div><div className="card feature-card danger-card"><strong>This also clears the shared Drive database for the phone app.</strong><p className="muted">A final snapshot is created before the reset. Default reference lists are restored.</p><label className="field-label">Type DELETE to confirm<input value={dangerConfirm} onChange={(event) => setDangerConfirm(event.target.value)} placeholder="DELETE" autoComplete="off" /></label><button className="button button-danger" disabled={busy || dangerConfirm !== 'DELETE'} onClick={() => void run(async () => {
            if (!window.confirm('This reset affects both website and phone. Continue?')) return;
            await props.onBeforeDelete();
            clearAllData();
            setDangerConfirm('');
            setMessage('All data was reset. A final snapshot was kept in Drive.');
          })}>Delete all data</button></div></div>}

        {section === 'debug' && <div className="page-stack"><div className="page-heading"><div><p className="eyebrow">SUPPORT</p><h1>Debug logs</h1><p className="muted">Recent statement-import diagnostics. Passwords and file contents are not logged.</p></div><button className="button button-quiet" onClick={() => setLogs([])}>Clear view</button></div><pre className="debug-log" aria-live="polite">{logs.join('\n') || 'No import diagnostics yet.'}</pre></div>}
      </div>
    </section>
  );
}

function SectionButton({ item, active, onClick, danger = false }: { item: (typeof SECTIONS)[number]; active: boolean; onClick: () => void; danger?: boolean }) {
  return <button className={`settings-nav-item${active ? ' active' : ''}${danger ? ' danger' : ''}`} onClick={onClick}><span className="material-symbols-rounded" aria-hidden="true">{item.icon}</span>{item.label}</button>;
}

function NameList({
  title,
  copy,
  items,
  add,
  rename,
  remove,
  reorder,
}: {
  title: string;
  copy: string;
  items: { id: number; name: string }[];
  add: (name: string) => number;
  rename: (id: number, name: string) => void;
  remove: (id: number) => void;
  reorder: (ids: number[]) => void;
}) {
  const [error, setError] = useState('');
  const perform = (action: () => void) => {
    setError('');
    try { action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  return <div className="page-stack"><div className="page-heading"><div><p className="eyebrow">ORGANIZE</p><h1>{title}</h1><p className="muted">{copy}</p></div><button className="button button-primary" onClick={() => {
    const name = window.prompt(`${title.slice(0, -1)} name`);
    if (name != null) perform(() => { add(name); });
  }}>＋ Add</button></div>{error && <p className="error-text" role="alert">{error}</p>}
    <div className="card feature-card editable-list">{items.map((item, index) => <div className="editable-row" key={item.id} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(item.id))} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
      const from = items.findIndex((row) => row.id === Number(event.dataTransfer.getData('text/plain')));
      if (from < 0) return;
      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      reorder(next.map((row) => row.id));
    }}><span className="drag-handle" aria-hidden="true">⋮⋮</span><strong className="grow">{item.name}</strong>
      <button className="icon-button" aria-label={`Move ${item.name} up`} disabled={index === 0} onClick={() => reorder(moveItem(items, item.id, -1).map((row) => row.id))}>↑</button>
      <button className="icon-button" aria-label={`Move ${item.name} down`} disabled={index === items.length - 1} onClick={() => reorder(moveItem(items, item.id, 1).map((row) => row.id))}>↓</button>
      <button className="icon-button" aria-label={`Rename ${item.name}`} onClick={() => { const name = window.prompt(`Rename ${item.name}`, item.name); if (name != null) perform(() => rename(item.id, name)); }}>✎</button>
      <button className="icon-button" aria-label={`Delete ${item.name}`} onClick={() => { if (window.confirm(`Delete “${item.name}”? Referenced rows will be preserved.`)) perform(() => remove(item.id)); }}>×</button>
    </div>)}</div>
  </div>;
}
