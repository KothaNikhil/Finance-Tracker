import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  addLoanTransaction,
  addPerson,
  attachTransactionToLoan,
  createLoan,
  deleteLoan,
  getAllTransactions,
  getLists,
  setLoanClosed,
  updateLoan,
} from '@finance-tracker/core/db/repository';
import { loanAllocationsQuery, loansQuery, loanTxnsQuery, unattachedTxnsQuery } from '@finance-tracker/core/db/queries/lending';
import { getDb } from '@finance-tracker/core/db/runtime';
import { loanBalanceFromParts, loanPartOf, type LoanKind, type LoanPart } from '@finance-tracker/core/lending/roles';
import { inr, useDatabaseRevision } from './feature-utils';

type ViewMode = 'people' | 'loans';
type LoanFilter = 'open' | 'closed' | 'all';
const PARTS: LoanPart[] = ['principal', 'repayment', 'interest'];

interface LoanView {
  id: number;
  name: string;
  personId: number;
  personName: string;
  kind: LoanKind;
  closed: boolean;
  balance: ReturnType<typeof loanBalanceFromParts>;
  net: number;
  transactions: ReturnType<typeof getAllTransactions>;
  allocations: {
    id: number;
    loanId: number;
    txnId: number;
    part: string | null;
    paise: number;
    transferRole: string | null;
    isoDate: string;
    counterpartyName: string | null;
    remarks: string | null;
    direction: string;
    kind: string;
  }[];
}

interface NewLoanForm {
  personId: string;
  newPerson: string;
  name: string;
  kind: LoanKind;
  amount: string;
  date: string;
}

const emptyForm = (): NewLoanForm => ({
  personId: '',
  newPerson: '',
  name: '',
  kind: 'lent',
  amount: '',
  date: new Date().toISOString().slice(0, 10),
});

export function LendingPage() {
  const revision = useDatabaseRevision();
  const db = getDb();
  const [view, setView] = useState<ViewMode>('people');
  const [filter, setFilter] = useState<LoanFilter>('open');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState<NewLoanForm>(emptyForm);
  const [entryPart, setEntryPart] = useState<LoanPart>('repayment');
  const [entryAmount, setEntryAmount] = useState('');
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [entryNote, setEntryNote] = useState('');
  const [attachTxnId, setAttachTxnId] = useState('');
  const [attachPart, setAttachPart] = useState<LoanPart>('repayment');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loanRows = loansQuery(db).all();
  const txns = loanTxnsQuery(db).all();
  const allocations = loanAllocationsQuery(db).all();
  const lists = getLists();
  const peopleById = new Map(lists.people.map((person) => [person.id, person.name]));
  const views: LoanView[] = loanRows.map((loan) => {
    const loanTxns = txns.filter((txn) => txn.loanId === loan.id);
    const loanAllocs = allocations.filter((allocation) => allocation.loanId === loan.id);
    const balance = loanBalanceFromParts([
      ...loanTxns.map((txn) => ({ part: loanPartOf(txn.transferRole), paise: txn.paise })),
      ...loanAllocs.map((allocation) => ({
        part: (allocation.part as LoanPart | null) ?? loanPartOf(allocation.transferRole),
        paise: allocation.paise,
      })),
    ]);
    return {
      id: loan.id,
      name: loan.name,
      personId: loan.personId,
      personName: peopleById.get(loan.personId) ?? `Person #${loan.personId}`,
      kind: loan.kind as LoanKind,
      closed: loan.closed,
      balance,
      net: loan.kind === 'lent' ? balance.outstandingPaise : -balance.outstandingPaise,
      transactions: loanTxns,
      allocations: loanAllocs,
    };
  });
  const visibleLoans = views.filter((loan) => filter === 'all' || loan.closed === (filter === 'closed'));
  const selected = views.find((loan) => loan.id === selectedId) ?? null;
  const activeByPerson = new Map<number, LoanView[]>();
  for (const loan of views.filter((item) => !item.closed)) {
    const list = activeByPerson.get(loan.personId) ?? [];
    list.push(loan);
    activeByPerson.set(loan.personId, list);
  }
  const totalsByPerson = [...activeByPerson.entries()].map(([personId, personLoans]) => ({
    personId,
    name: peopleById.get(personId) ?? `Person #${personId}`,
    loans: personLoans,
    net: personLoans.reduce((sum, item) => sum + item.net, 0),
    interest: personLoans.reduce((sum, item) => sum + item.balance.interestPaise, 0),
  })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const owedToMe = totalsByPerson.reduce((sum, item) => sum + Math.max(item.net, 0), 0);
  const iOwe = totalsByPerson.reduce((sum, item) => sum + Math.max(-item.net, 0), 0);
  const thisYear = new Date().getFullYear();
  const thisYearTxns = getAllTransactions().filter((txn) => txn.isoDate.startsWith(String(thisYear)) && txn.transferRole != null);
  const interestThisYear = thisYearTxns.reduce((sum, txn) => sum + (loanPartOf(txn.transferRole) === 'interest' ? txn.paise : 0), 0);
  const unattached = useMemo(() => unattachedTxnsQuery(db, {}, 200).all(), [db, revision]);
  const peopleForList = [...new Set(views.map((loan) => loan.personId))].map((personId) => {
    const personLoans = views.filter((loan) => loan.personId === personId && (
      filter === 'all' || loan.closed === (filter === 'closed')
    ));
    return {
      personId,
      name: peopleById.get(personId) ?? `Person #${personId}`,
      loans: personLoans,
      net: personLoans.reduce((sum, loan) => sum + loan.net, 0),
      interest: personLoans.reduce((sum, loan) => sum + loan.balance.interestPaise, 0),
    };
  }).filter((person) => person.loans.length > 0).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  const showError = (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason));
  const create = () => {
    setError('');
    const amount = Math.round(Number(newForm.amount) * 100);
    if (!Number.isSafeInteger(amount) || amount <= 0) { setError('Enter an amount greater than zero.'); return; }
    if (!newForm.date) { setError('Choose a date.'); return; }
    setBusy(true);
    try {
      const personId = newForm.newPerson.trim()
        ? addPerson(newForm.newPerson)
        : Number(newForm.personId);
      if (!personId) throw new Error('Choose or add a person.');
      const id = createLoan({ name: newForm.name, personId, kind: newForm.kind });
      addLoanTransaction({ loanId: id, part: 'principal', paise: amount, isoDate: newForm.date });
      setSelectedId(id);
      setShowNew(false);
      setNewForm(emptyForm());
      setNotice('Loan created.');
    } catch (reason) {
      showError(reason);
    } finally {
      setBusy(false);
    }
  };
  const addEntry = () => {
    if (!selected) return;
    const amount = Math.round(Number(entryAmount) * 100);
    if (!Number.isSafeInteger(amount) || amount <= 0) { setError('Enter an amount greater than zero.'); return; }
    try {
      addLoanTransaction({ loanId: selected.id, part: entryPart, paise: amount, isoDate: entryDate, remarks: entryNote });
      setEntryAmount('');
      setEntryNote('');
      setError('');
      setNotice('Entry added.');
    } catch (reason) { showError(reason); }
  };
  const attach = () => {
    if (!selected || !attachTxnId) return;
    try {
      attachTransactionToLoan(Number(attachTxnId), selected.id, attachPart);
      setAttachTxnId('');
      setNotice('Transaction attached to the loan.');
      setError('');
    } catch (reason) { showError(reason); }
  };
  const edit = () => {
    if (!selected) return;
    const name = window.prompt('Loan name', selected.name);
    if (name == null) return;
    const kind = window.confirm('Choose OK for “Lent”, Cancel for “Borrowed”.') ? 'lent' : 'borrowed';
    try {
      updateLoan(selected.id, { name, kind });
      setError('');
      setNotice('Loan updated.');
    } catch (reason) { showError(reason); }
  };

  return (
    <section className="page-stack">
      <div className="page-heading"><div><p className="eyebrow">MONEY LENT</p><h1>Lending</h1><p className="muted">Money you lent or borrowed, with repayments and interest. Transfers stay out of spending.</p></div><button className="button button-primary" onClick={() => { setError(''); setShowNew(true); }}>＋ New loan</button></div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {notice && <p className="success-text" role="status">{notice}</p>}
      <div className="metric-grid metric-grid-four">
        <article className="metric-card"><span className="metric-label">Others owe you</span><strong>{inr(owedToMe)}</strong><span className="muted">{views.filter((item) => !item.closed && item.net > 0).length} open loans · {totalsByPerson.length} people</span></article>
        <article className="metric-card"><span className="metric-label">You owe</span><strong>{inr(iOwe)}</strong><span className="muted">{views.filter((item) => !item.closed && item.net < 0).length} open loans</span></article>
        <article className="metric-card"><span className="metric-label">Interest this year</span><strong>{inr(interestThisYear)}</strong><span className="muted">{thisYear}</span></article>
        <article className="metric-card"><span className="metric-label">Open loans</span><strong>{views.filter((item) => !item.closed).length}</strong><span className="muted">Across {activeByPerson.size} people</span></article>
      </div>
      <div className="row row-between wrap">
        <div className="segmented" role="tablist" aria-label="Lending view"><button className={view === 'people' ? 'active' : ''} onClick={() => setView('people')}>People</button><button className={view === 'loans' ? 'active' : ''} onClick={() => setView('loans')}>Loans</button></div>
        <label className="check-filter">Show<select value={filter} onChange={(event) => setFilter(event.target.value as LoanFilter)}><option value="open">Open</option><option value="closed">Closed</option><option value="all">All</option></select></label>
      </div>
      <div className="activity-layout">
        <div className="card table-card lending-list">
          {view === 'people' ? peopleForList.map((person) => <button className={`lending-row${person.loans.some((loan) => loan.id === selectedId) ? ' selected' : ''}`} key={person.personId} onClick={() => setSelectedId(person.loans[0]?.id ?? null)}>
            <span className="avatar">{person.name.slice(0, 1).toUpperCase()}</span><span className="transaction-copy"><strong>{person.name}</strong><span>{person.loans.length} open loan{person.loans.length === 1 ? '' : 's'} · interest {inr(person.interest)}</span></span><strong className={person.net < 0 ? 'amount-spend' : 'amount-income'}>{person.net < 0 ? 'You owe ' : ''}{inr(Math.abs(person.net))}</strong>
          </button>) : visibleLoans.map((loan) => <button className={`lending-row${selectedId === loan.id ? ' selected' : ''}`} key={loan.id} onClick={() => setSelectedId(loan.id)}>
            <span className="avatar">{loan.personName.slice(0, 1).toUpperCase()}</span><span className="transaction-copy"><strong>{loan.personName}{loan.name ? ` · ${loan.name}` : ''}</strong><span>{loan.kind === 'lent' ? 'Lent' : 'Borrowed'} · {loan.closed ? 'Closed' : 'Open'}</span></span><strong className={loan.net < 0 ? 'amount-spend' : 'amount-income'}>{loan.net < 0 ? 'You owe ' : ''}{inr(Math.abs(loan.net))}</strong>
          </button>)}
          {(view === 'loans' ? visibleLoans.length === 0 : peopleForList.length === 0) && <div className="empty-card"><span className="material-symbols-rounded empty-icon">handshake</span><h2>No loans yet</h2><p className="muted">Create a loan or attach a transaction from Activity.</p><button className="button button-primary" onClick={() => setShowNew(true)}>New loan</button></div>}
        </div>

        {selected && <aside className="detail-panel">
          <div className="detail-header"><div><p className="eyebrow">{selected.kind === 'lent' ? 'LENT' : 'BORROWED'} LOAN #{selected.id}</p><h2>{selected.personName}{selected.name ? ` · ${selected.name}` : ''}</h2></div><div className="row gap-1"><button className="icon-button" aria-label="Edit loan" onClick={edit}>✎</button><button className="icon-button" aria-label="Close loan details" onClick={() => setSelectedId(null)}>×</button></div></div>
          <div className="detail-body">
            <div className="loan-balance"><span>Outstanding</span><strong>{inr(Math.abs(selected.balance.outstandingPaise))}</strong><small>{inr(selected.balance.repaidPaise)} repaid of {inr(selected.balance.principalPaise)} principal</small></div>
            <div className="loan-stats"><div><span>Principal</span><strong>{inr(selected.balance.principalPaise)}</strong></div><div><span>Repaid</span><strong>{inr(selected.balance.repaidPaise)}</strong></div><div><span>Interest</span><strong>{inr(selected.balance.interestPaise)}</strong></div></div>
            <div className="row gap-2 wrap">
              <button className="button button-quiet" onClick={() => setLoanClosed(selected.id, !selected.closed)}>{selected.closed ? 'Reopen loan' : 'Close loan'}</button>
              <button className="button button-danger" onClick={() => { if (!window.confirm('Delete this loan? Its transactions will remain in Activity.')) return; deleteLoan(selected.id); setSelectedId(null); }}>Delete loan</button>
            </div>
            <details className="inline-editor" open>
              <summary>Add entry</summary>
              <label className="field-label">Part<select value={entryPart} onChange={(event) => setEntryPart(event.target.value as LoanPart)}>{PARTS.map((part) => <option key={part} value={part}>{part}</option>)}</select></label>
              <label className="field-label">Amount ₹<input inputMode="decimal" value={entryAmount} onChange={(event) => setEntryAmount(event.target.value)} /></label>
              <label className="field-label">Date<input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} /></label>
              <label className="field-label">Note<input value={entryNote} onChange={(event) => setEntryNote(event.target.value)} /></label>
              <button className="button button-primary" onClick={addEntry}>Add entry</button>
            </details>
            <details className="inline-editor">
              <summary>Attach existing transaction</summary>
              <select aria-label="Transaction to attach" value={attachTxnId} onChange={(event) => setAttachTxnId(event.target.value)}><option value="">Choose transaction…</option>{unattached.map((txn) => <option key={txn.id} value={txn.id}>{txn.isoDate} · {txn.counterpartyName || txn.rawDetails} · {inr(txn.paise)}</option>)}</select>
              <select aria-label="Loan part" value={attachPart} onChange={(event) => setAttachPart(event.target.value as LoanPart)}>{PARTS.map((part) => <option key={part} value={part}>{part}</option>)}</select>
              <button className="button button-quiet" disabled={!attachTxnId} onClick={attach}>Attach</button>
            </details>
            <div className="loan-history"><h3>History</h3>
              {selected.transactions.map((txn) => <div className="compact-row" key={`txn-${txn.id}`}><span>{loanPartOf(txn.transferRole) ?? 'entry'}</span><span className="history-copy"><strong>{txn.counterpartyName || txn.remarks || 'Manual entry'}</strong><small>{txn.isoDate} · {txn.accountName || (txn.source === 'manual' ? 'Manual' : txn.source)}</small></span><strong>{inr(txn.paise)}</strong><button className="text-button" onClick={() => window.location.assign(`/transactions?txn=${txn.id}`)}>Activity</button></div>)}
              {selected.allocations.map((allocation) => <div className="compact-row" key={`allocation-${allocation.id}`}><span>{(allocation.part as LoanPart | null) ?? loanPartOf(allocation.transferRole) ?? 'entry'}</span><span className="history-copy"><strong>{allocation.counterpartyName || allocation.remarks || 'Split payment'}</strong><small>{allocation.isoDate} · transaction #{allocation.txnId}</small></span><strong>{inr(allocation.paise)}</strong><Link className="text-button" to={`/transactions?txn=${allocation.txnId}`}>Activity</Link></div>)}
              {!selected.transactions.length && !selected.allocations.length && <p className="muted">No entries yet.</p>}
            </div>
          </div>
        </aside>}
      </div>

      {showNew && <div className="modal-backdrop" role="presentation"><section className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="new-loan-title">
        <div className="page-heading"><h2 id="new-loan-title">New loan</h2><button className="icon-button" aria-label="Close" onClick={() => setShowNew(false)}>×</button></div>
        <p className="muted">Create a loan and record its opening principal. You can attach a statement transaction later.</p>
        <div className="form-grid">
          <label className="field-label">Direction<select value={newForm.kind} onChange={(event) => setNewForm((current) => ({ ...current, kind: event.target.value as LoanKind }))}><option value="lent">I lent money</option><option value="borrowed">I borrowed money</option></select></label>
          <label className="field-label">Person<select value={newForm.personId} disabled={!!newForm.newPerson} onChange={(event) => setNewForm((current) => ({ ...current, personId: event.target.value }))}><option value="">Choose person…</option>{lists.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label className="field-label">Or add a person<input value={newForm.newPerson} onChange={(event) => setNewForm((current) => ({ ...current, newPerson: event.target.value, personId: '' }))} /></label>
          <label className="field-label">Loan name (optional)<input value={newForm.name} onChange={(event) => setNewForm((current) => ({ ...current, name: event.target.value }))} placeholder="What it’s for" /></label>
          <label className="field-label">Opening amount ₹<input inputMode="decimal" value={newForm.amount} onChange={(event) => setNewForm((current) => ({ ...current, amount: event.target.value }))} /></label>
          <label className="field-label">Date<input type="date" value={newForm.date} onChange={(event) => setNewForm((current) => ({ ...current, date: event.target.value }))} /></label>
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="dialog-actions"><button className="button button-quiet" onClick={() => setShowNew(false)}>Cancel</button><button className="button button-primary" disabled={busy} onClick={create}>{busy ? 'Adding…' : 'Add loan'}</button></div>
      </section></div>}
    </section>
  );
}
