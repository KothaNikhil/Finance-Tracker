import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { eq, inArray } from 'drizzle-orm';
import { dryRunImportPreview, runImport, type ImportPreview, type ImportPreviewRow } from '@finance-tracker/core/import/pipeline';
import { IMPORT_ADAPTERS, IMPORT_FORMATS } from '@finance-tracker/core/import/formats';
import { isEncryptedWorkbook, decryptWorkbook, WrongPasswordError } from '@finance-tracker/core/import/decrypt';
import { isEncryptedPdf, pdfFileKey } from '@finance-tracker/core/import/pdf/decrypt-pdf';
import { parsePdfToSheets } from '@finance-tracker/core/import/pdf/pdf-text';
import { readCardStatementMeta, type CardStatementMeta } from '@finance-tracker/core/import/adapters/axis-cc';
import { parseXlsxBytes } from '@finance-tracker/core/import/xlsx';
import type { NormalizedTxn, SheetLike } from '@finance-tracker/core/import/types';
import type { CategoryIndex } from '@finance-tracker/core/categorize/types';
import {
  getCategoryIndex,
  getExistingDedupeKeys,
  getLastImport,
  getLearnedRules,
  reconcileDuplicatesFromImport,
  revertImport,
  saveImportBatch,
  setTransactionCategory,
} from '@finance-tracker/core/db/repository';
import { cardStatementsQuery } from '@finance-tracker/core/db/queries/cards';
import { imports, transactions } from '@finance-tracker/core/db/schema';
import { getDb } from '@finance-tracker/core/db/runtime';
import { ilog, resetImportLog } from '@finance-tracker/core/import/import-log';
import { useDatabaseRevision } from './feature-utils';
import { useReadOnly, VIEW_ONLY_HINT } from './edit-session';
import { DetailPanel, Icon, MONTHS_SHORT, formatInr, friendlyDateTime, longDate, shortDate } from './shell';
import { TransactionDetailPanel } from './TransactionsPage';
import './ImportPage.css';

type FileStatus = 'reading' | 'locked' | 'ready' | 'error' | 'saved';
type PreviewTab = 'new' | 'review' | 'duplicates';

interface CategoryChoice {
  categoryId: number;
  subcategoryId: number | null;
}

interface ImportFile {
  id: string;
  file: File;
  status: FileStatus;
  /** Reading progress, 0–100 (only while `reading`). */
  progress: number;
  message: string;
  wrongPassword?: boolean;
  bytes?: Uint8Array;
  sheets?: SheetLike[];
  preview?: ImportPreview;
  formatName?: string;
  cardMeta?: CardStatementMeta | null;
}

interface RecentImport {
  id: number;
  batchKey: string | null;
  sourceLabel: string;
  importedAt: string;
  addedCount: number;
  statementMonth: string | null;
}

interface PreviewEntry {
  item: ImportFile;
  row: ImportPreviewRow;
}

interface SavedResult {
  importId: number | null;
  added: number;
  files: number;
  review: number;
  updated: number;
  flagged: number;
}

interface PickerState {
  key: string;
  anchor: DOMRect;
}

/** A saved transaction opens the full Activity panel; a row that isn't saved yet opens a preview. */
type DetailTarget = { kind: 'saved'; txnId: number; key: string } | { kind: 'preview'; key: string };

const PAGE_SIZE = 100;
const UNSUPPORTED_COPY = 'Not a supported statement. Export it from your bank as .xlsx and drop it again.';

function isPdf(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function readBytes(file: File, onProgress: (fraction: number) => void): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsArrayBuffer(file);
  });
}

function calculatePreviews(files: ImportFile[]): ImportFile[] {
  const keys = getExistingDedupeKeys();
  return files.map((item) => {
    if (!item.sheets || item.status === 'reading' || item.status === 'locked' || item.status === 'error' || item.status === 'saved') return item;
    try {
      const preview = runImport(item.sheets, IMPORT_ADAPTERS, keys);
      for (const txn of preview.newTxns) keys.add(txn.dedupeKey);
      const formatName = IMPORT_FORMATS.find((format) => format.adapter.detect(item.sheets!))?.name;
      return { ...item, preview, formatName, status: 'ready', message: '' };
    } catch (error) {
      return { ...item, preview: undefined, status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  });
}

function signedPaise(txn: NormalizedTxn): number {
  return txn.direction === 'out' ? -txn.paise : txn.paise;
}

function payeeOf(txn: NormalizedTxn): string {
  return txn.counterpartyName || txn.rawDetails;
}

function payeeKey(txn: NormalizedTxn): string {
  return (txn.counterpartyVpa || txn.counterpartyName || txn.rawDetails).trim().toLowerCase();
}

function dateRange(dates: string[], withYear: boolean): string {
  if (!dates.length) return '—';
  const sorted = [...dates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!withYear) return first === last ? shortDate(first) : `${shortDate(first)} – ${shortDate(last)}`;
  if (first === last) return longDate(first);
  return first.slice(0, 4) === last.slice(0, 4) ? `${shortDate(first)} – ${longDate(last)}` : `${longDate(first)} – ${longDate(last)}`;
}

function monthLabel(month: string | null | undefined): string | null {
  if (!month) return null;
  const value = Number(month.slice(5, 7));
  return MONTHS_SHORT[value - 1] ?? null;
}

function categoryDisplay(index: CategoryIndex, categoryId: number | null, subcategoryId: number | null): { emoji: string; label: string } | null {
  if (categoryId == null) return null;
  const category = index.byId.get(categoryId);
  if (!category) return null;
  const sub = subcategoryId == null ? null : category.subcategories.find((entry) => entry.id === subcategoryId);
  return { emoji: category.emoji ?? '🏷️', label: sub ? `${category.name} · ${sub.name}` : category.name };
}

function groupedImports(rows: RecentImport[]) {
  const groups = new Map<string, { key: string; latestId: number; labels: string[]; months: (string | null)[]; count: number; importedAt: string; web: boolean }>();
  for (const row of rows) {
    const key = row.batchKey ?? `single-${row.id}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, latestId: row.id, labels: [], months: [], count: 0, importedAt: row.importedAt, web: Boolean(row.batchKey?.startsWith('web-')) };
      groups.set(key, group);
    }
    group.latestId = Math.max(group.latestId, row.id);
    group.labels.push(row.sourceLabel);
    group.months.push(row.statementMonth);
    group.count += row.addedCount;
    if (row.importedAt > group.importedAt) group.importedAt = row.importedAt;
  }
  return [...groups.values()].sort((a, b) => b.latestId - a.latestId).map((group) => {
    const month = group.labels.length === 1 ? monthLabel(group.months[0]) : null;
    const title = group.labels.length > 1
      ? `${group.labels.length} files · ${group.count} transactions`
      : `${group.labels[0]}${month ? ` · ${month} statement` : ''} · ${group.count} transactions`;
    return { key: group.key, latestId: group.latestId, title, count: group.count, importedAt: group.importedAt, web: group.web };
  });
}

function importedWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  if (date >= yesterday) return friendlyDateTime(date);
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

function lookupTxnId(dedupeKey: string): number | null {
  const row = getDb().select({ id: transactions.id }).from(transactions).where(eq(transactions.dedupeKey, dedupeKey)).get();
  return row?.id ?? null;
}

export function ImportPage() {
  const revision = useDatabaseRevision();
  const db = getDb();
  // View only still reads, unlocks and previews files (all in memory); only saving to the DB is off.
  const readOnly = useReadOnly();
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [dragCount, setDragCount] = useState<number | null>(null);
  const [tab, setTab] = useState<PreviewTab>('new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<SavedResult | null>(null);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  const [choices, setChoices] = useState<Record<string, CategoryChoice>>({});
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [revertTarget, setRevertTarget] = useState<{ importId: number; title: string } | null>(null);
  const dragging = dragCount != null;

  const index = useMemo(() => getCategoryIndex(), [revision]);
  const historyRows = useMemo(
    () => db.select().from(imports).all().sort((a, b) => b.id - a.id).slice(0, 60) as RecentImport[],
    [db, revision],
  );
  const history = groupedImports(historyRows).slice(0, 8);
  const previewFiles = useMemo(() => calculatePreviews(files), [files]);

  const newRows = useMemo<PreviewEntry[]>(() => {
    const learned = getLearnedRules();
    return previewFiles.flatMap((item) => item.preview
      ? dryRunImportPreview(item.preview, index, learned).rows.map((row) => ({ item, row }))
      : []).sort((a, b) => (b.row.txn.isoDate + (b.row.txn.time ?? '')).localeCompare(a.row.txn.isoDate + (a.row.txn.time ?? '')));
  }, [previewFiles, index]);

  const duplicateRows = useMemo(
    () => previewFiles.flatMap((item) => (item.preview?.duplicates ?? []).map((txn) => ({ item, txn })))
      .sort((a, b) => (b.txn.isoDate + (b.txn.time ?? '')).localeCompare(a.txn.isoDate + (a.txn.time ?? ''))),
    [previewFiles],
  );

  /** Where each duplicate already lives (import batch + its saved category). */
  const duplicateInfo = useMemo(() => {
    const info = new Map<string, { id: number; importId: number | null; categoryId: number | null; subcategoryId: number | null }>();
    const keys = [...new Set(duplicateRows.map(({ txn }) => txn.dedupeKey))];
    for (let start = 0; start < keys.length; start += 500) {
      const chunk = keys.slice(start, start + 500);
      const rows = db.select({
        id: transactions.id,
        dedupeKey: transactions.dedupeKey,
        importId: transactions.importId,
        categoryId: transactions.categoryId,
        subcategoryId: transactions.subcategoryId,
      }).from(transactions).where(inArray(transactions.dedupeKey, chunk)).all();
      for (const row of rows) info.set(row.dedupeKey, row);
    }
    return info;
  }, [db, duplicateRows, revision]);

  /** Card statements in this import whose bill was paid, plus new bank payments that settle a stored card bill. */
  const cardMatches = useMemo(() => {
    const perFile = new Map<string, number>();
    let total = 0;
    const storedDue = new Set(cardStatementsQuery(db).all().map((row) => row.totalDuePaise).filter((value): value is number => value != null && value > 0));
    for (const { row } of newRows) {
      if (row.txn.direction === 'out' && row.txn.source !== 'cc' && storedDue.has(row.txn.paise)) total += 1;
    }
    for (const item of previewFiles) {
      const due = item.cardMeta?.totalDuePaise;
      if (!item.preview || due == null || due <= 0) continue;
      const inDb = db.select({ id: transactions.id }).from(transactions)
        .where(eq(transactions.paise, due)).all().length > 0;
      const inImport = newRows.some(({ item: other, row }) => other.id !== item.id && row.txn.direction === 'out' && row.txn.paise === due);
      if (inDb || inImport) {
        perFile.set(item.id, 1);
        total += 1;
      }
    }
    return { perFile, total };
  }, [db, newRows, previewFiles, revision]);

  /** After saving, a row is a real transaction that can be edited (or deleted) elsewhere, so read it back. */
  const savedInfo = useMemo(() => {
    const info = new Map<string, { id: number; categoryId: number | null; subcategoryId: number | null; needsReview: boolean }>();
    const keys = newRows.filter(({ item }) => item.status === 'saved').map(({ row }) => row.txn.dedupeKey);
    for (let start = 0; start < keys.length; start += 500) {
      const rows = db.select({
        id: transactions.id,
        dedupeKey: transactions.dedupeKey,
        categoryId: transactions.categoryId,
        subcategoryId: transactions.subcategoryId,
        needsReview: transactions.needsReview,
      }).from(transactions).where(inArray(transactions.dedupeKey, keys.slice(start, start + 500))).all();
      for (const row of rows) info.set(row.dedupeKey, row);
    }
    return info;
  }, [db, newRows, revision]);
  const isDeleted = ({ item, row }: PreviewEntry) => item.status === 'saved' && !savedInfo.has(row.txn.dedupeKey);
  const entryCategory = ({ item, row }: PreviewEntry) => {
    const stored = item.status === 'saved' ? savedInfo.get(row.txn.dedupeKey) : undefined;
    if (stored) return categoryDisplay(index, stored.categoryId, stored.subcategoryId);
    const choice = choices[row.txn.dedupeKey];
    return choice ? categoryDisplay(index, choice.categoryId, choice.subcategoryId) : categoryDisplay(index, row.categoryId, row.subcategoryId);
  };

  const isIncluded = (key: string) => !excluded.has(key);
  const needsCategory = ({ item, row }: PreviewEntry) => item.status === 'saved'
    ? savedInfo.get(row.txn.dedupeKey)?.needsReview ?? false
    : row.needsReview && choices[row.txn.dedupeKey] == null;
  const includedRows = newRows.filter(({ row }) => isIncluded(row.txn.dedupeKey));
  const pendingRows = includedRows.filter(({ item }) => item.status === 'ready');
  const reviewRows = newRows.filter(needsCategory);
  const visibleRows = tab === 'review' ? reviewRows : newRows;
  const totalToSave = pendingRows.length;
  const reviewCount = includedRows.filter(needsCategory).length;
  const totalDuplicates = duplicateRows.length;
  const readyFiles = previewFiles.filter((item) => item.status === 'ready' || item.status === 'saved');
  const allDuplicateFiles = readyFiles.filter((item) => item.preview && item.preview.newTxns.length === 0 && item.preview.duplicates.length > 0);
  const waitingCount = previewFiles.filter((item) => item.status === 'reading' || item.status === 'locked').length;
  const blockedCount = previewFiles.filter((item) => item.status !== 'ready' && item.status !== 'saved').length;
  const anyReading = previewFiles.some((item) => item.status === 'reading');
  const totalDebit = readyFiles.reduce((sum, item) => sum + (item.preview?.totalDebitPaise ?? 0), 0);
  const totalCredit = readyFiles.reduce((sum, item) => sum + (item.preview?.totalCreditPaise ?? 0), 0);
  const allDates = newRows.map(({ row }) => row.txn.isoDate);
  const isSaved = saved != null;
  const showPreview = !anyReading && readyFiles.length > 0;
  const showHistory = files.length === 0 || isSaved;

  const resetView = () => {
    setTab('new');
    setLimit(PAGE_SIZE);
  };

  const updateFile = (id: string, patch: Partial<ImportFile>) => {
    setFiles((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const readFile = async (id: string, file: File, password?: string, cachedBytes?: Uint8Array) => {
    try {
      const bytes = cachedBytes ?? await readBytes(file, (fraction) => updateFile(id, { progress: Math.round(fraction * 70) }));
      ilog(`web import: read ${bytes.length} bytes`);
      updateFile(id, { progress: 85 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      let sheets: SheetLike[];
      if (isPdf(bytes)) {
        ilog('web import: PDF detected');
        let key: Uint8Array | undefined;
        if (isEncryptedPdf(bytes)) {
          if (password == null) {
            updateFile(id, { status: 'locked', message: 'Password protected · Axis Credit Card', bytes, wrongPassword: false });
            return;
          }
          key = pdfFileKey(bytes, password);
        }
        sheets = parsePdfToSheets(bytes, key);
        ilog(`web import: parsed ${sheets.length} PDF sheet(s)`);
        const pdfLines = sheets.flatMap((sheet) => sheet.pdfLines ?? []);
        const cardMeta = readCardStatementMeta(pdfLines);
        updateFile(id, { sheets, bytes: undefined, status: 'ready', message: '', progress: 100, wrongPassword: false, cardMeta });
      } else {
        ilog('web import: spreadsheet detected');
        let workbookBytes = bytes;
        if (isEncryptedWorkbook(bytes)) {
          if (password == null) {
            updateFile(id, { status: 'locked', message: 'Password protected · Excel statement', bytes, wrongPassword: false });
            return;
          }
          workbookBytes = decryptWorkbook(bytes, password);
        }
        sheets = parseXlsxBytes(workbookBytes);
        ilog(`web import: parsed ${sheets.length} worksheet(s)`);
        updateFile(id, { sheets, bytes: undefined, status: 'ready', message: '', progress: 100, wrongPassword: false, cardMeta: null });
      }
    } catch (reason) {
      if (reason instanceof WrongPasswordError) {
        ilog('web import: password rejected');
        updateFile(id, { status: 'locked', wrongPassword: true });
        return;
      }
      ilog('web import: file parsing failed');
      updateFile(id, { status: 'error', message: reason instanceof Error ? reason.message : String(reason) });
    }
  };

  const addFiles = (selected: FileList | File[]) => {
    const incoming = Array.from(selected);
    if (!incoming.length) return;
    resetImportLog();
    setSaved(null);
    setNotice(null);
    setError('');
    resetView();
    const additions: ImportFile[] = incoming.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      status: 'reading',
      progress: 0,
      message: '',
    }));
    setFiles((current) => [...current.filter((item) => item.status !== 'saved'), ...additions]);
    additions.forEach((item) => void readFile(item.id, item.file));
  };

  const removeFile = (id: string) => setFiles((current) => current.filter((item) => item.id !== id));

  const unlockFile = (item: ImportFile, password: string) => {
    if (!item.bytes || !password.trim()) return;
    updateFile(item.id, { status: 'reading', progress: 85, message: item.message });
    void readFile(item.id, item.file, password, item.bytes);
  };

  const openChooser = () => fileInput.current?.click();
  const onDropKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openChooser();
    }
  };

  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');
  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragCount(event.dataTransfer.items.length);
  };
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!hasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragCount(null);
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragCount(null);
    addFiles(event.dataTransfer.files);
  };

  const toggleRow = (key: string) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const visibleKeys = visibleRows.filter(({ item }) => item.status === 'ready').map(({ row }) => row.txn.dedupeKey);
  const checkedVisible = visibleKeys.filter(isIncluded).length;
  const headerState = visibleKeys.length > 0 && checkedVisible === visibleKeys.length ? ' is-on' : checkedVisible > 0 ? ' is-mixed' : '';
  const toggleAll = () => {
    setExcluded((current) => {
      const next = new Set(current);
      if (checkedVisible === visibleKeys.length) visibleKeys.forEach((key) => next.add(key));
      else visibleKeys.forEach((key) => next.delete(key));
      return next;
    });
  };

  const pickerEntry = picker ? newRows.find(({ row }) => row.txn.dedupeKey === picker.key) ?? null : null;
  const sameRows = pickerEntry
    ? newRows.filter(({ row }) => row.txn.dedupeKey !== pickerEntry.row.txn.dedupeKey && payeeKey(row.txn) === payeeKey(pickerEntry.row.txn))
    : [];
  const closePicker = useCallback(() => setPicker(null), []);
  const closeDetail = useCallback(() => setDetail(null), []);

  const openEntry = ({ item, row }: PreviewEntry) => {
    const key = row.txn.dedupeKey;
    setPicker(null);
    if (item.status !== 'saved') {
      setDetail({ kind: 'preview', key });
      return;
    }
    const txnId = savedInfo.get(key)?.id;
    if (txnId != null) setDetail({ kind: 'saved', txnId, key });
  };
  const openDuplicate = (dedupeKey: string) => {
    const known = duplicateInfo.get(dedupeKey);
    if (known) setDetail({ kind: 'saved', txnId: known.id, key: dedupeKey });
  };
  /** Rows open on click or Enter, except when the click lands on the row's own checkbox or category pill. */
  const rowProps = (open: () => void, label: string) => ({
    tabIndex: 0,
    'aria-label': label,
    onClick: (event: ReactMouseEvent<HTMLElement>) => { if (!(event.target as HTMLElement).closest('button, a, input')) open(); },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    },
  });
  const previewEntry = detail?.kind === 'preview' ? newRows.find(({ row }) => row.txn.dedupeKey === detail.key) ?? null : null;
  useEffect(() => {
    if (detail?.kind === 'preview' && !previewEntry) setDetail(null);
  }, [detail, previewEntry]);

  const applyChoice = (choice: CategoryChoice, alsoSame: boolean) => {
    if (!pickerEntry) return;
    const targets = [pickerEntry, ...(alsoSame ? sameRows : [])];
    setChoices((current) => {
      const next = { ...current };
      for (const { row } of targets) next[row.txn.dedupeKey] = choice;
      return next;
    });
    try {
      for (const { item, row } of targets) {
        if (item.status !== 'saved' || readOnly) continue;
        const txnId = lookupTxnId(row.txn.dedupeKey);
        if (txnId != null) setTransactionCategory(txnId, choice.categoryId, choice.subcategoryId);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
    setPicker(null);
  };

  const save = async () => {
    if (busy || totalToSave === 0 || readOnly) return;
    setBusy(true);
    setError('');
    setNotice(null);
    try {
      const fresh = calculatePreviews(previewFiles);
      const ready = fresh.filter((item) => item.preview && item.status === 'ready');
      const batch = ready.map((item) => ({
        sourceLabel: item.file.name,
        txns: item.preview!.newTxns.filter((txn) => isIncluded(txn.dedupeKey)),
        cardMeta: item.cardMeta ?? null,
      }));
      const added = saveImportBatch(batch);
      const importId = added > 0 ? getLastImport()?.id ?? null : null;
      const duplicates = ready.flatMap((item) => item.preview?.duplicates ?? []);
      const reconciled = reconcileDuplicatesFromImport(duplicates);
      const savedKeys = new Set(batch.flatMap((file) => file.txns.map((txn) => txn.dedupeKey)));
      for (const [dedupeKey, choice] of Object.entries(choices)) {
        if (!savedKeys.has(dedupeKey)) continue;
        const txnId = lookupTxnId(dedupeKey);
        if (txnId != null) setTransactionCategory(txnId, choice.categoryId, choice.subcategoryId);
      }
      const learned = getLearnedRules();
      const review = ready.reduce((sum, item) => sum + dryRunImportPreview(item.preview!, index, learned).rows.filter((row) =>
        savedKeys.has(row.txn.dedupeKey) && row.needsReview && choices[row.txn.dedupeKey] == null,
      ).length, 0);
      setSaved({ importId, added, files: batch.filter((file) => file.txns.length > 0).length, review, updated: reconciled.updated, flagged: reconciled.flagged });
      const savedFiles = new Map(ready.map((item) => [item.id, item]));
      setFiles((current) => current.map((item) => {
        const done = savedFiles.get(item.id);
        return done ? { ...item, preview: done.preview, formatName: done.formatName, status: 'saved' } : item;
      }));
      setDetail((current) => {
        if (current?.kind !== 'preview') return current;
        const txnId = lookupTxnId(current.key);
        return txnId != null ? { kind: 'saved', txnId, key: current.key } : null;
      });
      ilog(`web import: saved ${added} transaction(s) in one batch`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const revert = (importId: number) => {
    setRevertTarget(null);
    if (readOnly) return;
    try {
      const count = revertImport(importId);
      setNotice({ title: `Reverted import #${importId}`, body: `Removed ${count} transaction${count === 1 ? '' : 's'} from your data.` });
      setDetail((current) => current?.kind === 'saved' && lookupTxnId(current.key) == null ? null : current);
      if (saved && saved.importId === importId) {
        setSaved(null);
        setFiles((current) => current.map((item) => item.status === 'saved' ? { ...item, status: 'ready' } : item));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const askRevert = (importId: number) => {
    if (readOnly) return;
    const group = history.find((entry) => entry.latestId === importId);
    setRevertTarget({ importId, title: group?.title ?? `Import #${importId}` });
  };

  const sentinel = useRef<HTMLTableRowElement>(null);
  const shownCount = Math.min(limit, tab === 'duplicates' ? duplicateRows.length : visibleRows.length);
  const totalForTab = tab === 'duplicates' ? duplicateRows.length : visibleRows.length;
  useEffect(() => { if (readOnly) setRevertTarget(null); }, [readOnly]);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || shownCount >= totalForTab) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setLimit((value) => value + PAGE_SIZE);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [shownCount, totalForTab]);

  const fileSourceLabel = (item: ImportFile): string => {
    const name = item.formatName ?? item.file.name;
    const month = monthLabel(item.cardMeta?.statementMonth);
    return month ? `${name} · ${month}` : name;
  };

  const filesWord = allDuplicateFiles.length > 0 ? 'read' : 'ready';
  const saveNote = isSaved
    ? 'Saves to Drive as one import, so you can revert it in one step.'
    : waitingCount > 0
    ? `Waiting for ${waitingCount} file${waitingCount === 1 ? '' : 's'}. Unlock or remove them, or save what’s ready now.`
    : blockedCount > 0
      ? `${blockedCount} file${blockedCount === 1 ? '' : 's'} couldn’t be read and will stay in the list. You can save what’s ready now.`
      : totalDuplicates > 0
        ? 'Duplicates are matched by date, amount and reference number and won’t be saved again.'
        : 'Saves to Drive as one import, so you can revert it in one step.';

  const renderPill = ({ item, row }: PreviewEntry) => {
    const key = row.txn.dedupeKey;
    if (isDeleted({ item, row })) return <span className="cat-pill"><span className="ms" style={{ fontSize: 14 }} aria-hidden="true">delete</span><span>Deleted</span></span>;
    const display = entryCategory({ item, row });
    const review = needsCategory({ item, row });
    const open = (event: ReactMouseEvent<HTMLElement>) => {
      event.stopPropagation();
      setPicker({ key, anchor: event.currentTarget.getBoundingClientRect() });
    };
    const label = `Category for ${payeeOf(row.txn)}: ${display?.label ?? 'none'}. Change`;
    // A saved row's category lives in the DB; a preview row's choice is only in memory until Save.
    const locked = readOnly && item.status === 'saved';
    const lockProps = locked ? { disabled: true, 'aria-disabled': true, title: VIEW_ONLY_HINT } as const : {};
    if (review) {
      return <button type="button" className="cat-pill cat-pill--review" onClick={open} aria-label={label} aria-haspopup="dialog" {...lockProps}>
        <span className="ms" style={{ fontSize: 14 }} aria-hidden="true">flag</span><span>{display ? display.label : 'Pick a category'}</span>
      </button>;
    }
    return <button type="button" className="cat-pill" onClick={open} aria-label={label} aria-haspopup="dialog" {...lockProps}>
      <span className="em" aria-hidden="true">{display?.emoji ?? '🏷️'}</span><span>{display?.label ?? 'Uncategorised'}</span>
    </button>;
  };

  return (
    <div className="w-body">
      <main className="w-main" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept=".xlsx,.xls,.pdf"
          aria-label="Choose statement files"
          onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ''; }}
        />
        <div className="w-head">
          <div className="w-head__copy">
            <span className="t-title">Import statements</span>
            <span className="t-small muted">Drop several files at once. They’re read in this browser; only the transactions are saved to your Drive file.</span>
          </div>
        </div>

        {saved && <div className="banner banner--success banner--wrap" role="status"><span className="ms" aria-hidden="true">check_circle</span>
          <div className="banner__copy"><div className="t-small-em">Saved {saved.added} transaction{saved.added === 1 ? '' : 's'}{saved.importId != null ? ` · import #${saved.importId}` : ''}</div>
            <div className="t-small muted">
              From {saved.files} file{saved.files === 1 ? '' : 's'}, written to finance-live.db on Drive. {saved.review} need{saved.review === 1 ? 's' : ''} a category.
              {saved.updated > 0 && ` ${saved.updated} already-imported transaction${saved.updated === 1 ? ' was' : 's were'} updated${saved.flagged ? `; ${saved.flagged} need review` : ''}.`}
            </div></div>
          {saved.review > 0 && <Link className="banner__action" to="/transactions?review=1">Review {saved.review}</Link>}
          {saved.importId != null && <button type="button" className="banner__action" style={{ color: 'var(--text-secondary)' }} disabled={readOnly} aria-disabled={readOnly || undefined} title={readOnly ? VIEW_ONLY_HINT : undefined} onClick={() => askRevert(saved.importId!)}>Revert</button>}
        </div>}

        {notice && <div className="banner banner--success banner--wrap" role="status"><span className="ms" aria-hidden="true">undo</span>
          <div className="banner__copy"><div className="t-small-em">{notice.title}</div><div className="t-small muted">{notice.body}</div></div>
          <button type="button" className="banner__action" style={{ color: 'var(--text-secondary)' }} onClick={() => setNotice(null)}>Dismiss</button>
        </div>}

        {error && <div className="banner banner--danger banner--wrap" role="alert"><span className="ms" aria-hidden="true">error</span>
          <div className="banner__copy"><div className="t-small-em">Something went wrong</div><div className="t-small muted">{error}</div></div>
          <button type="button" className="banner__action" style={{ color: 'var(--text-secondary)' }} onClick={() => setError('')}>Dismiss</button>
        </div>}

        {files.length === 0 && <>
          <div
            className={`drop drop--big${dragging ? ' is-over' : ''}`}
            role="button"
            tabIndex={0}
            aria-label="Drop statements here, or choose files"
            onClick={openChooser}
            onKeyDown={onDropKeyDown}
          >
            <span className="drop__icon"><span className="ms" aria-hidden="true">upload_file</span></span>
            <span className="t-heading">{dragging && dragCount ? `Drop ${dragCount} file${dragCount === 1 ? '' : 's'} to import` : 'Drop statements here'}</span>
            <span className="t-small muted">or <span className="t-link">choose files</span> · .xlsx, .xls and password-protected PDF</span>
          </div>

          <div className="card card--lg">
            <div className="card__head"><span className="t-heading">Supported statements</span><span className="t-caption muted">The format is detected automatically</span></div>
            <div className="src-list">
              {IMPORT_FORMATS.map((format) => {
                const pdf = format.fileTypes.includes('.pdf');
                const caption = format.locked
                  ? (pdf ? 'Locked PDF statement' : `${format.fileTypes} · locked`)
                  : `${format.fileTypes.replace(/ · /g, ' / ')}${format.id === 'paytm' ? ' · may be locked' : ''}`;
                return <div className="src" key={format.id}><span className="ms" aria-hidden="true">{pdf ? 'picture_as_pdf' : 'table_view'}</span>
                  <div className="col gap-0"><span className="t-label">{format.name}</span><span className="t-caption muted">{caption}</span></div></div>;
              })}
            </div>
          </div>
        </>}

        {files.length > 0 && <div className="grid grid-main-side imp-grid">
          <div className="col gap-4" style={{ minWidth: 0 }}>
            {!isSaved && <div
              className={`drop${dragging ? ' is-over' : ''}`}
              role="button"
              tabIndex={0}
              aria-label="Add more files: drop here or click to choose"
              onClick={openChooser}
              onKeyDown={onDropKeyDown}
            >
              <span className="drop__icon"><span className="ms" aria-hidden="true">add</span></span>
              <div className="grow col gap-0"><span className="t-label">{dragging && dragCount ? `Drop ${dragCount} file${dragCount === 1 ? '' : 's'} to import` : 'Add more files'}</span><span className="t-caption muted">Drop here or click to choose</span></div>
            </div>}

            <div className="card card--lg">
              <div className="card__head" style={{ marginBottom: 0 }}><span className="t-heading">Files</span><span className="t-caption muted">{files.length} file{files.length === 1 ? '' : 's'}</span></div>
              <div className="fq">
                {previewFiles.map((item) => <FileRow
                  key={item.id}
                  item={item}
                  cardMatches={cardMatches.perFile.get(item.id) ?? 0}
                  onRemove={removeFile}
                  onUnlock={unlockFile}
                />)}
              </div>
            </div>

            {showPreview && <div className="card card--lg card--none imp-preview" style={{ padding: 0 }}>
              <div className="row row--between wrap" style={{ padding: 'var(--sp-3) var(--sp-4) 0', gap: 'var(--sp-2)' }}>
                <div className="dp-tabs" style={{ margin: 0 }} role="tablist" aria-label="Import preview">
                  {([['new', 'All new', newRows.length], ['review', 'Needs review', reviewRows.length], ['duplicates', 'Duplicates', totalDuplicates]] as const).map(([id, label, count]) =>
                    <button key={id} type="button" role="tab" aria-selected={tab === id} className={`dp-tab${tab === id ? ' is-selected' : ''}`} onClick={() => { setTab(id); setLimit(PAGE_SIZE); }}>
                      {label} <span className="muted">{count}</span>
                    </button>)}
                </div>
                <span className="t-caption muted hide-phone">Click a row for details, or a category to change it</span>
              </div>
              <div className="tbl-wrap hide-phone" style={{ border: 0, borderRadius: 0 }}>
                <table className="tbl">
                  <thead><tr>
                    <th className="c-check">{tab === 'duplicates'
                      ? <span className="cb" aria-hidden="true"><span className="ms">check</span></span>
                      : <button type="button" className={`cb${headerState}`} role="checkbox" aria-checked={headerState === ' is-on' ? true : headerState === ' is-mixed' ? 'mixed' : false} aria-label="Include all rows" disabled={isSaved || visibleKeys.length === 0} onClick={toggleAll}><span className="ms" aria-hidden="true">check</span></button>}</th>
                    <th className="c-date">Date</th><th>Payee</th><th className="c-cat">Category</th><th className="c-src hide-tablet hide-with-panel">From file</th><th className="c-amt num">Amount</th>
                  </tr></thead>
                  <tbody>
                    {tab === 'duplicates'
                      ? duplicateRows.slice(0, limit).map(({ item, txn }, position) => {
                        const known = duplicateInfo.get(txn.dedupeKey);
                        const display = known ? categoryDisplay(index, known.categoryId, known.subcategoryId) : null;
                        const amount = signedPaise(txn);
                        return <tr className={`t-row dup${detail?.key === txn.dedupeKey ? ' is-active' : ''}`} key={`${item.id}-${position}`}
                          {...(known ? rowProps(() => openDuplicate(txn.dedupeKey), `${payeeOf(txn)}: open details`) : {})}>
                          <td className="c-check"><span className="cb" aria-hidden="true"><span className="ms">check</span></span></td>
                          <td className="t-small muted">{shortDate(txn.isoDate)}</td>
                          <td><div className="col gap-0" style={{ minWidth: 0 }}><span className="t-label truncate">{payeeOf(txn)}</span>
                            <span className="t-caption muted">{known ? `Already imported${known.importId != null ? ` · #${known.importId}` : ''}` : 'Repeated in this import'}</span></div></td>
                          <td>{display
                            ? <span className="cat-pill"><span className="em">{display.emoji}</span><span>{display.label}</span></span>
                            : <span className="cat-pill"><span className="em">🏷️</span><span>Uncategorised</span></span>}</td>
                          <td className="t-small muted hide-tablet hide-with-panel">{fileSourceLabel(item)}</td>
                          <td className={`num t-small-em${amount > 0 && txn.direction === 'in' ? ' c-income' : ''}`}>{formatInr(amount, { sign: txn.direction === 'in' })}</td>
                        </tr>;
                      })
                      : visibleRows.slice(0, limit).map((entry) => {
                        const { item, row } = entry;
                        const key = row.txn.dedupeKey;
                        const on = isIncluded(key);
                        const amount = signedPaise(row.txn);
                        return <tr className={`t-row${detail?.key === key ? ' is-active' : ''}`} key={`${item.id}-${key}`} {...(isDeleted(entry) ? {} : rowProps(() => openEntry(entry), `${payeeOf(row.txn)}: open details`))}>
                          <td className="c-check"><button type="button" className={`cb${on ? ' is-on' : ''}`} role="checkbox" aria-checked={on} aria-label={`Include ${payeeOf(row.txn)}`} disabled={item.status === 'saved'} onClick={() => toggleRow(key)}><span className="ms" aria-hidden="true">check</span></button></td>
                          <td className="t-small muted">{shortDate(row.txn.isoDate)}</td>
                          <td><div className="col gap-0" style={{ minWidth: 0 }}><span className="t-label truncate">{payeeOf(row.txn)}</span></div></td>
                          <td>{renderPill(entry)}</td>
                          <td className="t-small muted hide-tablet hide-with-panel">{fileSourceLabel(item)}</td>
                          <td className={`num t-small-em${row.txn.direction === 'in' ? ' c-income' : ''}`}>{formatInr(amount, { sign: row.txn.direction === 'in' })}</td>
                        </tr>;
                      })}
                    {totalForTab === 0 && <tr><td colSpan={6} className="t-small muted" style={{ textAlign: 'center' }}>
                      {tab === 'review' ? 'No transactions need review.' : tab === 'duplicates' ? 'Nothing here was imported before.' : 'No new transactions to preview.'}
                    </td></tr>}
                    {shownCount < totalForTab && <tr ref={sentinel}><td colSpan={6} className="t-small muted" style={{ textAlign: 'center' }}>Showing {shownCount} of {totalForTab} · scroll for more</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="mlist only-phone" style={{ padding: '0 var(--sp-3) var(--sp-2)' }}>
                {tab === 'duplicates'
                  ? duplicateRows.slice(0, limit).map(({ item, txn }, position) => {
                    const known = duplicateInfo.get(txn.dedupeKey);
                    const display = known ? categoryDisplay(index, known.categoryId, known.subcategoryId) : null;
                    return <div className="mrow" style={{ opacity: 0.55 }} key={`${item.id}-${position}`} role={known ? 'button' : undefined}
                      {...(known ? rowProps(() => openDuplicate(txn.dedupeKey), `${payeeOf(txn)}: open details`) : {})}>
                      <span className="mrow__glyph" aria-hidden="true">{display?.emoji ?? '🏷️'}</span>
                      <div className="mrow__left"><span className="t-label">{payeeOf(txn)}</span><span className="t-caption muted">{display?.label ?? 'Already imported'} · {shortDate(txn.isoDate)}</span></div>
                      <div className="mrow__right"><span className={`t-small-em${txn.direction === 'in' ? ' c-income' : ''}`}>{formatInr(signedPaise(txn), { sign: txn.direction === 'in' })}</span><span className="t-caption muted">{fileSourceLabel(item)}</span></div>
                    </div>;
                  })
                  : visibleRows.slice(0, limit).map((entry) => {
                    const { item, row } = entry;
                    const key = row.txn.dedupeKey;
                    const deleted = isDeleted(entry);
                    const display = entryCategory(entry);
                    const review = needsCategory(entry);
                    return <div
                      className={`mrow${isIncluded(key) ? '' : ' is-muted'}`}
                      style={isIncluded(key) ? undefined : { opacity: 0.55 }}
                      key={`${item.id}-${key}`}
                      role={deleted ? undefined : 'button'}
                      {...(deleted ? {} : rowProps(() => openEntry(entry), `${payeeOf(row.txn)}: open details`))}
                    >
                      <span className="mrow__glyph" aria-hidden="true">{review ? '❔' : display?.emoji ?? '🏷️'}</span>
                      <div className="mrow__left"><span className="t-label">{payeeOf(row.txn)}</span>
                        <span className={`t-caption ${review ? 'c-review' : 'muted'}`}>{deleted ? 'Deleted' : review ? 'Pick a category' : display?.label.split(' · ')[0] ?? 'Uncategorised'} · {shortDate(row.txn.isoDate)}</span></div>
                      <div className="mrow__right"><span className={`t-small-em${row.txn.direction === 'in' ? ' c-income' : ''}`}>{formatInr(signedPaise(row.txn), { sign: row.txn.direction === 'in' })}</span><span className="t-caption muted">{fileSourceLabel(item)}</span></div>
                    </div>;
                  })}
                {totalForTab === 0 && <div className="t-small muted" style={{ textAlign: 'center', padding: 'var(--sp-3) 0' }}>
                  {tab === 'review' ? 'No transactions need review.' : tab === 'duplicates' ? 'Nothing here was imported before.' : 'No new transactions to preview.'}
                </div>}
                {shownCount < totalForTab && <button type="button" className="btn btn--sm btn--ghost btn--block" onClick={() => setLimit((value) => value + PAGE_SIZE)}>Show more · {shownCount} of {totalForTab}</button>}
              </div>
            </div>}
          </div>

          <div className="imp-side">
            <div className="card card--lg sumcard">
              <span className="t-overline muted">SUMMARY</span>
              <div className="sum__row"><span className="t-small">Files</span><span className="t-small-em">{readyFiles.length} of {files.length} {filesWord}</span></div>
              <div className="sum__row"><span className="t-small"><span className="ms c-income" aria-hidden="true">add_circle</span>New transactions</span><span className="t-small-em tabular">{includedRows.length}</span></div>
              <div className="sum__row"><span className="t-small"><span className="ms c-review" aria-hidden="true">flag</span>Need a category</span><span className="t-small-em tabular">{reviewCount}</span></div>
              <div className="sum__row"><span className="t-small"><span className="ms muted" aria-hidden="true">content_copy</span>Already imported</span><span className="t-small-em tabular">{totalDuplicates} · skipped</span></div>
              <div className="sum__row"><span className="t-small"><span className="ms muted" aria-hidden="true">link</span>Card bills matched</span><span className="t-small-em tabular">{cardMatches.total}</span></div>
              <div style={{ borderTop: 'var(--hairline) solid var(--border)' }} />
              <div className="sum__row"><span className="t-small muted">Money out</span><span className="t-small-em tabular c-spend">{formatInr(totalDebit)}</span></div>
              <div className="sum__row"><span className="t-small muted">Money in</span><span className="t-small-em tabular c-income">{formatInr(totalCredit)}</span></div>
              <div className="sum__row"><span className="t-small muted">Date range</span><span className="t-small-em">{dateRange(allDates, true)}</span></div>
              {isSaved
                ? <button type="button" className="btn btn--block" onClick={openChooser}><span className="ms" aria-hidden="true">add</span>Import more files</button>
                : <button type="button" className="btn btn--primary btn--block" disabled={busy || totalToSave === 0 || readOnly} aria-disabled={readOnly || undefined} onClick={() => void save()}>
                  <span className="ms" aria-hidden="true">cloud_upload</span>{busy ? 'Saving…' : `Save ${totalToSave} transaction${totalToSave === 1 ? '' : 's'}`}
                </button>}
              <span className="t-caption muted">{readOnly && !isSaved ? VIEW_ONLY_HINT : saveNote}</span>
            </div>
          </div>
        </div>}

        {showHistory && <div className="card card--lg">
          <div className="card__head"><span className="t-heading">Recent imports</span><Link className="t-link" to="/settings?section=drive">History</Link></div>
          <div className="list">
            {history.map((entry, position) => <div className="lrow" key={entry.key}>
              <span className={`badge${position === 0 ? ' badge--accent' : ''}`}>#{entry.latestId}</span>
              <div className="grow col gap-0"><span className="t-label">{entry.title}</span><span className="t-caption muted">{importedWhen(entry.importedAt)} · {entry.web ? 'on the web' : 'on your phone'}</span></div>
              {position === 0 && <button type="button" className="btn btn--sm" disabled={readOnly} aria-disabled={readOnly || undefined} title={readOnly ? VIEW_ONLY_HINT : undefined} onClick={() => askRevert(entry.latestId)}>Revert</button>}
            </div>)}
            {history.length === 0 && <div className="lrow"><div className="grow col gap-0"><span className="t-label">No imports yet</span><span className="t-caption muted">Saved imports show up here.</span></div></div>}
          </div>
          <span className="t-caption muted" style={{ marginTop: 'var(--sp-2)', display: 'block' }}>{readOnly ? VIEW_ONLY_HINT : 'Revert removes the most recent import, including any edits made to those transactions since.'}</span>
        </div>}
      </main>

      <TransactionDetailPanel
        txnId={detail?.kind === 'saved' ? detail.txnId : null}
        onClose={closeDetail}
      />
      <div className="act" style={{ display: 'contents' }}><DetailPanel
        open={detail?.kind === 'preview' && previewEntry != null}
        onClose={closeDetail}
        label="Transaction preview"
        bar={<span className="t-overline muted">NOT SAVED YET</span>}
        footer={<span className="save-note t-caption grow"><Icon name="info" />Saved with the rest of this import</span>}
      >
        {previewEntry && <PreviewDetail
          entry={previewEntry}
          sourceLabel={fileSourceLabel(previewEntry.item)}
          display={entryCategory(previewEntry)}
          chosen={choices[previewEntry.row.txn.dedupeKey] != null}
          review={needsCategory(previewEntry)}
          included={isIncluded(previewEntry.row.txn.dedupeKey)}
          onToggleIncluded={() => toggleRow(previewEntry.row.txn.dedupeKey)}
          onPick={(anchor) => setPicker({ key: previewEntry.row.txn.dedupeKey, anchor })}
        />}
      </DetailPanel></div>

      {picker && pickerEntry && <CategoryPicker
        anchor={picker.anchor}
        index={index}
        current={choices[picker.key] ?? (pickerEntry.row.categoryId != null ? { categoryId: pickerEntry.row.categoryId, subcategoryId: pickerEntry.row.subcategoryId } : null)}
        suggested={pickerEntry.row.categoryId != null ? { categoryId: pickerEntry.row.categoryId, subcategoryId: pickerEntry.row.subcategoryId } : null}
        payee={payeeOf(pickerEntry.row.txn)}
        sameCount={sameRows.length}
        onSave={applyChoice}
        onClose={closePicker}
      />}

      {revertTarget && <div className="w-modal" role="presentation" onClick={() => setRevertTarget(null)}>
        <div className="w-dialog" role="alertdialog" aria-modal="true" aria-labelledby="revert-title" onClick={(event) => event.stopPropagation()}>
          <div className="w-dialog__head">
            <span className="w-dialog__icon w-dialog__icon--danger"><span className="ms" aria-hidden="true">undo</span></span>
            <div className="col gap-1"><span className="t-heading" id="revert-title">Revert import #{revertTarget.importId}?</span>
              <span className="t-small muted">{revertTarget.title}. All transactions added by every file in this batch will be removed, including any edits made to them since.</span></div>
          </div>
          <div className="w-dialog__actions">
            <button type="button" className="btn" autoFocus onClick={() => setRevertTarget(null)}>Cancel</button>
            <button type="button" className="btn btn--danger" disabled={readOnly} onClick={() => revert(revertTarget.importId)}><span className="ms" aria-hidden="true">undo</span>Revert import</button>
          </div>
        </div>
      </div>}
    </div>
  );
}

function time12(time: string | null): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Read-only view of a statement row before it is saved, laid out like the Activity detail panel. */
function PreviewDetail({ entry, sourceLabel, display, chosen, review, included, onToggleIncluded, onPick }: {
  entry: PreviewEntry;
  sourceLabel: string;
  display: { emoji: string; label: string } | null;
  chosen: boolean;
  review: boolean;
  included: boolean;
  onToggleIncluded: () => void;
  onPick: (anchor: DOMRect) => void;
}) {
  const { item, row } = entry;
  const txn = row.txn;
  const out = txn.direction === 'out';
  const isSelf = txn.direction === 'self';
  const amount = signedPaise(txn);
  const payee = payeeOf(txn);
  const canEdit = item.status !== 'saved';
  return <>
    <div className="dp-head">
      <div className="dp-title">
        <span className="dp-badge" style={{ background: `var(--${out ? 'spend' : 'income'}-muted)`, color: `var(--${out ? 'spend' : 'income'})` }}><Icon name={isSelf ? 'swap_horiz' : out ? 'north_east' : 'south_west'} /></span>
        <span className="t-heading grow truncate">{payee}</span>
        <span className={`dp-amount${txn.direction === 'in' ? ' c-income' : ''}`}>{formatInr(amount, { sign: true })}</span>
      </div>
      <span className="t-small muted">{isSelf ? 'Self-transfer' : out ? 'Money out' : 'Money in'} · {longDate(txn.isoDate)}{txn.time ? ` · ${time12(txn.time)}` : ''}</span>
    </div>

    <div className="banner banner--wrap"><Icon name="info" /><div className="banner__copy t-small">This row isn’t saved yet. After you save the import, it opens like any transaction in Activity, with notes, people, loans and card bills.</div></div>

    <div className="dp-section"><span className="t-overline muted">CATEGORY</span>
      <div className={`dp-cat${review ? ' dp-cat--review' : ''}`}>
        <span className="dp-cat__em">{review ? '❔' : display?.emoji ?? '🏷️'}</span>
        <div className="grow col gap-0" style={{ minWidth: 0 }}>
          <span className="t-label truncate">{review ? 'Needs a category' : display?.label ?? 'Uncategorised'}</span>
          <span className={`t-caption ${review ? 'c-review' : 'muted'}`}>{review
            ? 'Couldn’t match this payee. Pick one and it will be remembered.'
            : chosen ? 'Set by you' : display ? 'Auto-categorized from payee' : 'Not counted in any category yet'}</span>
        </div>
        <button type="button" className="btn btn--sm" aria-haspopup="dialog" onClick={(event) => onPick(event.currentTarget.getBoundingClientRect())}>{review || !display ? 'Pick' : 'Change'}</button>
      </div>
    </div>

    {canEdit && <div className="dp-section"><span className="t-overline muted">THIS IMPORT</span>
      <div className="toggle-chips">
        <button type="button" className={`tchip${included ? ' is-on' : ''}`} aria-pressed={included} onClick={onToggleIncluded}><Icon name={included ? 'check' : 'block'} />{included ? 'Will be saved' : 'Skipped'}</button>
      </div>
      {!included && <span className="t-caption muted">Skipped rows aren’t saved. Turn this back on to include it.</span>}
    </div>}

    <div className="dp-section"><span className="t-overline muted">TRANSACTION</span><div className="dl">
      <div className="dl__row"><span className="dl__k">Direction</span><span className="dl__v">{isSelf ? 'Self-transfer' : out ? 'Outgoing' : 'Incoming'}</span></div>
      <div className="dl__row"><span className="dl__k">Amount</span><span className="dl__v tabular">{formatInr(txn.paise)}</span></div>
      <div className="dl__row"><span className="dl__k">Date and time</span><span className="dl__v">{longDate(txn.isoDate)}{txn.time ? `, ${time12(txn.time)}` : ''}</span></div>
      <div className="dl__row"><span className="dl__k">{out ? 'Paid to' : 'Received from'}</span><span className="dl__v">{payee}{txn.counterpartyVpa ? ` · ${txn.counterpartyVpa}` : ''}</span></div>
      <div className="dl__row"><span className="dl__k">Account</span><span className="dl__v">{txn.accountName || '—'}</span></div>
    </div></div>

    <div className="dp-section"><span className="t-overline muted">FROM THE STATEMENT</span><div className="dl">
      <div className="dl__row"><span className="dl__k">File</span><span className="dl__v">{item.file.name}</span></div>
      <div className="dl__row"><span className="dl__k">Format</span><span className="dl__v">{sourceLabel}</span></div>
      <div className="dl__row"><span className="dl__k">UPI reference</span><span className="dl__v t-code" style={{ fontSize: 12 }}>{txn.sourceRef || '—'}</span></div>
      {txn.orderId && <div className="dl__row"><span className="dl__k">Order ID</span><span className="dl__v t-code" style={{ fontSize: 12 }}>{txn.orderId}</span></div>}
      {txn.rawTag && <div className="dl__row"><span className="dl__k">Tag</span><span className="dl__v">{txn.rawTag}</span></div>}
      <div className="dl__row"><span className="dl__k">Original text</span><span className="dl__v">{txn.rawDetails || '—'}</span></div>
      {txn.remarks && <div className="dl__row"><span className="dl__k">Remarks</span><span className="dl__v">{txn.remarks}</span></div>}
    </div></div>
  </>;
}

function FileRow({ item, cardMatches, onRemove, onUnlock }: {
  item: ImportFile;
  cardMatches: number;
  onRemove: (id: string) => void;
  onUnlock: (item: ImportFile, password: string) => void;
}) {
  const [password, setPassword] = useState('');
  const pdf = item.file.name.toLowerCase().endsWith('.pdf');
  const remove = <button type="button" className="icon-btn icon-btn--sm icon-btn--plain fq__remove" title="Remove" aria-label={`Remove ${item.file.name}`} onClick={() => onRemove(item.id)}><span className="ms" aria-hidden="true">close</span></button>;
  let icon = pdf ? 'picture_as_pdf' : 'table_view';
  let tone = '';
  let sub = '';
  let right: ReactNode = null;
  let extra: ReactNode = null;

  if (item.status === 'reading') {
    icon = 'progress_activity';
    sub = `Reading… ${item.progress}%`;
    right = <button type="button" className="icon-btn icon-btn--sm icon-btn--plain" title="Cancel" aria-label={`Cancel reading ${item.file.name}`} onClick={() => onRemove(item.id)}><span className="ms" aria-hidden="true">close</span></button>;
    extra = <div className="progress grow" style={{ maxWidth: 320 }} role="progressbar" aria-label={`Reading ${item.file.name}`} aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${item.progress}%` }} /></div>;
  } else if (item.status === 'locked') {
    icon = 'lock';
    tone = item.wrongPassword ? 'bad' : 'warn';
    sub = item.message || 'Password protected';
    right = <div className="fq__right">{remove}{item.wrongPassword
      ? <span className="badge badge--spend">Wrong password</span>
      : <span className="badge badge--review">Locked</span>}</div>;
    const fieldId = `pw-${item.id}`;
    extra = <form onSubmit={(event) => { event.preventDefault(); onUnlock(item, password); }}>
      <div className="field">
        <label className={`field__box field__box--sm${item.wrongPassword ? ' is-error' : ''}`} htmlFor={fieldId}>
          <input id={fieldId} type="password" autoComplete="off" aria-label={`Password for ${item.file.name}`} aria-invalid={item.wrongPassword || undefined} placeholder="Statement password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {item.wrongPassword
          ? <span className="field__error" role="alert">That password didn’t open the file.</span>
          : <span className="field__help">Usually your name + date of birth. Not saved.</span>}
      </div>
      <button type="submit" className="btn btn--sm btn--primary" disabled={!password.trim()}>{item.wrongPassword ? 'Try again' : 'Unlock'}</button>
    </form>;
  } else if (item.status === 'error') {
    icon = 'help';
    tone = 'bad';
    sub = /could not recognize this file/i.test(item.message) ? UNSUPPORTED_COPY : item.message;
    right = <button type="button" className="icon-btn icon-btn--sm icon-btn--plain" title="Remove" aria-label={`Remove ${item.file.name}`} onClick={() => onRemove(item.id)}><span className="ms" aria-hidden="true">delete</span></button>;
  } else {
    const preview = item.preview;
    const source = item.formatName ?? 'Statement';
    const newCount = preview?.newTxns.length ?? 0;
    const dupCount = preview?.duplicates.length ?? 0;
    if (preview && newCount === 0 && dupCount > 0) {
      icon = 'content_copy';
      tone = 'warn';
      sub = `${source} · all ${dupCount} transaction${dupCount === 1 ? ' is' : 's are'} already in your data`;
      right = item.status === 'saved'
        ? <span className="badge badge--accent"><span className="ms" aria-hidden="true">cloud_done</span>Saved</span>
        : <div className="fq__right">{remove}<span className="badge badge--review">All duplicates</span></div>;
    } else {
      tone = 'ok';
      const accounts = [...new Set((preview?.newTxns ?? []).map((txn) => txn.accountName).filter((name): name is string => Boolean(name)))];
      const parts = [source];
      if (accounts.length === 1 && accounts[0] !== source) parts.push(accounts[0]);
      parts.push(`${newCount} transaction${newCount === 1 ? '' : 's'}`);
      if (newCount > 0 && !item.cardMeta) parts.push(dateRange((preview?.newTxns ?? []).map((txn) => txn.isoDate), false));
      if (dupCount > 0) parts.push(`${dupCount} duplicate${dupCount === 1 ? '' : 's'}`);
      if (cardMatches > 0) parts.push(`${cardMatches} card bill${cardMatches === 1 ? '' : 's'} matched`);
      if (preview && preview.errors.length > 0) parts.push(`${preview.errors.length} row${preview.errors.length === 1 ? '' : 's'} skipped`);
      sub = parts.join(' · ');
      right = item.status === 'saved'
        ? <span className="badge badge--accent"><span className="ms" aria-hidden="true">cloud_done</span>Saved</span>
        : <div className="fq__right">{remove}<span className="badge badge--income"><span className="ms" aria-hidden="true">check</span>Ready</span></div>;
    }
  }

  return <div className="fq__row">
    <span className={`fq__ico${tone ? ` fq__ico--${tone}` : ''}`}><span className={`ms${item.status === 'reading' ? ' is-spinning' : ''}`} aria-hidden="true">{icon}</span></span>
    <div className="fq__main"><span className="t-label fq__name" title={item.file.name}>{item.file.name}</span><span className="t-caption muted">{sub}</span></div>
    {right}
    {extra && <div className="fq__extra">{extra}</div>}
  </div>;
}

function CategoryPicker({ anchor, index, current, suggested, payee, sameCount, onSave, onClose }: {
  anchor: DOMRect;
  index: CategoryIndex;
  current: CategoryChoice | null;
  suggested: CategoryChoice | null;
  payee: string;
  sameCount: number;
  onSave: (choice: CategoryChoice, alsoSame: boolean) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<CategoryChoice | null>(current);
  const [activeId, setActiveId] = useState<number | null>(current?.categoryId ?? index.categories[0]?.id ?? null);
  const [alsoSame, setAlsoSame] = useState(true);
  const [position, setPosition] = useState({ top: anchor.bottom + 4, left: anchor.left });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const left = Math.max(16, Math.min(anchor.left, window.innerWidth - width - 16));
    let top = anchor.bottom + 4;
    if (top + height > window.innerHeight - 16) top = Math.max(16, anchor.top - height - 4);
    setPosition({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Close only the picker, not the detail panel listening on window.
      event.stopPropagation();
      onClose();
    };
    const onScroll = (event: Event) => {
      if (ref.current && event.target instanceof Node && ref.current.contains(event.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const needle = query.trim().toLowerCase();
  const categories = index.categories.filter((category) => !needle
    || category.name.toLowerCase().includes(needle)
    || category.subcategories.some((sub) => sub.name.toLowerCase().includes(needle)));
  const active = categories.find((category) => category.id === activeId) ?? categories[0] ?? null;
  const subs = active
    ? active.subcategories.filter((sub) => !needle || active.name.toLowerCase().includes(needle) || sub.name.toLowerCase().includes(needle))
    : [];

  return <div
    ref={ref}
    className="pop imp-pop"
    role="dialog"
    aria-label={`Category for ${payee}`}
    style={{ top: position.top, left: position.left }}
  >
    <div className="pop__search">
      <label className="field__box field__box--sm"><span className="ms muted" aria-hidden="true">search</span>
        <input
          className="grow"
          autoFocus
          aria-label="Search categories"
          placeholder="Type to search…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && active) {
              event.preventDefault();
              const sub = needle && !active.name.toLowerCase().includes(needle) ? subs[0] : undefined;
              onSave({ categoryId: active.id, subcategoryId: sub?.id ?? null }, alsoSame && sameCount > 0);
            }
          }}
        />
        <span className="kbd">esc</span></label>
    </div>
    <div className="picker">
      <div className="picker__col"><span className="picker__label t-overline muted">CATEGORY</span><div className="pop__list">
        {categories.map((category) => <button
          type="button"
          key={category.id}
          className={`pop__item${active?.id === category.id ? ' is-hover' : ''}${pending?.categoryId === category.id ? ' is-selected' : ''}`}
          onMouseEnter={() => setActiveId(category.id)}
          onFocus={() => setActiveId(category.id)}
          onClick={() => { setActiveId(category.id); setPending({ categoryId: category.id, subcategoryId: null }); }}
          onDoubleClick={() => onSave({ categoryId: category.id, subcategoryId: null }, alsoSame && sameCount > 0)}
        >
          <span aria-hidden="true">{category.emoji ?? '🏷️'}</span><span className="grow">{category.name}</span>
          {category.subcategories.length > 0 && <span className="ms ms-16" aria-hidden="true">chevron_right</span>}
        </button>)}
        {categories.length === 0 && <div className="pop__item muted">No matching category</div>}
      </div></div>
      <div className="picker__col"><span className="picker__label t-overline muted">{active ? `${active.name.toUpperCase()} ›` : 'SUB-CATEGORY'}</span><div className="pop__list">
        {active && subs.map((sub) => <button
          type="button"
          key={sub.id}
          className={`pop__item${pending?.categoryId === active.id && pending.subcategoryId === sub.id ? ' is-selected' : ''}`}
          onClick={() => setPending({ categoryId: active.id, subcategoryId: sub.id })}
          onDoubleClick={() => onSave({ categoryId: active.id, subcategoryId: sub.id }, alsoSame && sameCount > 0)}
        >
          <span className="grow">{sub.name}</span>
          {suggested?.categoryId === active.id && suggested.subcategoryId === sub.id && <span className="t-caption muted">suggested</span>}
        </button>)}
        {active && <button
          type="button"
          className={`pop__item muted${pending?.categoryId === active.id && pending.subcategoryId == null ? ' is-selected' : ''}`}
          onClick={() => setPending({ categoryId: active.id, subcategoryId: null })}
        >No sub-category</button>}
      </div></div>
    </div>
    <div className="pop__foot">
      {sameCount > 0
        ? <label className="row gap-1 t-small">
          <input type="checkbox" checked={alsoSame} onChange={(event) => setAlsoSame(event.target.checked)} />
          <span className={`cb${alsoSame ? ' is-on' : ''}`} aria-hidden="true"><span className="ms">check</span></span>
          Also apply to {sameCount} other “{payee}” row{sameCount === 1 ? '' : 's'}
        </label>
        : <span className="t-caption muted grow">Pick a category, then save</span>}
      <button type="button" className="btn btn--sm btn--primary" disabled={!pending} onClick={() => pending && onSave(pending, alsoSame && sameCount > 0)}>Save</button>
    </div>
  </div>;
}
