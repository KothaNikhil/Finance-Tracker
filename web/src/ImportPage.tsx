import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { eq } from 'drizzle-orm';
import { dryRunImportPreview, runImport, type ImportPreview, type ImportPreviewRow } from '@finance-tracker/core/import/pipeline';
import { IMPORT_ADAPTERS, IMPORT_FORMATS } from '@finance-tracker/core/import/formats';
import { isEncryptedWorkbook, decryptWorkbook, WrongPasswordError } from '@finance-tracker/core/import/decrypt';
import { isEncryptedPdf, pdfFileKey } from '@finance-tracker/core/import/pdf/decrypt-pdf';
import { parsePdfToSheets } from '@finance-tracker/core/import/pdf/pdf-text';
import { readCardStatementMeta, type CardStatementMeta } from '@finance-tracker/core/import/adapters/axis-cc';
import { parseXlsxBytes } from '@finance-tracker/core/import/xlsx';
import type { SheetLike } from '@finance-tracker/core/import/types';
import {
  getCategoryIndex,
  getExistingDedupeKeys,
  getLearnedRules,
  reconcileDuplicatesFromImport,
  revertImport,
  saveImportBatch,
  setTransactionCategory,
} from '@finance-tracker/core/db/repository';
import { imports, transactions } from '@finance-tracker/core/db/schema';
import { getDb } from '@finance-tracker/core/db/runtime';
import { ilog, resetImportLog } from '@finance-tracker/core/import/import-log';
import { inr, useDatabaseRevision } from './feature-utils';

type FileStatus = 'reading' | 'locked' | 'ready' | 'error' | 'saved';
type PreviewTab = 'new' | 'review' | 'duplicates';

interface ImportFile {
  id: string;
  file: File;
  status: FileStatus;
  message: string;
  bytes?: Uint8Array;
  sheets?: SheetLike[];
  preview?: ImportPreview;
  cardMeta?: CardStatementMeta | null;
  categoryChoices: Record<string, number>;
}

interface RecentImport {
  id: number;
  batchKey: string | null;
  sourceLabel: string;
  importedAt: string;
  addedCount: number;
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function calculatePreviews(files: ImportFile[]): ImportFile[] {
  const keys = getExistingDedupeKeys();
  return files.map((item) => {
    if (!item.sheets || item.status === 'reading' || item.status === 'locked' || item.status === 'error' || item.status === 'saved') return item;
    try {
      const preview = runImport(item.sheets, IMPORT_ADAPTERS, keys);
      for (const txn of preview.newTxns) keys.add(txn.dedupeKey);
      return { ...item, preview, status: 'ready', message: '' };
    } catch (error) {
      return { ...item, preview: undefined, status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
  });
}

function getPreviewRows(item: ImportFile): ImportPreviewRow[] {
  if (!item.preview) return [];
  return dryRunImportPreview(item.preview, getCategoryIndex(), getLearnedRules()).rows;
}

function groupedImports(rows: RecentImport[]): { key: string; latestId: number; source: string; count: number; importedAt: string }[] {
  const groups = new Map<string, { key: string; latestId: number; labels: string[]; count: number; importedAt: string }>();
  for (const row of rows) {
    const key = row.batchKey ?? `single-${row.id}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, latestId: row.id, labels: [], count: 0, importedAt: row.importedAt };
      groups.set(key, group);
    }
    group.latestId = Math.max(group.latestId, row.id);
    group.labels.push(row.sourceLabel);
    group.count += row.addedCount;
    if (row.importedAt > group.importedAt) group.importedAt = row.importedAt;
  }
  return [...groups.values()].sort((a, b) => b.latestId - a.latestId).map((group) => ({
    key: group.key,
    latestId: group.latestId,
    source: group.labels.join(' · '),
    count: group.count,
    importedAt: group.importedAt,
  }));
}

export function ImportPage() {
  useDatabaseRevision();
  const db = getDb();
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState<PreviewTab>('new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ added: number; files: number; review: number } | null>(null);
  const [notice, setNotice] = useState('');
  const categoriesList = getCategoryIndex().categories;
  const historyRows = db.select().from(imports).all().sort((a, b) => b.id - a.id).slice(0, 60) as RecentImport[];
  const history = groupedImports(historyRows).slice(0, 8);
  const previewFiles = useMemo(() => calculatePreviews(files), [files]);
  const newRows = previewFiles.flatMap((item) => getPreviewRows(item).map((row) => ({ item, row })));
  const duplicateRows = previewFiles.flatMap((item) => (item.preview?.duplicates ?? []).map((txn) => ({ item, txn })));
  const visibleRows = tab === 'review'
    ? newRows.filter(({ item, row }) => row.needsReview && item.categoryChoices[row.txn.dedupeKey] == null)
    : tab === 'duplicates'
      ? []
      : newRows;
  const readyCount = previewFiles.filter((item) => item.status === 'ready').length;
  const pendingCount = previewFiles.filter((item) => item.status === 'reading' || item.status === 'locked').length;
  const totalNew = newRows.length;
  const reviewCount = newRows.filter(({ item, row }) => row.needsReview && item.categoryChoices[row.txn.dedupeKey] == null).length;
  const totalDuplicates = duplicateRows.length;
  const totalDebit = previewFiles.reduce((sum, item) => sum + (item.preview?.totalDebitPaise ?? 0), 0);
  const totalCredit = previewFiles.reduce((sum, item) => sum + (item.preview?.totalCreditPaise ?? 0), 0);
  const allDates = newRows.map(({ row }) => row.txn.isoDate).sort();

  const updateFile = (id: string, patch: Partial<ImportFile>) => {
    setFiles((current) => calculatePreviews(current.map((item) => item.id === id ? { ...item, ...patch } : item)));
  };
  const addFiles = (selected: FileList | File[]) => {
    const incoming = Array.from(selected);
    if (!incoming.length) return;
    resetImportLog();
    setSaved(null);
    setError('');
    const additions = incoming.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      status: 'reading' as const,
      message: '',
      categoryChoices: {},
    }));
    setFiles((current) => [...current.filter((item) => item.status !== 'saved'), ...additions]);
    additions.forEach((item) => void readFile(item.id, item.file));
  };

  const readFile = async (id: string, file: File, password?: string, cachedBytes?: Uint8Array) => {
    try {
      const bytes = cachedBytes ?? new Uint8Array(await file.arrayBuffer());
      ilog(`web import: read ${bytes.length} bytes`);
      let sheets: SheetLike[];
      if (isPdf(bytes)) {
        ilog('web import: PDF detected');
        let key: Uint8Array | undefined;
        if (isEncryptedPdf(bytes)) {
          if (password == null) {
            updateFile(id, { status: 'locked', message: 'Password protected · Axis Credit Card', bytes });
            return;
          }
          key = pdfFileKey(bytes, password);
        }
        sheets = parsePdfToSheets(bytes, key);
        ilog(`web import: parsed ${sheets.length} PDF sheet(s)`);
        const pdfLines = sheets.flatMap((sheet) => sheet.pdfLines ?? []);
        const cardMeta = readCardStatementMeta(pdfLines);
        setFiles((current) => calculatePreviews(current.map((item) => item.id === id
          ? { ...item, sheets, bytes: undefined, status: 'ready', message: '', cardMeta }
          : item)));
      } else {
        ilog('web import: spreadsheet detected');
        let workbookBytes = bytes;
        if (isEncryptedWorkbook(bytes)) {
          if (password == null) {
            updateFile(id, { status: 'locked', message: 'Password protected · enter the statement password', bytes });
            return;
          }
          workbookBytes = decryptWorkbook(bytes, password);
        }
        sheets = parseXlsxBytes(workbookBytes);
        ilog(`web import: parsed ${sheets.length} worksheet(s)`);
        setFiles((current) => calculatePreviews(current.map((item) => item.id === id
          ? { ...item, sheets, bytes: undefined, status: 'ready', message: '', cardMeta: null }
          : item)));
      }
    } catch (reason) {
      if (reason instanceof WrongPasswordError) {
        ilog('web import: password rejected');
        updateFile(id, { status: 'locked', message: 'That password did not open the file.' });
        return;
      }
      ilog('web import: file parsing failed');
      updateFile(id, { status: 'error', message: reason instanceof Error ? reason.message : String(reason) });
    }
  };

  const unlockFile = (item: ImportFile, password: string) => {
    if (!item.bytes || !password.trim()) return;
    setFiles((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'reading', message: '' } : entry));
    void readFile(item.id, item.file, password, item.bytes);
  };

  const save = async () => {
    if (busy || totalNew === 0) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const fresh = calculatePreviews(previewFiles);
      const ready = fresh.filter((item) => item.preview && item.status === 'ready');
      const batch = ready.map((item) => ({
        sourceLabel: item.file.name,
        txns: item.preview!.newTxns,
        cardMeta: item.cardMeta ?? null,
      }));
      const added = saveImportBatch(batch);
      const duplicates = ready.flatMap((item) => item.preview?.duplicates ?? []);
      const reconciled = reconcileDuplicatesFromImport(duplicates);
      for (const item of ready) {
        for (const [dedupeKey, categoryId] of Object.entries(item.categoryChoices)) {
          const transaction = db.select({ id: transactions.id }).from(transactions).where(eq(transactions.dedupeKey, dedupeKey)).get();
          if (transaction) {
            setTransactionCategory(transaction.id, categoryId, null);
          }
        }
      }
      const review = ready.reduce((sum, item) => sum + getPreviewRows(item).filter((row) =>
        row.needsReview && item.categoryChoices[row.txn.dedupeKey] == null,
      ).length, 0);
      setSaved({ added, files: ready.length, review: Math.max(0, review) });
      setFiles((current) => current.map((item) => item.preview ? { ...item, status: 'saved' } : item));
      setNotice(`Saved ${added} transactions. ${reconciled.updated} duplicates updated${reconciled.flagged ? `; ${reconciled.flagged} need review` : ''}.`);
      ilog(`web import: saved ${added} transaction(s) in one batch`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const revert = (importId: number) => {
    if (!window.confirm('Revert this import batch? All transactions added by every file in the batch will be removed.')) return;
    try {
      const count = revertImport(importId);
      setNotice(`Reverted the import and removed ${count} transactions.`);
      setSaved(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <section className="page-stack">
      <div className="page-heading"><div><p className="eyebrow">STATEMENTS</p><h1>Import statements</h1><p className="muted">Drop several files at once. They’re read in this browser; only transactions are saved to your Drive database.</p></div></div>
      {saved && <div className="success-callout" role="status"><span><strong>Saved {saved.added} transactions from {saved.files} files.</strong><small>{saved.review} still need a category.</small></span><Link className="button button-quiet" to="/transactions?review=1">Review {saved.review}</Link></div>}
      {notice && <p className="muted" role="status">{notice}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}

      <label className={`drop-zone${dragging ? ' dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}>
        <input ref={fileInput} type="file" multiple accept=".xlsx,.xls,.pdf" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ''; }} />
        <span className="drop-icon">⇧</span><strong>{dragging ? 'Drop statements to add them' : files.length ? 'Add more files' : 'Drop statements here'}</strong>
        <span className="muted">or choose files · .xlsx, .xls and password-protected PDF</span>
      </label>

      {files.length === 0 && <div className="card feature-card">
        <div className="card-heading"><h2>Supported statements</h2><span className="muted">The format is detected automatically</span></div>
        <div className="supported-grid">{IMPORT_FORMATS.map((format) => <div className="supported-item" key={format.id}><span>{format.icon}</span><div><strong>{format.name}</strong><small>{format.fileTypes}{format.locked ? ' · password required' : ''}</small></div></div>)}</div>
      </div>}

      {files.length > 0 && <div className="import-layout">
        <div className="page-stack">
          <div className="card feature-card">
            <div className="card-heading"><h2>Files</h2><span className="muted">{readyCount} of {files.length} ready</span></div>
            <div className="file-queue">
              {files.map((item) => <div className="file-queue-row" key={item.id}>
                <span className={`file-status file-${item.status}`}>{item.status === 'ready' || item.status === 'saved' ? '✓' : item.status === 'locked' ? '🔒' : item.status === 'error' ? '!' : '…'}</span>
                <div className="file-queue-main"><strong>{item.file.name}</strong><small>{item.status === 'ready' || item.status === 'saved' ? `${item.preview?.source ?? ''} · ${item.preview?.newTxns.length ?? 0} new · ${item.preview?.duplicates.length ?? 0} duplicates` : item.message || (item.status === 'reading' ? 'Reading statement…' : item.status)}</small></div>
                {item.status === 'locked' && <PasswordUnlock key={item.id} item={item} onUnlock={unlockFile} />}
                <button className="icon-button" aria-label={`Remove ${item.file.name}`} disabled={item.status === 'reading'} onClick={() => setFiles((current) => calculatePreviews(current.filter((file) => file.id !== item.id)))}>×</button>
              </div>)}
            </div>
          </div>

          <div className="card feature-card import-preview">
            <div className="card-heading"><div className="segmented" role="tablist" aria-label="Import preview">
              <button role="tab" aria-selected={tab === 'new'} className={tab === 'new' ? 'active' : ''} onClick={() => setTab('new')}>All new <span>{totalNew}</span></button>
              <button role="tab" aria-selected={tab === 'review'} className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>Needs review <span>{reviewCount}</span></button>
              <button role="tab" aria-selected={tab === 'duplicates'} className={tab === 'duplicates' ? 'active' : ''} onClick={() => setTab('duplicates')}>Duplicates <span>{totalDuplicates}</span></button>
            </div><span className="muted">Change a category before saving</span></div>
            {tab === 'duplicates' ? <div className="preview-table-wrap"><table className="preview-table"><thead><tr><th>Date</th><th>Payee</th><th>From file</th><th>Amount</th><th>Status</th></tr></thead><tbody>
              {duplicateRows.slice(0, 250).map(({ item, txn }, index) => <tr key={`${item.id}-${index}`} className="duplicate-row"><td>{txn.isoDate}</td><td>{txn.counterpartyName || txn.rawDetails}</td><td>{item.file.name}</td><td>{inr(txn.direction === 'in' ? txn.paise : -txn.paise)}</td><td>Already imported</td></tr>)}
            </tbody></table>{duplicateRows.length > 250 && <p className="muted">Showing 250 of {duplicateRows.length} duplicates.</p>}</div> : <div className="preview-table-wrap"><table className="preview-table"><thead><tr><th>Date</th><th>Payee</th><th>Category</th><th>From file</th><th>Amount</th></tr></thead><tbody>
              {visibleRows.slice(0, 250).map(({ item, row }) => <tr key={`${item.id}-${row.txn.dedupeKey}`}><td>{row.txn.isoDate}</td><td>{row.txn.counterpartyName || row.txn.rawDetails}</td><td><select aria-label={`Category for ${row.txn.counterpartyName ?? row.txn.rawDetails}`} value={item.categoryChoices[row.txn.dedupeKey] ?? row.categoryId ?? ''} onChange={(event) => {
                if (!event.target.value) return;
                updateFile(item.id, { categoryChoices: { ...item.categoryChoices, [row.txn.dedupeKey]: Number(event.target.value) } });
              }}><option value="">Pick a category</option>{categoriesList.map((category) => <option key={category.id} value={category.id}>{category.emoji ? `${category.emoji} ` : ''}{category.name}</option>)}</select></td><td>{item.file.name}</td><td className={row.txn.direction === 'in' ? 'amount-income' : ''}>{row.txn.direction === 'in' ? '+' : '−'}{inr(row.txn.paise)}</td></tr>)}
            </tbody></table>{visibleRows.length === 0 && <p className="muted preview-empty">{tab === 'review' ? 'No transactions need review.' : 'No new transactions to preview.'}</p>}{visibleRows.length > 250 && <p className="muted">Showing 250 of {visibleRows.length} transactions.</p>}</div>}
          </div>
        </div>
        <aside className="card feature-card import-summary">
          <p className="eyebrow">SUMMARY</p>
          <div className="summary-row"><span>Files ready</span><strong>{readyCount} of {files.length}</strong></div>
          {pendingCount > 0 && <p className="muted">Waiting for {pendingCount} file{pendingCount === 1 ? '' : 's'}. You can save the files that are ready now.</p>}
          <div className="summary-row"><span>New transactions</span><strong>{totalNew}</strong></div>
          <div className="summary-row"><span>Need a category</span><strong>{reviewCount}</strong></div>
          <div className="summary-row"><span>Already imported</span><strong>{totalDuplicates} · skipped</strong></div>
          <div className="summary-divider" />
          <div className="summary-row"><span>Money out</span><strong>{inr(totalDebit)}</strong></div>
          <div className="summary-row"><span>Money in</span><strong>{inr(totalCredit)}</strong></div>
          <div className="summary-row"><span>Date range</span><strong>{allDates.length ? `${allDates[0]} – ${allDates[allDates.length - 1]}` : '—'}</strong></div>
          <button className="button button-primary button-wide" disabled={busy || totalNew === 0} onClick={() => void save()}>{busy ? 'Saving…' : `Save ${totalNew} transactions`}</button>
          <p className="muted small">All ready files save as one reversible import batch. Locked or unsupported files stay in the list.</p>
        </aside>
      </div>}

      <div className="card feature-card">
        <div className="card-heading"><h2>Recent imports</h2><span className="muted">Revert removes every file in the selected batch.</span></div>
        {history.length ? history.map((item) => <div className="compact-row import-history-row" key={item.key}><span className="badge">#{item.latestId}</span><span className="history-copy"><strong>{item.source}</strong><small>{new Date(item.importedAt).toLocaleString()} · {item.count} transactions</small></span><button className="button button-quiet" onClick={() => revert(item.latestId)}>Revert</button></div>) : <p className="muted">No imports yet.</p>}
      </div>
    </section>
  );
}

function PasswordUnlock({ item, onUnlock }: { item: ImportFile; onUnlock: (item: ImportFile, password: string) => void }) {
  const [password, setPassword] = useState('');
  return <form className="unlock-form" onSubmit={(event) => { event.preventDefault(); onUnlock(item, password); }}>
    <input type="password" autoComplete="off" aria-label={`Password for ${item.file.name}`} placeholder="Statement password" value={password} onChange={(event) => setPassword(event.target.value)} />
    <button className="button button-quiet" disabled={!password.trim()}>Unlock</button>
    {item.message.includes('did not open') && <small className="error-text">{item.message}</small>}
  </form>;
}
