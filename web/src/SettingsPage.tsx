import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
import { categories, loans, paymentModes, people, subcategories, transactions } from '@finance-tracker/core/db/schema';
import { getDb } from '@finance-tracker/core/db/runtime';
import { CURRENT_SCHEMA_VERSION } from '@finance-tracker/core/db/migrations';
import { getImportLog, subscribeImportLog } from '@finance-tracker/core/import/import-log';
import type { SnapshotFile } from '@finance-tracker/core/sync/engine';
import type { SaveStatus } from './App';
import { moveItem, useDatabaseRevision } from './feature-utils';
import { useReadOnly, VIEW_ONLY_HINT } from './edit-session';
import { exportDatabase } from './database';
import { friendlyDateTime, Icon, initials, longDate } from './shell';
import { applyTheme, getStoredTheme, type ThemePreference } from './theme';
import './SettingsPage.css';

type SettingsSection = 'categories' | 'modes' | 'people' | 'appearance' | 'drive' | 'account' | 'danger';

interface SettingsPageProps {
  email: string;
  name: string;
  status: SaveStatus;
  savedAt: Date | null;
  onBackupNow: () => Promise<boolean>;
  onSaveNow: () => Promise<boolean>;
  onListSnapshots: () => Promise<SnapshotFile[]>;
  onRestoreSnapshot: (id: string) => Promise<void>;
  onBeforeDelete: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onExportExcel: (toDrive: boolean) => Promise<void>;
}

const NAV: ({ group: string } | { id: SettingsSection; label: string; icon: string })[] = [
  { group: 'ORGANIZE' },
  { id: 'categories', label: 'Categories', icon: 'category' },
  { id: 'modes', label: 'Payment modes', icon: 'credit_card' },
  { id: 'people', label: 'People & groups', icon: 'group' },
  { group: 'PREFERENCES' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { group: 'DATA' },
  { id: 'drive', label: 'Drive & backups', icon: 'cloud' },
  { id: 'account', label: 'Google account', icon: 'account_circle' },
  { id: 'danger', label: 'Delete all data', icon: 'delete_forever' },
];
const SECTION_IDS = NAV.flatMap((item) => ('id' in item ? [item.id] : []));

function resolveSection(requested: string | null): SettingsSection {
  // The old standalone "Debug logs" section now lives in Drive & backups.
  if (requested === 'debug') return 'drive';
  return SECTION_IDS.find((id) => id === requested) ?? 'categories';
}

export function SettingsPage(props: SettingsPageProps) {
  const [params] = useSearchParams();
  const section = resolveSection(params.get('section'));

  return (
    <div className="w-body">
      <main className="w-main">
        <div className="subnav-layout">
          <nav className="subnav" aria-label="Settings">
            {NAV.map((item) => 'group' in item
              ? <span key={item.group} className="subnav__group t-overline muted">{item.group}</span>
              : (
                <Link
                  key={item.id}
                  to={`/settings?section=${item.id}`}
                  className={`subnav__item${item.id === 'danger' ? ' subnav__item--danger' : ''}${section === item.id ? ' is-selected' : ''}`}
                  aria-current={section === item.id ? 'page' : undefined}
                >
                  <Icon name={item.icon} />{item.label}
                </Link>
              ))}
          </nav>

          <div>
            {section === 'categories' && <CategoriesSection />}
            {section === 'modes' && <ModesSection />}
            {section === 'people' && <PeopleSection name={props.name} />}
            {section === 'appearance' && <AppearanceSection />}
            {section === 'drive' && <DriveSection {...props} />}
            {section === 'account' && <AccountSection {...props} />}
            {section === 'danger' && <DangerSection onBeforeDelete={props.onBeforeDelete} />}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ shared pieces */

type Notice = { kind: 'success' | 'error'; text: string } | null;

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Runs an action, tracking busy state and surfacing its success message or error as a banner. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const run = useCallback(async (action: () => Promise<string | void> | string | void): Promise<boolean> => {
    setNotice(null);
    setBusy(true);
    try {
      const text = await action();
      if (text) setNotice({ kind: 'success', text });
      return true;
    } catch (reason) {
      setNotice({ kind: 'error', text: errorText(reason) });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, notice, setNotice, run };
}

function NoticeBanner({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const error = notice.kind === 'error';
  return (
    <div className={`banner banner--wrap ${error ? 'banner--danger' : 'banner--success'}`} role={error ? 'alert' : 'status'}>
      <Icon name={error ? 'error' : 'check_circle'} />
      <div className="banner__copy t-small">{notice.text}</div>
    </div>
  );
}

function SectionHead({ title, copy, children }: { title: string; copy: string; children?: ReactNode }) {
  return (
    <div className="sec__head">
      <div className="col gap-1"><h2 className="t-title" style={{ margin: 0 }}>{title}</h2><span className="t-small muted">{copy}</span></div>
      {children}
    </div>
  );
}

/** The view-only line shown at the top of a section whose editing controls are disabled. */
function ViewOnlyNote({ readOnly }: { readOnly: boolean }) {
  if (!readOnly) return null;
  return <div className="banner banner--wrap" role="note"><Icon name="visibility" /><div className="banner__copy t-small">{VIEW_ONLY_HINT}</div></div>;
}

function InfoRow({ children }: { children: ReactNode }) {
  return <div className="lrow"><span className="ms muted" style={{ fontSize: 18 }} aria-hidden="true">info</span><span className="t-caption muted">{children}</span></div>;
}

function Modal({ labelledBy, onClose, children, role = 'dialog' }: { labelledBy: string; onClose: () => void; children: ReactNode; role?: 'dialog' | 'alertdialog' }) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="w-modal" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="w-dialog" role={role} aria-modal="true" aria-labelledby={labelledBy}>{children}</div>
    </div>
  );
}

interface ConfirmRequest {
  icon: string;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

function ConfirmDialog({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  return (
    <Modal labelledBy="settings-confirm-title" onClose={onClose} role="alertdialog">
      <div className="w-dialog__head">
        <span className={`w-dialog__icon${request.danger ? ' w-dialog__icon--danger' : ''}`}><Icon name={request.icon} /></span>
        <div className="col gap-1"><span id="settings-confirm-title" className="t-heading">{request.title}</span><span className="t-small muted">{request.body}</span></div>
      </div>
      <div className="w-dialog__actions">
        <button type="button" className="btn" autoFocus onClick={onClose}>Cancel</button>
        <button type="button" className={`btn ${request.danger ? 'btn--danger' : 'btn--primary'}`} onClick={() => { onClose(); request.onConfirm(); }}>{request.confirmLabel}</button>
      </div>
    </Modal>
  );
}

/**
 * Native HTML5 drag-and-drop reordering for `.lrow`s, plus Alt+↑ / Alt+↓ on a focused row.
 * `persist` receives the full id sequence in the new order (same contract as the repository reorder helpers).
 */
function useReorder<T extends { id: number }>(items: T[], persist: (ids: number[]) => void) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const readOnly = useReadOnly();
  const reset = () => { setDragId(null); setOverId(null); };
  return (item: T, enabled = true) => {
    // Reordering writes, so view only turns off dragging and Alt+arrow moves.
    if (!enabled || readOnly) return { className: '' };
    return {
      className: `${dragId === item.id ? ' is-dragging' : ''}${overId === item.id && dragId !== item.id ? ' is-drop-target' : ''}`,
      draggable: true,
      tabIndex: 0,
      title: 'Drag, or press Alt+↑ / Alt+↓, to reorder',
      'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown',
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(item.id));
        setDragId(item.id);
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (dragId == null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (overId !== item.id) setOverId(item.id);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        const fromId = dragId;
        reset();
        if (fromId == null || fromId === item.id) return;
        const ordered = [...items];
        const from = ordered.findIndex((row) => row.id === fromId);
        const to = ordered.findIndex((row) => row.id === item.id);
        if (from < 0 || to < 0) return;
        const [moved] = ordered.splice(from, 1);
        ordered.splice(to, 0, moved);
        persist(ordered.map((row) => row.id));
      },
      onDragEnd: reset,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.target !== event.currentTarget || !event.altKey) return;
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const next = moveItem(items, item.id, event.key === 'ArrowUp' ? -1 : 1);
        if (next !== items) persist(next.map((row) => row.id));
      },
    };
  };
}

/** Inline edit row (`.lrow.is-editing`) with a borderless input inside `.field__box`. */
function EditRow({
  label,
  initial,
  leading,
  emoji,
  drag = true,
  onSave,
  onCancel,
  onDelete,
}: {
  label: string;
  initial: string;
  leading?: ReactNode;
  emoji?: string;
  drag?: boolean;
  onSave: (name: string, emoji: string) => boolean;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [emojiValue, setEmojiValue] = useState(emoji ?? '');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (onSave(value, emojiValue)) onCancel();
  };
  return (
    <form className="lrow is-editing" onSubmit={submit} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onCancel(); } }}>
      {drag && <Icon name="drag_indicator" className="drag" />}
      {emoji !== undefined && <span className="em-box"><input value={emojiValue} onChange={(event) => setEmojiValue(event.target.value)} aria-label="Emoji" placeholder="🙂" maxLength={8} /></span>}
      {leading}
      <div className="field__box field__box--sm is-focused">
        <input value={value} onChange={(event) => setValue(event.target.value)} aria-label={label} placeholder={label} autoFocus />
      </div>
      {onDelete && <button type="button" className="icon-btn icon-btn--sm icon-btn--plain" aria-label={`Delete ${initial}`} onClick={onDelete}><Icon name="delete" /></button>}
      <button type="submit" className="btn btn--sm btn--primary">Save</button>
    </form>
  );
}

/** Makes a whole `.lrow` open its inline editor on click / Enter (rows the mock draws without row actions). */
function clickToEdit(drag: { className: string; onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void }, onEdit: () => void, readOnly = false) {
  if (readOnly) return { className: `lrow${drag.className}` };
  return {
    role: 'button',
    tabIndex: 0,
    className: `lrow lrow--click${drag.className}`,
    title: 'Click to edit. Drag, or press Alt+↑ / Alt+↓, to reorder',
    onClick: onEdit,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onEdit();
        return;
      }
      drag.onKeyDown?.(event);
    },
  };
}

function RowActions({ name, disabled = false, onEdit, onDelete }: { name: string; disabled?: boolean; onEdit: () => void; onDelete?: () => void }) {
  return (
    <span className="row-actions">
      <button type="button" className="icon-btn icon-btn--sm icon-btn--plain" aria-label={`Edit ${name}`} disabled={disabled} aria-disabled={disabled || undefined} onClick={(event) => { event.stopPropagation(); onEdit(); }}><Icon name="edit" /></button>
      {onDelete && <button type="button" className="icon-btn icon-btn--sm icon-btn--plain" aria-label={`Delete ${name}`} disabled={disabled} aria-disabled={disabled || undefined} onClick={(event) => { event.stopPropagation(); onDelete(); }}><Icon name="delete" /></button>}
    </span>
  );
}

function useCounts(column: typeof transactions.categoryId | typeof transactions.subcategoryId | typeof transactions.paymentModeId, revision: number): Map<number, number> {
  const db = getDb();
  return useMemo(() => {
    const rows = db.select({ id: column, n: sql<number>`count(*)` }).from(transactions).groupBy(column).all();
    return new Map(rows.filter((row) => row.id != null).map((row) => [row.id as number, Number(row.n)]));
  }, [db, column, revision]);
}

const count = (value: number | undefined) => (value ?? 0).toLocaleString('en-IN');

type Editing = { id: number | 'new' } | null;

/* ------------------------------------------------------------------ Categories */

function CategoriesSection() {
  const revision = useDatabaseRevision();
  const db = getDb();
  const { notice, run } = useAction();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingCat, setEditingCat] = useState<Editing>(null);
  const [editingSub, setEditingSub] = useState<Editing>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const readOnly = useReadOnly();
  useEffect(() => { if (readOnly) { setEditingCat(null); setEditingSub(null); setConfirm(null); } }, [readOnly]);
  const categoryRows = useMemo(() => db.select().from(categories).where(eq(categories.isArchived, false)).orderBy(asc(categories.sortOrder), asc(categories.id)).all(), [db, revision]);
  const subcategoryRows = useMemo(() => db.select().from(subcategories).where(eq(subcategories.isArchived, false)).orderBy(asc(subcategories.sortOrder), asc(subcategories.id)).all(), [db, revision]);
  const categoryCounts = useCounts(transactions.categoryId, revision);
  const subCounts = useCounts(transactions.subcategoryId, revision);
  const selected = categoryRows.find((item) => item.id === selectedId) ?? categoryRows[0] ?? null;
  const subs = selected ? subcategoryRows.filter((item) => item.categoryId === selected.id) : [];
  const catDrag = useReorder(categoryRows, reorderCategories);
  const subDrag = useReorder(subs, reorderSubcategories);

  const attempt = (action: () => void): boolean => {
    let ok = true;
    void run(() => {
      try { action(); } catch (reason) { ok = false; throw reason; }
    });
    return ok;
  };

  useEffect(() => setEditingSub(null), [selected?.id]);

  return (
    <section className="sec" aria-label="Categories">
      <SectionHead title="Categories" copy="Drag to reorder. Order is used in pickers on the web and the phone.">
        <button type="button" className="btn btn--sm btn--primary" disabled={readOnly} aria-disabled={readOnly || undefined} onClick={() => setEditingCat({ id: 'new' })}><Icon name="add" />New category</button>
      </SectionHead>
      <ViewOnlyNote readOnly={readOnly} />
      <NoticeBanner notice={notice} />
      <div className="two-pane">
        <div className="card pane">
          <div className="pane__head"><span className="t-heading">Categories</span><span className="t-caption muted">{categoryRows.length}</span></div>
          <div>
            {categoryRows.map((item) => {
              if (editingCat?.id === item.id) {
                return <EditRow key={item.id} label="Category name" initial={item.name} emoji={item.emoji ?? ''} onCancel={() => setEditingCat(null)} onSave={(name, emoji) => attempt(() => { renameCategory(item.id, name); setCategoryEmoji(item.id, emoji); })} onDelete={() => setConfirm({
                  icon: 'delete',
                  danger: true,
                  title: `Delete “${item.name}”?`,
                  body: 'A category that’s still used by transactions is hidden instead, so your history keeps it.',
                  confirmLabel: 'Delete category',
                  onConfirm: () => { if (attempt(() => deleteCategory(item.id))) setEditingCat(null); },
                })} />;
              }
              const isSelected = item.id === selected?.id;
              const drag = catDrag(item, editingCat == null);
              return (
                <div
                  key={item.id}
                  {...drag}
                  className={`lrow lrow--click${isSelected ? ' is-selected' : ''}${drag.className}`}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => setSelectedId(item.id)}
                  onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setSelectedId(item.id); return; }
                    if ('onKeyDown' in drag) drag.onKeyDown?.(event);
                  }}
                >
                  <Icon name="drag_indicator" className="drag" />
                  <span className="em-box">{item.emoji || <Icon name="label" className="muted ms-16" />}</span>
                  <span className="grow t-label truncate">{item.name}</span>
                  <span className="t-caption muted">{count(categoryCounts.get(item.id))}</span>
                  <RowActions name={item.name} disabled={readOnly} onEdit={() => setEditingCat({ id: item.id })} />
                  <span className="ms muted" style={{ fontSize: 18 }} aria-hidden="true">chevron_right</span>
                </div>
              );
            })}
            {editingCat?.id === 'new' && <EditRow label="New category name" initial="" emoji="" onCancel={() => setEditingCat(null)} onSave={(name, emoji) => attempt(() => { setSelectedId(addCategory(name, emoji)); })} />}
          </div>
        </div>

        <div className="card pane">
          <div className="pane__head">
            <div className="row gap-2">{selected?.emoji && <span>{selected.emoji}</span>}<span className="t-heading">{selected ? `${selected.name} · sub-categories` : 'Sub-categories'}</span></div>
            <button type="button" className="btn btn--sm btn--ghost" disabled={!selected || readOnly} aria-disabled={readOnly || undefined} onClick={() => setEditingSub({ id: 'new' })}><Icon name="add" />Add</button>
          </div>
          {subs.map((item) => {
            if (editingSub?.id === item.id) {
              return <EditRow key={item.id} label="Sub-category name" initial={item.name} onCancel={() => setEditingSub(null)} onSave={(name) => attempt(() => renameSubcategory(item.id, name))} />;
            }
            const drag = subDrag(item, editingSub == null);
            return (
              <div key={item.id} {...drag} className={`lrow${drag.className}`}>
                <Icon name="drag_indicator" className="drag" />
                <span className="grow t-label">{item.name}</span>
                <span className="t-caption muted">{count(subCounts.get(item.id))}</span>
                <RowActions
                  name={item.name}
                  disabled={readOnly}
                  onEdit={() => setEditingSub({ id: item.id })}
                  onDelete={() => setConfirm({
                    icon: 'delete',
                    danger: true,
                    title: `Delete “${item.name}”?`,
                    body: 'A sub-category that’s still used by transactions is hidden instead, so your history keeps it.',
                    confirmLabel: 'Delete sub-category',
                    onConfirm: () => attempt(() => deleteSubcategory(item.id)),
                  })}
                />
              </div>
            );
          })}
          {selected && editingSub?.id === 'new' && <EditRow label="New sub-category name" initial="" onCancel={() => setEditingSub(null)} onSave={(name) => attempt(() => { addSubcategory(selected.id, name); })} />}
          {!subs.length && editingSub?.id !== 'new' && <div className="lrow"><span className="t-small muted">{selected ? 'No sub-categories yet.' : 'Add a category first.'}</span></div>}
          <InfoRow>Deleting a sub-category that’s in use hides it from pickers; its transactions keep it.</InfoRow>
        </div>
      </div>
      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}

/* ------------------------------------------------------------------ Payment modes */

function modeIcon(name: string): string {
  const value = name.toLowerCase();
  if (/\bupi\b/.test(value)) return 'qr_code_2';
  if (/\bcc\b|credit|debit|card/.test(value)) return 'credit_card';
  if (/cash/.test(value)) return 'payments';
  if (/pay|wallet|sodexo|voucher/.test(value)) return 'account_balance_wallet';
  return 'account_balance';
}

function ModesSection() {
  const revision = useDatabaseRevision();
  const db = getDb();
  const { notice, run } = useAction();
  const [editing, setEditing] = useState<Editing>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const readOnly = useReadOnly();
  useEffect(() => { if (readOnly) { setEditing(null); setConfirm(null); } }, [readOnly]);
  const rows = useMemo(() => db.select().from(paymentModes).where(eq(paymentModes.isArchived, false)).orderBy(asc(paymentModes.sortOrder), asc(paymentModes.id)).all(), [db, revision]);
  const counts = useCounts(transactions.paymentModeId, revision);
  const drag = useReorder(rows, reorderPaymentModes);
  const attempt = (action: () => void): boolean => {
    let ok = true;
    void run(() => { try { action(); } catch (reason) { ok = false; throw reason; } });
    return ok;
  };

  return (
    <section className="sec" aria-label="Payment modes">
      <SectionHead title="Payment modes" copy="How you paid. Shown in the transaction detail.">
        <button type="button" className="btn btn--sm btn--primary" disabled={readOnly} aria-disabled={readOnly || undefined} onClick={() => setEditing({ id: 'new' })}><Icon name="add" />Add mode</button>
      </SectionHead>
      <ViewOnlyNote readOnly={readOnly} />
      <NoticeBanner notice={notice} />
      <div className="card pane" style={{ maxWidth: 640 }}>
        {rows.map((item) => {
          const icon = <span className="em-box"><Icon name={modeIcon(item.name)} /></span>;
          if (editing?.id === item.id) {
            return <EditRow key={item.id} label="Payment mode name" initial={item.name} leading={icon} onCancel={() => setEditing(null)} onSave={(name) => attempt(() => renamePaymentMode(item.id, name))} onDelete={() => setConfirm({
              icon: 'delete',
              danger: true,
              title: `Delete “${item.name}”?`,
              body: 'A payment mode that’s still used by transactions is hidden instead, so your history keeps it.',
              confirmLabel: 'Delete mode',
              onConfirm: () => { if (attempt(() => deletePaymentMode(item.id))) setEditing(null); },
            })} />;
          }
          const props = drag(item, editing == null);
          return (
            <div key={item.id} {...props} {...clickToEdit(props, () => setEditing({ id: item.id }), readOnly)}>
              <Icon name="drag_indicator" className="drag" />
              {icon}
              <span className="grow t-label">{item.name}</span>
              <span className="t-caption muted">{count(counts.get(item.id))}</span>
            </div>
          );
        })}
        {editing?.id === 'new' && <EditRow label="New payment mode name" initial="" leading={<span className="em-box"><Icon name="payments" /></span>} onCancel={() => setEditing(null)} onSave={(name) => attempt(() => { addPaymentMode(name); })} />}
        {!rows.length && editing?.id !== 'new' && <div className="lrow"><span className="t-small muted">No payment modes yet.</span></div>}
      </div>
      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}

/* ------------------------------------------------------------------ People & groups */

function PeopleSection({ name }: { name: string }) {
  const revision = useDatabaseRevision();
  const db = getDb();
  const { notice, run } = useAction();
  const [editing, setEditing] = useState<Editing>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const readOnly = useReadOnly();
  useEffect(() => { if (readOnly) { setEditing(null); setConfirm(null); } }, [readOnly]);
  const rows = useMemo(() => db.select().from(people).where(eq(people.isArchived, false)).orderBy(asc(people.sortOrder), asc(people.id)).all(), [db, revision]);
  const loanCounts = useMemo(() => {
    const result = db.select({ id: loans.personId, n: sql<number>`count(*)` }).from(loans).groupBy(loans.personId).all();
    return new Map(result.map((row) => [row.id, Number(row.n)]));
  }, [db, revision]);
  const drag = useReorder(rows, reorderPeople);
  const firstName = name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const isYou = (person: string) => {
    const value = person.trim().toLowerCase();
    return value === 'self' || (firstName !== '' && (value === firstName || value === name.trim().toLowerCase()));
  };
  const attempt = (action: () => void): boolean => {
    let ok = true;
    void run(() => { try { action(); } catch (reason) { ok = false; throw reason; } });
    return ok;
  };

  return (
    <section className="sec" aria-label="People & groups">
      <SectionHead title="People & groups" copy="Used for “For” on transactions and for Lending.">
        <button type="button" className="btn btn--sm btn--primary" disabled={readOnly} aria-disabled={readOnly || undefined} onClick={() => setEditing({ id: 'new' })}><Icon name="add" />Add person</button>
      </SectionHead>
      <ViewOnlyNote readOnly={readOnly} />
      <NoticeBanner notice={notice} />
      <div className="two-pane">
        <div className="card pane">
          <div className="pane__head"><span className="t-heading">People</span><span className="t-caption muted">{rows.length}</span></div>
          {rows.map((item) => {
            if (editing?.id === item.id) {
              return <EditRow key={item.id} drag={false} label="Name" initial={item.name} leading={<span className="avatar">{initials(item.name)}</span>} onCancel={() => setEditing(null)} onSave={(value) => attempt(() => renamePerson(item.id, value))} onDelete={() => setConfirm({
                icon: 'delete',
                danger: true,
                title: `Delete “${item.name}”?`,
                body: 'Someone who’s still on a transaction or a loan is hidden instead, so your history keeps them.',
                confirmLabel: 'Delete person',
                onConfirm: () => { if (attempt(() => deletePerson(item.id))) setEditing(null); },
              })} />;
            }
            const props = drag(item, editing == null);
            const loanCount = loanCounts.get(item.id) ?? 0;
            return (
              <div key={item.id} {...props} {...clickToEdit(props, () => setEditing({ id: item.id }), readOnly)}>
                <span className="avatar">{initials(item.name)}</span>
                <span className="grow t-label">{item.name}</span>
                {isYou(item.name) && <span className="badge">You</span>}
                {loanCount > 0 && <span className="t-caption muted">{loanCount} {loanCount === 1 ? 'loan' : 'loans'}</span>}
              </div>
            );
          })}
          {editing?.id === 'new' && <EditRow drag={false} label="New person’s name" initial="" leading={<span className="avatar"><Icon name="person" className="ms-16" /></span>} onCancel={() => setEditing(null)} onSave={(value) => attempt(() => { addPerson(value); })} />}
          {!rows.length && editing?.id !== 'new' && <div className="lrow"><span className="t-small muted">No people yet.</span></div>}
        </div>
        <div className="card pane">
          <div className="pane__head"><span className="t-heading">Groups</span></div>
          <InfoRow>Groups aren’t stored in your Drive file yet. To tag shared spending, add a person such as “Family” or “Flatmates”.</InfoRow>
        </div>
      </div>
      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}

/* ------------------------------------------------------------------ Appearance */

const THEMES: { id: ThemePreference; label: string; preview: string }[] = [
  { id: 'system', label: 'System', preview: 'theme-prev--sys' },
  { id: 'light', label: 'Light', preview: 'theme-prev--light' },
  { id: 'dark', label: 'Dark', preview: 'theme-prev--dark' },
];

function AppearanceSection() {
  const [theme, setTheme] = useState<ThemePreference>(getStoredTheme);
  const choose = (next: ThemePreference) => {
    applyTheme(next);
    setTheme(next);
  };
  return (
    <section className="sec" aria-label="Appearance">
      <SectionHead title="Appearance" copy="Saved on this browser only. The phone has its own setting." />
      <div className="card card--lg" style={{ maxWidth: 720 }}>
        <div className="theme-opts" role="radiogroup" aria-label="Theme">
          {THEMES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={theme === item.id}
              className={`theme-opt${theme === item.id ? ' is-selected' : ''}`}
              onClick={() => choose(item.id)}
            >
              <div className={`theme-prev ${item.preview}`} aria-hidden="true"><span style={item.id === 'system' ? { background: 'transparent' } : undefined} /><span /></div>
              <span className="t-label">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Drive & backups */

const STATUS_BADGE: Record<SaveStatus, { className: string; icon: string; label: string }> = {
  saved: { className: 'badge--income', icon: 'cloud_done', label: 'Saved' },
  saving: { className: 'badge--accent', icon: 'sync', label: 'Saving…' },
  unsaved: { className: 'badge--review', icon: 'edit', label: 'Unsaved changes' },
  offline: { className: '', icon: 'cloud_off', label: 'Offline' },
  reconnect: { className: 'badge--review', icon: 'link_off', label: 'Reconnect needed' },
  conflict: { className: 'badge--spend', icon: 'sync_problem', label: 'Conflict' },
  error: { className: 'badge--spend', icon: 'error', label: 'Not saved' },
};

function fileSize(bytes: number): string {
  if (bytes < 100 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeSnapshot(file: SnapshotFile): { icon: string; label: string; when: string } {
  const date = new Date(file.modifiedTime);
  const when = Number.isNaN(date.getTime()) ? '' : friendlyDateTime(date);
  const name = file.name;
  const daily = /backup-(\d{4})(\d{2})(\d{2})\.db$/.exec(name);
  if (daily) return { icon: 'today', label: 'Daily', when: longDate(`${daily[1]}-${daily[2]}-${daily[3]}`) };
  if (/duplicate|this-tab/.test(name)) return { icon: 'sync_problem', label: 'Kept from a conflict', when };
  if (/before-delete-all-data/.test(name)) return { icon: 'delete_forever', label: 'Before deleting all data', when };
  if (/before-restore/.test(name)) return { icon: 'restore', label: 'Before a restore', when };
  if (/before-import/.test(name)) return { icon: 'history', label: 'Before an import', when };
  return { icon: 'history', label: /backup-\d{8}-\d{6}\.db$/.test(name) ? 'Snapshot' : name, when };
}

function DriveSection(props: SettingsPageProps) {
  const revision = useDatabaseRevision();
  const db = getDb();
  const { busy, notice, run } = useAction();
  const { onListSnapshots } = props;
  const [snapshots, setSnapshots] = useState<SnapshotFile[] | null>(null);
  const [snapshotsError, setSnapshotsError] = useState('');
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>(getImportLog);
  // View only: saving, snapshots and restores would write the shared Drive file; download/export only read it.
  const readOnly = useReadOnly();
  useEffect(() => { if (readOnly) setConfirm(null); }, [readOnly]);
  const databaseSize = useMemo(() => exportDatabase().byteLength, [revision]);
  const transactionCount = useMemo(() => db.select({ count: sql<number>`count(*)` }).from(transactions).get()?.count ?? 0, [db, revision]);
  const badge = STATUS_BADGE[props.status];

  const loadSnapshots = useCallback(async () => {
    setSnapshotsError('');
    try {
      const items = await onListSnapshots();
      setSnapshots([...items].sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime)));
    } catch (reason) {
      setSnapshots([]);
      setSnapshotsError(errorText(reason));
    }
  }, [onListSnapshots]);

  useEffect(() => { void loadSnapshots(); }, [loadSnapshots]);
  useEffect(() => subscribeImportLog(setLogs), []);

  const downloadDatabase = () => {
    const bytes = exportDatabase();
    const buffer = new Uint8Array(bytes.byteLength);
    buffer.set(bytes);
    const url = URL.createObjectURL(new Blob([buffer.buffer], { type: 'application/x-sqlite3' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'finance-live.db';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportExcel = (toDrive: boolean) => {
    setExportOpen(false);
    void run(async () => {
      await props.onExportExcel(toDrive);
      return toDrive ? 'Excel workbook saved to the Finance Tracker folder on Drive.' : 'Excel workbook downloaded.';
    });
  };

  return (
    <section className="sec" aria-label="Drive & backups">
      <SectionHead title="Drive & backups" copy="Your data lives in one file on your Google Drive. The website keeps nothing in this browser." />
      <ViewOnlyNote readOnly={readOnly} />
      <NoticeBanner notice={notice} />
      <div className="card card--lg col gap-3">
        <div className="file-card"><span className="em-box"><Icon name="database" /></span>
          <div className="grow col gap-0" style={{ minWidth: 0 }}>
            <span className="t-heading truncate">Finance Tracker / finance-live.db</span>
            <span className="t-small muted">{fileSize(databaseSize)} · {transactionCount.toLocaleString('en-IN')} {transactionCount === 1 ? 'transaction' : 'transactions'} · schema v{CURRENT_SCHEMA_VERSION}</span>
          </div>
          <span className={`badge${badge.className ? ` ${badge.className}` : ''}`}><Icon name={badge.icon} />{badge.label}</span>
        </div>
        <div className="dl">
          <div className="dl__row"><span className="dl__k t-small">Last saved</span><span className="dl__v t-small">{props.savedAt ? `${friendlyDateTime(props.savedAt)} · this browser` : 'Not saved from this browser yet'}</span></div>
          <div className="dl__row"><span className="dl__k t-small">Phone</span><span className="dl__v t-small">Opens the same file from your Drive</span></div>
          <div className="dl__row"><span className="dl__k t-small">Autosave</span><span className="dl__v t-small">A few seconds after each change</span></div>
        </div>
        <div className="row gap-2 wrap">
          <button type="button" className="btn btn--sm btn--primary" disabled={busy || readOnly} aria-disabled={readOnly || undefined} onClick={() => void run(async () => {
            if (!await props.onSaveNow()) throw new Error('Could not save to Drive. Check the sync status and try again.');
            return 'Saved to Drive.';
          })}><Icon name="cloud_upload" />Save now</button>
          <button type="button" className="btn btn--sm" disabled={busy || readOnly} aria-disabled={readOnly || undefined} onClick={() => void run(async () => {
            if (!await props.onBackupNow()) throw new Error('Could not take a snapshot. Check the sync status and try again.');
            await loadSnapshots();
            return 'Snapshot taken.';
          })}><Icon name="history" />Take a snapshot</button>
          <button type="button" className="btn btn--sm" onClick={downloadDatabase}><Icon name="download" />Download a copy</button>
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => setExportOpen(true)}><Icon name="table_view" />Export to Excel</button>
        </div>
      </div>

      <div className="card pane">
        <div className="pane__head">
          <div className="col gap-0"><span className="t-heading">Snapshots</span><span className="t-caption muted">Taken daily, before every import and before a conflict is resolved. The last 30 are kept.</span></div>
          <button type="button" className="icon-btn icon-btn--sm icon-btn--plain" aria-label="Refresh snapshots" disabled={busy} onClick={() => void loadSnapshots()}><Icon name="refresh" /></button>
        </div>
        {snapshotsError && <div className="lrow"><span className="ms" style={{ fontSize: 18, color: 'var(--spend)' }} aria-hidden="true">error</span><span className="t-caption" role="alert">{snapshotsError}</span></div>}
        {snapshots === null && <div className="lrow"><span className="t-small muted">Loading snapshots…</span></div>}
        {snapshots?.length === 0 && !snapshotsError && <div className="lrow"><span className="t-small muted">No snapshots yet.</span></div>}
        {snapshots?.map((file) => {
          const info = describeSnapshot(file);
          return (
            <div className="lrow" key={file.id}>
              <span className="em-box"><Icon name={info.icon} /></span>
              <div className="grow col gap-0" style={{ minWidth: 0 }}><span className="t-label truncate" title={file.name}>{info.label}</span><span className="t-caption muted">{info.when}</span></div>
              <button type="button" className="btn btn--sm" disabled={busy || readOnly} aria-disabled={readOnly || undefined} onClick={() => setConfirm({
                icon: 'history',
                title: 'Restore this snapshot?',
                body: `${info.label}${info.when ? ` · ${info.when}` : ''}. Restoring replaces finance-live.db for the phone and the website. A snapshot of the current file is taken first.`,
                confirmLabel: 'Restore',
                onConfirm: () => void run(async () => {
                  await props.onRestoreSnapshot(file.id);
                  await loadSnapshots();
                  return 'Snapshot restored. The restored file is syncing to Drive.';
                }),
              })}>Restore</button>
            </div>
          );
        })}
        <InfoRow>Restoring replaces finance-live.db for the phone and the website. A snapshot of the current file is taken first.</InfoRow>
      </div>

      {logs.length > 0 && (
        <div className="card pane">
          <div className="pane__head">
            <div className="col gap-0"><span className="t-heading">Import log</span><span className="t-caption muted">Recent statement-import diagnostics. Passwords and file contents are not logged.</span></div>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setLogs([])}>Clear view</button>
          </div>
          <pre className="import-log" aria-live="polite">{logs.join('\n')}</pre>
        </div>
      )}

      {exportOpen && (
        <Modal labelledBy="settings-export-title" onClose={() => setExportOpen(false)}>
          <div className="w-dialog__head">
            <span className="w-dialog__icon"><Icon name="table_view" /></span>
            <div className="col gap-1"><span id="settings-export-title" className="t-heading">Export to Excel</span><span className="t-small muted">Every transaction, loan and list in one workbook. Download it, or save it to the Finance Tracker folder on your Drive.</span></div>
          </div>
          <div className="w-dialog__actions">
            <button type="button" className="btn" onClick={() => exportExcel(true)}><Icon name="add_to_drive" />Save to Drive</button>
            <button type="button" className="btn btn--primary" autoFocus onClick={() => exportExcel(false)}><Icon name="download" />Download</button>
          </div>
        </Modal>
      )}
      {confirm && <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />}
    </section>
  );
}

/* ------------------------------------------------------------------ Google account */

function AccountSection(props: SettingsPageProps) {
  const { busy, notice, run } = useAction();
  const displayName = props.name.trim() || props.email;
  return (
    <section className="sec" aria-label="Google account">
      <SectionHead title="Google account" copy="Used to sign in and to reach your Drive file." />
      <NoticeBanner notice={notice} />
      <div className="card card--lg col gap-3" style={{ maxWidth: 720 }}>
        <div className="row gap-3"><span className="avatar" style={{ width: 48, height: 48, fontSize: 16 }} aria-hidden="true">{initials(displayName)}</span>
          <div className="grow col gap-0" style={{ minWidth: 0 }}><span className="t-heading truncate">{displayName}</span><span className="t-small muted truncate">{props.email}</span></div></div>
        <div className="dl">
          <div className="dl__row"><span className="dl__k t-small">Drive access</span><span className="dl__v t-small">Only files this app created (drive.file)</span></div>
          <div className="dl__row"><span className="dl__k t-small">Session</span><span className="dl__v t-small">Renews automatically while this tab is open</span></div>
        </div>
        <div className="row gap-2 wrap">
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void run(() => props.onSignOut())}><Icon name="logout" />Sign out</button>
          <a className="btn btn--sm btn--ghost" href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Manage access in Google</a>
        </div>
        <span className="t-caption muted">Signing out closes your data in this tab. Unsaved changes are saved first.</span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Delete all data */

function DangerSection({ onBeforeDelete }: { onBeforeDelete: () => Promise<void> }) {
  const { busy, notice, run } = useAction();
  const [typed, setTyped] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const readOnly = useReadOnly();
  useEffect(() => { if (readOnly) setConfirming(false); }, [readOnly]);
  const closeConfirm = useCallback(() => setConfirming(false), []);
  const remove = () => {
    setConfirming(false);
    if (readOnly) return;
    void run(async () => {
      await onBeforeDelete();
      clearAllData();
      setTyped('');
      return 'All data was deleted. A final snapshot was kept on Drive.';
    });
  };
  return (
    <section className="sec" aria-label="Delete all data">
      <SectionHead title="Delete all data" copy="Removes every transaction, loan, category and import." />
      <ViewOnlyNote readOnly={readOnly} />
      <NoticeBanner notice={notice} />
      <div className="card card--lg danger-card col gap-3" style={{ maxWidth: 720 }}>
        <div className="banner banner--danger banner--wrap"><Icon name="warning" /><div className="banner__copy t-small">This empties finance-live.db on Drive, so it also clears the phone app. A final snapshot is kept for 30 days.</div></div>
        <div className="field">
          <label className="field__label" htmlFor="settings-delete-confirm">Type DELETE to confirm</label>
          <div className={`field__box${mismatch ? ' is-error' : ''}`}><input id="settings-delete-confirm" disabled={readOnly} value={typed} onChange={(event) => { setTyped(event.target.value); setMismatch(false); }} placeholder="DELETE" autoComplete="off" spellCheck={false} aria-invalid={mismatch} aria-describedby={mismatch ? 'settings-delete-error' : undefined} /></div>
          {mismatch && <span id="settings-delete-error" className="field__error" role="alert">Type DELETE in capitals to continue.</span>}
        </div>
        <div className="row gap-2"><button type="button" className="btn btn--danger" disabled={busy || readOnly} aria-disabled={readOnly || undefined} onClick={() => { if (typed === 'DELETE') setConfirming(true); else setMismatch(true); }}><Icon name="delete_forever" />Delete all data</button></div>
      </div>
      {confirming && (
        <ConfirmDialog
          onClose={closeConfirm}
          request={{
            icon: 'delete_forever',
            danger: true,
            title: 'Delete all data?',
            body: 'This clears finance-live.db for both the website and the phone app. A final snapshot is taken first.',
            confirmLabel: 'Delete all data',
            onConfirm: remove,
          }}
        />
      )}
    </section>
  );
}
