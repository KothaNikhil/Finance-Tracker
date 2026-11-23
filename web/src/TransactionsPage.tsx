import { asc, eq } from 'drizzle-orm';
import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  acceptTransactionReview,
  acceptAllReviews,
  attachTransactionToLoan,
  clearTransactionCategory,
  deleteTransaction,
  detachTransactionFromLoan,
  getAllTransactions,
  linkTxnToCardStatement,
  setTransactionCategory,
  setTransactionNote,
  setTransactionPaymentMode,
  setTransactionPerson,
  setTransactionRefund,
  setTransactionSelfTransfer,
  splitTransactionAcrossLoans,
  unlinkCardStatement,
} from '@finance-tracker/core/db/repository';
import { cardStatementsQuery, matchingCardStatementsQuery } from '@finance-tracker/core/db/queries/cards';
import { loansQuery } from '@finance-tracker/core/db/queries/lending';
import { categories, loanAllocations, paymentModes, people, subcategories } from '@finance-tracker/core/db/schema';
import { type LoanPart } from '@finance-tracker/core/lending/roles';
import { getDb } from '@finance-tracker/core/db/runtime';
import { formatINR } from '@finance-tracker/core/domain/money';
import { inr, useDatabaseRevision } from './feature-utils';

type DirectionFilter = 'all' | 'in' | 'out' | 'self';

interface SplitDraft {
  loanId: string;
  part: LoanPart;
  amount: string;
}

const PARTS: LoanPart[] = ['principal', 'repayment', 'interest'];

export function TransactionsPage({ search }: { search: string }) {
  const revision = useDatabaseRevision();
  const [params, setParams] = useSearchParams();
  const db = getDb();
  const rows = useMemo(() => getAllTransactions().sort((a, b) => b.isoDate.localeCompare(a.isoDate) || b.id - a.id), [revision]);
  const categoryRows = useMemo(
    () => db.select().from(categories).where(eq(categories.isArchived, false)).orderBy(asc(categories.sortOrder), asc(categories.id)).all(),
    [revision],
  );
  const activeCategories = categoryRows.filter((category) => !category.isArchived);
  const subRows = useMemo(() => db.select().from(subcategories).orderBy(asc(subcategories.sortOrder), asc(subcategories.id)).all(), [db, revision]);
  const paymentModeRows = useMemo(() => db.select().from(paymentModes).where(eq(paymentModes.isArchived, false)).orderBy(asc(paymentModes.sortOrder), asc(paymentModes.id)).all(), [db, revision]);
  const peopleRows = useMemo(() => db.select().from(people).where(eq(people.isArchived, false)).orderBy(asc(people.sortOrder), asc(people.id)).all(), [db, revision]);
  const loanLinkedIds = useMemo(() => new Set(db.select({ txnId: loanAllocations.txnId }).from(loanAllocations).all().map((row) => row.txnId)), [db, revision]);
  const loans = useMemo(() => loansQuery(db).all(), [db, revision]);
  const statements = useMemo(() => cardStatementsQuery(db).all(), [db, revision]);
  const [reviewOnly, setReviewOnly] = useState(params.get('review') === '1');
  const [categoryFilter, setCategoryFilter] = useState(params.get('category') ?? '');
  const [accountFilter, setAccountFilter] = useState(params.get('account') ?? '');
  const [personFilter, setPersonFilter] = useState(params.get('person') ?? '');
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [minimum, setMinimum] = useState('');
  const [maximum, setMaximum] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkPerson, setBulkPerson] = useState('');
  const [tab, setTab] = useState<'details' | 'statement'>('details');
  const [linkStatementId, setLinkStatementId] = useState('');
  const [attachLoanId, setAttachLoanId] = useState('');
  const [attachPart, setAttachPart] = useState<LoanPart>('principal');
  const [splitRows, setSplitRows] = useState<SplitDraft[]>([{ loanId: '', part: 'principal', amount: '' }]);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const term = search.trim().toLowerCase();
  const accountNames = useMemo(
    () => [...new Set(rows.flatMap((txn) => txn.accountName ? [txn.accountName] : []))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const filtered = useMemo(
    () => rows.filter((txn) => {
      const fullText = `${txn.counterpartyName ?? ''} ${txn.counterpartyVpa ?? ''} ${txn.rawDetails} ${txn.note ?? ''} ${txn.remarks ?? ''}`.toLowerCase();
      const minValue = Number(minimum);
      const maxValue = Number(maximum);
      const minPaise = minimum === '' || !Number.isFinite(minValue) ? null : minValue * 100;
      const maxPaise = maximum === '' || !Number.isFinite(maxValue) ? null : maxValue * 100;
      return (!term || fullText.includes(term))
        && (!reviewOnly || txn.needsReview)
        && (!categoryFilter || (categoryFilter === 'uncategorized' ? txn.categoryId == null : txn.categoryId === Number(categoryFilter)))
        && (!accountFilter || txn.accountName === accountFilter)
        && (!personFilter || (personFilter === 'unset' ? txn.personId == null : txn.personId === Number(personFilter)))
        && (direction === 'all' || txn.direction === direction)
        && (!from || txn.isoDate >= from)
        && (!to || txn.isoDate <= to)
        && (minPaise == null || txn.paise >= minPaise)
        && (maxPaise == null || txn.paise <= maxPaise);
    }),
    [rows, term, reviewOnly, categoryFilter, accountFilter, personFilter, direction, from, to, minimum, maximum],
  );

  const selectedId = Number(params.get('txn')) || null;
  const selected = rows.find((txn) => txn.id === selectedId) ?? null;
  const categoryMap = useMemo(() => new Map(activeCategories.map((item) => [item.id, item])), [categoryRows, revision]);
  const currentSubcategories = selected?.categoryId == null
    ? []
    : subRows.filter((item) => item.categoryId === selected.categoryId && !item.isArchived);
  const matchingStatements = selected
    ? matchingCardStatementsQuery(db, selected.paise).all()
    : [];
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 68,
    overscan: 10,
  });

  const selectTxn = (id: number) => {
    setError('');
    setTab('details');
    setLinkStatementId('');
    setParams((current) => {
      current.set('txn', String(id));
      return current;
    });
  };
  const closeDetail = () => setParams((current) => {
    current.delete('txn');
    return current;
  });
  const toggleSelected = (id: number) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleAll = () => setSelectedIds((current) => (
    filtered.length > 0 && filtered.every((txn) => current.has(txn.id))
      ? new Set()
      : new Set(filtered.map((txn) => txn.id))
  ));
  const applyBulkCategory = () => {
    if (!bulkCategory) return;
    const id = Number(bulkCategory);
    for (const txnId of selectedIds) setTransactionCategory(txnId, id, null);
    setSelectedIds(new Set());
  };
  const applyBulkPerson = () => {
    if (!bulkPerson) return;
    const selected = rows.filter((txn) => selectedIds.has(txn.id));
    if (selected.some((txn) => txn.loanId != null || txn.transferRole != null || loanLinkedIds.has(txn.id))) {
      setError('Remove loan-linked transactions from the selection before changing “For”.');
      return;
    }
    run(() => {
      for (const txn of selected) setTransactionPerson(txn.id, Number(bulkPerson));
      setSelectedIds(new Set());
    });
  };
  const run = (action: () => void) => {
    setError('');
    try {
      action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const updateSplit = (index: number, patch: Partial<SplitDraft>) => {
    setSplitRows((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));
  };
  const saveSplit = () => {
    if (!selected) return;
    run(() => {
      const slices = splitRows.map((row) => ({
        loanId: Number(row.loanId),
        part: row.part,
        paise: Math.round(Number(row.amount) * 100),
      }));
      splitTransactionAcrossLoans(selected.id, slices);
    });
  };

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div><p className="eyebrow">YOUR MONEY</p><h1>Activity</h1><p className="muted">{filtered.length.toLocaleString()} of {rows.length.toLocaleString()} transactions</p></div>
        <div className="row gap-2 wrap">
          <label className="check-filter"><input type="checkbox" checked={reviewOnly} onChange={(event) => {
            setReviewOnly(event.target.checked);
            setParams((current) => {
              if (event.target.checked) current.set('review', '1');
              else current.delete('review');
              return current;
            });
          }} /> Needs review</label>
          <button className="button button-quiet" onClick={() => run(() => { const count = acceptAllReviews(); window.alert(`Accepted ${count} review suggestions.`); })}>Accept all reviews</button>
        </div>
      </div>

      <div className="filter-grid card">
        <label className="field-label">From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="field-label">To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label className="field-label">Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All categories</option><option value="uncategorized">Uncategorized</option>{activeCategories.map((item) => <option key={item.id} value={item.id}>{item.emoji ? `${item.emoji} ` : ''}{item.name}</option>)}</select></label>
        <label className="field-label">Account<select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}><option value="">All accounts</option>{accountNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label className="field-label">For<select value={personFilter} onChange={(event) => setPersonFilter(event.target.value)}><option value="">Everyone</option><option value="unset">Not set</option>{peopleRows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field-label">Direction<select value={direction} onChange={(event) => setDirection(event.target.value as DirectionFilter)}><option value="all">All</option><option value="out">Spent</option><option value="in">Received</option><option value="self">Transfers</option></select></label>
        <label className="field-label">Min ₹<input inputMode="decimal" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></label>
        <label className="field-label">Max ₹<input inputMode="decimal" value={maximum} onChange={(event) => setMaximum(event.target.value)} /></label>
        <button className="button button-quiet filter-reset" onClick={() => { setFrom(''); setTo(''); setCategoryFilter(''); setAccountFilter(''); setPersonFilter(''); setDirection('all'); setMinimum(''); setMaximum(''); setReviewOnly(false); }}>Clear filters</button>
      </div>

      {selectedIds.size > 0 && (
        <div className="bulk-toolbar card" role="region" aria-label="Bulk actions">
          <strong>{selectedIds.size} selected</strong>
          <select aria-label="Set category for selected transactions" value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)}><option value="">Choose category…</option>{activeCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <button className="button button-quiet" disabled={!bulkCategory} onClick={applyBulkCategory}>Set category</button>
          {peopleRows.length > 0 && <><select aria-label="Set For on selected transactions" value={bulkPerson} onChange={(event) => setBulkPerson(event.target.value)}><option value="">Set For…</option>{peopleRows.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select><button className="button button-quiet" disabled={!bulkPerson} onClick={applyBulkPerson}>Set For</button></>}
          <button className="button button-quiet" onClick={() => run(() => { for (const id of selectedIds) acceptTransactionReview(id); setSelectedIds(new Set()); })}>Mark reviewed</button>
          <button className="button button-danger" onClick={() => { if (!window.confirm(`Delete ${selectedIds.size} transactions?`)) return; run(() => { for (const id of selectedIds) deleteTransaction(id); setSelectedIds(new Set()); }); }}>Delete selected</button>
          <button className="text-button" onClick={() => setSelectedIds(new Set())}>Cancel</button>
        </div>
      )}

      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="activity-layout">
        <div className="card table-card">
          <div className="list-toolbar"><label className="check-filter"><input type="checkbox" checked={filtered.length > 0 && filtered.every((txn) => selectedIds.has(txn.id))} onChange={toggleAll} /> Select all</label><span className="muted">Search: {term || 'all activity'}</span></div>
          {filtered.length === 0 ? (
            <div className="empty-card"><span className="material-symbols-rounded empty-icon">receipt_long</span><h2>No transactions found</h2><p className="muted">Try another search or import a statement.</p><Link className="button button-primary" to="/import">Import statements</Link></div>
          ) : (
            <div className="transaction-list virtual-list" ref={listRef} role="list" aria-label="Transactions">
              <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const txn = filtered[virtualRow.index];
                  const category = txn.categoryId == null ? null : categoryMap.get(txn.categoryId);
                  const label = txn.counterpartyName || txn.rawDetails || 'Transaction';
                  return (
                    <div className="txn-virtual-row" key={txn.id} role="listitem" style={{ height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}>
                      <input type="checkbox" aria-label={`Select ${label}`} checked={selectedIds.has(txn.id)} onChange={() => toggleSelected(txn.id)} />
                      <button className={`transaction-row${selectedId === txn.id ? ' selected' : ''}`} onClick={() => selectTxn(txn.id)}>
                        <span className="category-avatar">{category?.emoji || '•'}</span>
                        <span className="transaction-copy"><strong>{label}</strong><span>{txn.isoDate} · {category?.name ?? 'Uncategorized'}{txn.needsReview ? ' · Needs review' : ''}</span></span>
                        <strong className={txn.direction === 'in' ? 'amount-income' : ''}>{txn.direction === 'in' ? '+' : txn.direction === 'self' ? '↔ ' : '−'}{formatINR(txn.paise)}</strong>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {selected && (
          <aside className="detail-panel" aria-label="Transaction details">
            <div className="detail-header"><div><p className="eyebrow">TRANSACTION #{selected.id}</p><h2>{selected.counterpartyName || selected.rawDetails || 'Transaction'}</h2></div><button aria-label="Close details" className="icon-button" onClick={closeDetail}><span className="material-symbols-rounded">close</span></button></div>
            <div className="detail-tabs" role="tablist" aria-label="Transaction detail sections">
              <button role="tab" aria-selected={tab === 'details'} onClick={() => setTab('details')}>Details</button>
              <button role="tab" aria-selected={tab === 'statement'} onClick={() => setTab('statement')}>Statement & links</button>
            </div>
            {tab === 'details' ? (
              <div className="detail-body">
                <div><span className="detail-label">Amount</span><strong>{selected.direction === 'in' ? '+' : selected.direction === 'self' ? '↔ ' : '−'}{formatINR(selected.paise)}</strong></div>
                <div><span className="detail-label">Date · account</span><strong>{selected.isoDate}{selected.accountName ? ` · ${selected.accountName}` : ''}</strong></div>
                <label className="field-label">Category<select value={selected.categoryId ?? ''} onChange={(event) => {
                  const id = Number(event.target.value);
                  if (id) run(() => setTransactionCategory(selected.id, id, null));
                  else run(() => clearTransactionCategory(selected.id));
                }}><option value="">Uncategorized</option>{activeCategories.map((item) => <option key={item.id} value={item.id}>{item.emoji ? `${item.emoji} ` : ''}{item.name}</option>)}</select></label>
                {selected.categoryId != null && currentSubcategories.length > 0 && <label className="field-label">Sub-category<select value={selected.subcategoryId ?? ''} onChange={(event) => run(() => setTransactionCategory(selected.id, selected.categoryId!, event.target.value ? Number(event.target.value) : null))}><option value="">No sub-category</option>{currentSubcategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
                <label className="field-label">For<select aria-label="Transaction person" disabled={selected.loanId != null || selected.transferRole != null || loanLinkedIds.has(selected.id)} value={selected.personId ?? ''} onChange={(event) => run(() => setTransactionPerson(selected.id, event.target.value ? Number(event.target.value) : null))}><option value="">Not set</option>{peopleRows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label className="field-label">Payment mode<select aria-label="Transaction payment mode" value={selected.paymentModeId ?? ''} onChange={(event) => run(() => setTransactionPaymentMode(selected.id, event.target.value ? Number(event.target.value) : null))}><option value="">Not set</option>{paymentModeRows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label className="field-label">Note<textarea key={`${selected.id}-${selected.note ?? ''}`} defaultValue={selected.note ?? ''} placeholder="Add a note" onBlur={(event) => run(() => setTransactionNote(selected.id, event.currentTarget.value))} /></label>
                {selected.direction === 'in' && <label className="check-filter"><input type="checkbox" checked={selected.isRefund} onChange={(event) => run(() => setTransactionRefund(selected.id, event.target.checked))} /> Refund / cashback</label>}
                {selected.transferRole == null && selected.loanId == null && selected.linkedImportId == null && selected.direction !== 'self' && <label className="check-filter"><input type="checkbox" checked={false} onChange={(event) => run(() => setTransactionSelfTransfer(selected.id, event.target.checked))} /> Self-transfer</label>}
                {selected.direction === 'self' && selected.transferRole == null && <label className="check-filter"><input type="checkbox" checked onChange={(event) => run(() => setTransactionSelfTransfer(selected.id, !event.target.checked))} /> Self-transfer</label>}
                {selected.needsReview && <button className="button button-primary" onClick={() => run(() => acceptTransactionReview(selected.id))}>Accept suggestion</button>}
                {selected.loanId != null && <button className="button button-quiet" onClick={() => run(() => detachTransactionFromLoan(selected.id))}>Detach from loan</button>}
                <details className="inline-editor">
                  <summary>Attach to a loan</summary>
                  <select value={attachLoanId} onChange={(event) => setAttachLoanId(event.target.value)}><option value="">Choose loan…</option>{loans.map((loan) => <option key={loan.id} value={loan.id}>{loan.name || `Loan #${loan.id}`}</option>)}</select>
                  <select value={attachPart} onChange={(event) => setAttachPart(event.target.value as LoanPart)}>{PARTS.map((part) => <option key={part} value={part}>{part}</option>)}</select>
                  <button className="button button-quiet" disabled={!attachLoanId} onClick={() => run(() => { attachTransactionToLoan(selected.id, Number(attachLoanId), attachPart); setAttachLoanId(''); })}>Attach</button>
                </details>
                <details className="inline-editor">
                  <summary>Split across loans</summary>
                  {splitRows.map((row, index) => <div className="split-editor-row" key={index}>
                    <select aria-label="Loan" value={row.loanId} onChange={(event) => updateSplit(index, { loanId: event.target.value })}><option value="">Choose loan…</option>{loans.map((loan) => <option key={loan.id} value={loan.id}>{loan.name || `Loan #${loan.id}`}</option>)}</select>
                    <select aria-label="Split part" value={row.part} onChange={(event) => updateSplit(index, { part: event.target.value as LoanPart })}>{PARTS.map((part) => <option key={part} value={part}>{part}</option>)}</select>
                    <input aria-label="Split amount in rupees" inputMode="decimal" placeholder="₹ amount" value={row.amount} onChange={(event) => updateSplit(index, { amount: event.target.value })} />
                    <button className="icon-button" aria-label="Remove split row" onClick={() => setSplitRows((current) => current.filter((_, i) => i !== index))}>×</button>
                  </div>)}
                  <div className="row gap-2"><button className="button button-quiet" onClick={() => setSplitRows((current) => [...current, { loanId: '', part: 'principal', amount: '' }])}>Add slice</button><button className="button button-primary" onClick={saveSplit}>Save split</button></div>
                </details>
                <button className="button button-danger" onClick={() => { if (window.confirm('Delete this transaction?')) run(() => { deleteTransaction(selected.id); closeDetail(); }); }}>Delete transaction</button>
              </div>
            ) : (
              <div className="detail-body">
                <div><span className="detail-label">Imported details</span><strong>{selected.rawDetails || '—'}</strong></div>
                <div><span className="detail-label">Counterparty / account</span><strong>{selected.counterpartyVpa || selected.accountName || '—'}</strong></div>
                <div><span className="detail-label">Reference</span><strong>{selected.sourceRef || selected.orderId || '—'}</strong></div>
                <div><span className="detail-label">Imported remarks</span><strong>{selected.remarks || '—'}</strong></div>
                <div><span className="detail-label">Source</span><strong>{selected.source}{selected.importId ? ` · import #${selected.importId}` : ''}</strong></div>
                {selected.linkedImportId != null ? (
                  <>
                    <div><span className="detail-label">Linked card statement</span><strong>{statements.find((item) => item.id === selected.linkedImportId)?.sourceLabel ?? `Import #${selected.linkedImportId}`}</strong></div>
                    <button className="button button-quiet" onClick={() => run(() => unlinkCardStatement(selected.id))}>Unlink card bill</button>
                  </>
                ) : selected.direction === 'out' && selected.kind === 'billpay' ? (
                  <div className="inline-editor">
                    <strong>Link a card bill payment</strong>
                    <p className="muted">Matching statements are suggested by exact payment amount.</p>
                    <select value={linkStatementId} onChange={(event) => setLinkStatementId(event.target.value)}><option value="">Choose statement…</option>{matchingStatements.map((item) => <option key={item.id} value={item.id}>{item.sourceLabel} · {item.statementMonth ?? 'month unknown'} · {inr(item.totalDuePaise ?? 0)}</option>)}{statements.filter((item) => !matchingStatements.some((match) => match.id === item.id)).map((item) => <option key={item.id} value={item.id}>{item.sourceLabel} · {item.statementMonth ?? 'month unknown'}</option>)}</select>
                    <button className="button button-quiet" disabled={!linkStatementId} onClick={() => run(() => { linkTxnToCardStatement(selected.id, Number(linkStatementId)); setLinkStatementId(''); })}>Link statement</button>
                  </div>
                ) : null}
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
