import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { eq, inArray } from 'drizzle-orm';
import {
  addLoanTransaction,
  addPerson,
  attachTransactionToLoan,
  createLoan,
  deleteLoan,
  deleteLoanTransaction,
  detachTransactionFromLoan,
  getEditableLoanTransaction,
  getLists,
  setLoanClosed,
  splitTransactionAcrossLoans,
  updateLoan,
  updateLoanTransaction,
} from '@finance-tracker/core/db/repository';
import { loanAllocationsQuery, loansQuery, loanTxnsQuery, unattachedTxnsQuery } from '@finance-tracker/core/db/queries/lending';
import { getDb } from '@finance-tracker/core/db/runtime';
import { people as peopleTable, transactions as transactionsTable } from '@finance-tracker/core/db/schema';
import {
  loanBalanceFromParts,
  loanPartOf,
  roleDirection,
  roleForLoanPart,
  type LoanBalance,
  type LoanKind,
  type LoanPart,
} from '@finance-tracker/core/lending/roles';
import { useDatabaseRevision } from './feature-utils';
import { DetailPanel, Icon, TopActions, formatInr, initials, longDate, shortDate } from './shell';
import './LendingPage.css';

type TxnRow = typeof transactionsTable.$inferSelect;
type ViewMode = 'people' | 'loans';
type StatusFilter = 'open' | 'closed' | 'all';
type KindFilter = 'all' | 'lent' | 'borrowed';
type SortKey = 'outstanding' | 'recent' | 'name';

const PARTS: { part: LoanPart; label: string }[] = [
  { part: 'principal', label: 'Principal' },
  { part: 'repayment', label: 'Repayment' },
  { part: 'interest', label: 'Interest' },
];

interface Entry {
  key: string;
  txnId: number;
  part: LoanPart | null;
  paise: number;
  isoDate: string;
  split: boolean;
  manual: boolean;
  account: string | null;
  remarks: string | null;
}

interface LoanView {
  id: number;
  name: string;
  personId: number;
  personName: string;
  kind: LoanKind;
  closed: boolean;
  updatedAt: string;
  balance: LoanBalance;
  /** Signed outstanding: positive = they owe you, negative = you owe them. */
  net: number;
  entries: Entry[];
  startDate: string;
  lastDate: string;
}

interface Slice {
  key: number;
  loanId: number;
  part: LoanPart;
  amount: string;
}

type DialogState =
  | { type: 'new' }
  | { type: 'edit-loan' }
  | { type: 'entry'; txnId?: number }
  | { type: 'attach'; txnId?: number }
  | { type: 'confirm'; title: string; body: string; confirmLabel: string; action: () => void };

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
/** Whole rupees without paise (₹20,000), paise only when there are any. */
const amt = (paise: number) => formatInr(paise, { noPaise: paise % 100 === 0 });
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const parseAmount = (value: string) => Math.round(Number(value.replace(/[,\s₹]/g, '')) * 100);
const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));
const activateOnKey = (fn: () => void) => (event: ReactKeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fn();
  }
};

function partLabel(kind: LoanKind, part: LoanPart | null): string {
  if (part === 'interest') return kind === 'lent' ? 'Interest received' : 'Interest paid';
  if (part === 'repayment') return 'Repayment';
  if (part === 'principal') return 'Principal';
  return 'Entry';
}

function partIcon(kind: LoanKind, part: LoanPart | null): { name: string; tone: string } {
  if (part === 'interest') return { name: 'percent', tone: 'c-accent' };
  if (part == null) return { name: 'swap_horiz', tone: 'muted' };
  const moneyIn = roleDirection(roleForLoanPart(kind, part)) === 'in';
  return moneyIn ? { name: 'call_received', tone: 'c-income' } : { name: 'call_made', tone: 'c-spend' };
}

function entryAmount(kind: LoanKind, part: LoanPart | null, paise: number): { text: string; tone: string } {
  const moneyIn = part != null && roleDirection(roleForLoanPart(kind, part)) === 'in';
  return {
    text: formatInr(moneyIn ? paise : -paise, { sign: true }),
    tone: moneyIn ? 'c-income' : part === 'principal' ? '' : 'c-spend',
  };
}

function activityVerb(kind: LoanKind, part: LoanPart | null): string {
  if (part === 'principal') return kind === 'lent' ? 'lent' : 'borrowed';
  if (part === 'repayment') return 'repayment';
  if (part === 'interest') return 'interest';
  return 'entry';
}

function txnName(txn: TxnRow): string {
  return txn.counterpartyName || txn.remarks || txn.rawDetails || 'Transaction';
}

function signedTxn(txn: Pick<TxnRow, 'direction' | 'paise'>): string {
  if (txn.direction === 'out') return `−${amt(txn.paise)}`;
  if (txn.direction === 'in') return `+${amt(txn.paise)}`;
  return amt(txn.paise);
}

/** "−₹25,000 to Neha K · 21 Nov · HDFC Bank - 09" */
function describeTxn(txn: TxnRow): string {
  const preposition = txn.direction === 'in' ? 'from' : 'to';
  return [`${signedTxn(txn)} ${preposition} ${txnName(txn)}`, shortDate(txn.isoDate), txn.accountName].filter(Boolean).join(' · ');
}

/** Which part a picked transaction most likely is for a loan, from the way its money moved. */
function defaultPartFor(kind: LoanKind, direction: string): LoanPart {
  const principalDirection = kind === 'lent' ? 'out' : 'in';
  return direction === principalDirection ? 'principal' : 'repayment';
}

function useLendingData(revision: number) {
  return useMemo(() => {
    const db = getDb();
    const loanRows = loansQuery(db).all();
    const txns = loanTxnsQuery(db).all();
    const allocations = loanAllocationsQuery(db).all();
    const people = getLists().people;
    const personNames = new Map(db.select({ id: peopleTable.id, name: peopleTable.name }).from(peopleTable).all().map((row) => [row.id, row.name]));

    const slicesByTxn = new Map<number, typeof allocations>();
    for (const allocation of allocations) {
      const list = slicesByTxn.get(allocation.txnId) ?? [];
      list.push(allocation);
      slicesByTxn.set(allocation.txnId, list);
    }
    const slicedIds = [...slicesByTxn.keys()];
    const slicedAccounts = new Map(slicedIds.length
      ? db.select({ id: transactionsTable.id, accountName: transactionsTable.accountName }).from(transactionsTable).where(inArray(transactionsTable.id, slicedIds)).all().map((row) => [row.id, row.accountName])
      : []);

    const loans: LoanView[] = loanRows.map((loan) => {
      // A transaction that is split into slices is shown (and counted) by its slices only.
      const direct: Entry[] = txns.filter((txn) => txn.loanId === loan.id && !slicesByTxn.has(txn.id)).map((txn) => ({
        key: `txn-${txn.id}`,
        txnId: txn.id,
        part: loanPartOf(txn.transferRole),
        paise: txn.paise,
        isoDate: txn.isoDate,
        split: false,
        manual: txn.source === 'manual',
        account: txn.accountName,
        remarks: txn.remarks,
      }));
      const sliced: Entry[] = allocations.filter((allocation) => allocation.loanId === loan.id).map((allocation) => ({
        key: `allocation-${allocation.id}`,
        txnId: allocation.txnId,
        part: (allocation.part as LoanPart | null) ?? loanPartOf(allocation.transferRole),
        paise: allocation.paise,
        isoDate: allocation.isoDate,
        split: (slicesByTxn.get(allocation.txnId)?.length ?? 0) > 1,
        manual: false,
        account: slicedAccounts.get(allocation.txnId) ?? null,
        remarks: allocation.remarks,
      }));
      const entries = [...direct, ...sliced].sort((a, b) => b.isoDate.localeCompare(a.isoDate) || b.txnId - a.txnId);
      const balance = loanBalanceFromParts(entries.map((entry) => ({ part: entry.part, paise: entry.paise })));
      const kind = loan.kind as LoanKind;
      const principalDates = entries.filter((entry) => entry.part === 'principal').map((entry) => entry.isoDate).sort();
      return {
        id: loan.id,
        name: loan.name,
        personId: loan.personId,
        personName: personNames.get(loan.personId) ?? `Person #${loan.personId}`,
        kind,
        closed: loan.closed,
        updatedAt: loan.updatedAt,
        balance,
        net: kind === 'lent' ? balance.outstandingPaise : -balance.outstandingPaise,
        entries,
        startDate: principalDates[0] ?? loan.createdAt.slice(0, 10),
        lastDate: entries[0]?.isoDate ?? loan.createdAt.slice(0, 10),
      };
    });

    const candidates = unattachedTxnsQuery(db, {}, 300).all();
    return { loans, people, slicesByTxn, candidates };
  }, [revision]);
}

export function LendingPage() {
  const revision = useDatabaseRevision();
  const { loans, people, slicesByTxn, candidates } = useLendingData(revision);
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<ViewMode>(searchParams.get('view') === 'loans' ? 'loans' : 'people');
  const [status, setStatus] = useState<StatusFilter>('open');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [sort, setSort] = useState<SortKey>('outstanding');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selected = loans.find((loan) => loan.id === selectedId) ?? null;
  const closePanel = useCallback(() => setSelectedId(null), []);
  const closeDialog = useCallback(() => setDialog(null), []);
  const done = useCallback((message: string) => {
    setDialog(null);
    setError('');
    setNotice(message);
  }, []);
  const run = (action: () => void, message: string) => {
    try {
      action();
      setError('');
      setNotice(message);
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  useEffect(() => {
    if (selectedId != null && !loans.some((loan) => loan.id === selectedId)) setSelectedId(null);
  }, [loans, selectedId]);

  // ----- Summary -----
  const year = new Date().getFullYear();
  const openLent = loans.filter((loan) => !loan.closed && loan.kind === 'lent');
  const openBorrowed = loans.filter((loan) => !loan.closed && loan.kind === 'borrowed');
  const owedToYou = openLent.reduce((sum, loan) => sum + Math.max(loan.balance.outstandingPaise, 0), 0);
  const youOwe = openBorrowed.reduce((sum, loan) => sum + Math.max(loan.balance.outstandingPaise, 0), 0);
  const thisYear = (entry: Entry) => entry.isoDate.startsWith(String(year));
  const lentLoans = loans.filter((loan) => loan.kind === 'lent');
  const interestReceived = lentLoans.reduce(
    (sum, loan) => sum + loan.entries.filter((entry) => entry.part === 'interest' && thisYear(entry)).reduce((s, entry) => s + entry.paise, 0),
    0,
  );
  const repaidLoans = lentLoans.filter((loan) => loan.entries.some((entry) => entry.part === 'repayment' && thisYear(entry)));
  const repaidThisYear = repaidLoans.reduce(
    (sum, loan) => sum + loan.entries.filter((entry) => entry.part === 'repayment' && thisYear(entry)).reduce((s, entry) => s + entry.paise, 0),
    0,
  );

  // ----- List -----
  const visibleLoans = loans.filter((loan) => (status === 'all' || loan.closed === (status === 'closed')) && (kindFilter === 'all' || loan.kind === kindFilter));
  const compare = <T extends { net: number; lastDate: string; name: string }>(a: T, b: T) => {
    if (sort === 'recent') return b.lastDate.localeCompare(a.lastDate);
    if (sort === 'name') return a.name.localeCompare(b.name);
    return Math.abs(b.net) - Math.abs(a.net);
  };
  const loanRows = visibleLoans
    .map((loan) => ({ loan, net: loan.net, lastDate: loan.lastDate, name: `${loan.personName} ${loan.name}` }))
    .sort(compare);
  const personRows = [...new Set(visibleLoans.map((loan) => loan.personId))].map((personId) => {
    const personLoans = visibleLoans.filter((loan) => loan.personId === personId).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    const latest = personLoans
      .flatMap((loan) => loan.entries.map((entry) => ({ entry, kind: loan.kind })))
      .sort((a, b) => b.entry.isoDate.localeCompare(a.entry.isoDate))[0];
    return {
      personId,
      name: personLoans[0].personName,
      loans: personLoans,
      net: personLoans.reduce((sum, loan) => sum + loan.net, 0),
      interest: personLoans.reduce((sum, loan) => sum + loan.balance.interestPaise, 0),
      lastDate: latest?.entry.isoDate ?? personLoans[0].lastDate,
      latest,
    };
  }).sort(compare);

  const openNew = () => {
    setError('');
    setDialog({ type: 'new' });
  };
  const askDeleteLoan = (loan: LoanView) => setDialog({
    type: 'confirm',
    title: 'Delete this loan?',
    body: 'Its transactions stay in Activity as ordinary transactions. This can’t be undone.',
    confirmLabel: 'Delete loan',
    action: () => {
      deleteLoan(loan.id);
      setSelectedId(null);
    },
  });

  const amountCell = (net: number) => (net === 0
    ? <span className="badge">Settled</span>
    : <span className={`t-label ${net > 0 ? 'c-income' : 'c-spend'}`}>{formatInr(Math.abs(net))}</span>);
  const interestCell = (paise: number) => (paise ? formatInr(paise) : <span className="muted">—</span>);

  const listRow = (key: string, props: {
    active: boolean;
    avatar: string;
    title: string;
    caption: string;
    net: number;
    interest: number;
    c5: string;
    onOpen: () => void;
  }) => (
    <div
      key={key}
      className={`ln-row${props.active ? ' is-active' : ''}`}
      role="button"
      tabIndex={0}
      aria-current={props.active ? 'true' : undefined}
      onClick={props.onOpen}
      onKeyDown={activateOnKey(props.onOpen)}
    >
      <span className="avatar">{props.avatar}</span>
      <div className="col gap-0" style={{ minWidth: 0 }}>
        <span className="t-label truncate">{props.title}</span>
        <span className="t-caption muted truncate">{props.net < 0 ? 'You owe · ' : ''}{props.caption}</span>
      </div>
      <span className="ln-num">{amountCell(props.net)}</span>
      <span className="ln-num c4 t-small tabular">{interestCell(props.interest)}</span>
      <span className="c5 t-caption muted">{props.c5}</span>
    </div>
  );

  const empty = loans.length === 0;

  return (
    <div className="w-body ln">
      <TopActions>
        <button type="button" className="btn btn--sm btn--primary ln-top" aria-label="New loan" onClick={openNew}>
          <Icon name="add" /><span className="hide-phone">New loan</span>
        </button>
      </TopActions>
      <main className="w-main">
        <span className="ln-sr" role="status">{notice}</span>
        {error && !dialog && (
          <div className="banner banner--danger" role="alert">
            <Icon name="error" /><span className="banner__copy t-small">{error}</span>
            <button type="button" className="banner__action" onClick={() => setError('')}>Dismiss</button>
          </div>
        )}

        {!empty && (
          <>
            <div className="w-head">
              <div className="w-head__copy">
                <span className="t-title">Lending</span>
                <span className="t-small muted">Money you lent or borrowed, with repayments and interest. Transfers stay out of your spending.</span>
              </div>
              <div className="seg" style={{ width: 220 }} role="group" aria-label="Group loans by">
                <button type="button" className={`seg__item${view === 'people' ? ' is-selected' : ''}`} aria-pressed={view === 'people'} onClick={() => setView('people')}>People</button>
                <button type="button" className={`seg__item${view === 'loans' ? ' is-selected' : ''}`} aria-pressed={view === 'loans'} onClick={() => setView('loans')}>Loans</button>
              </div>
            </div>

            <div className="grid grid-4">
              <div className="card card--lg kpi"><span className="t-overline muted">OTHERS OWE YOU</span><span className="kpi__value c-income">{formatInr(owedToYou)}</span><span className="t-caption muted">{plural(openLent.length, 'open loan')} · {plural(new Set(openLent.map((loan) => loan.personId)).size, 'person').replace(/persons$/, 'people')}</span></div>
              <div className="card card--lg kpi"><span className="t-overline muted">YOU OWE</span><span className="kpi__value c-spend">{formatInr(youOwe)}</span><span className="t-caption muted">{plural(openBorrowed.length, 'open loan')}</span></div>
              <div className="card card--lg kpi"><span className="t-overline muted">INTEREST RECEIVED</span><span className="kpi__value c-accent">{formatInr(interestReceived)}</span><span className="t-caption muted">In {year}</span></div>
              <div className="card card--lg kpi"><span className="t-overline muted">REPAID THIS YEAR</span><span className="kpi__value">{formatInr(repaidThisYear)}</span><span className="t-caption muted">Across {plural(repaidLoans.length, 'loan')}</span></div>
            </div>

            <div className="toolbar" role="toolbar" aria-label="Filter loans">
              <ChipMenu
                label={{ open: 'Open', closed: 'Closed', all: 'All loans' }[status]}
                menuLabel="Loan status"
                isSet={status !== 'all'}
                value={status}
                options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All loans' }]}
                onChange={setStatus}
              />
              <ChipMenu
                label={{ all: 'Lent & borrowed', lent: 'Lent', borrowed: 'Borrowed' }[kindFilter]}
                menuLabel="Direction"
                isSet={kindFilter !== 'all'}
                value={kindFilter}
                options={[{ value: 'all', label: 'Lent & borrowed' }, { value: 'lent', label: 'Lent' }, { value: 'borrowed', label: 'Borrowed' }]}
                onChange={setKindFilter}
              />
              <ChipMenu
                label={`Sort: ${{ outstanding: 'Outstanding', recent: 'Recent', name: 'Name' }[sort]}`}
                menuLabel="Sort"
                isSet={false}
                value={sort}
                options={[{ value: 'outstanding', label: 'Outstanding' }, { value: 'recent', label: 'Recent activity' }, { value: 'name', label: 'Name' }]}
                onChange={setSort}
              />
            </div>

            <div className="card card--none" style={{ padding: 0, overflow: 'clip' }}>
              <div className="ln-row ln-head t-caption muted" aria-hidden="true">
                <span></span><span>{view === 'loans' ? 'Loan' : 'Person'}</span><span className="ln-num">Outstanding</span><span className="ln-num c4">Interest</span><span className="c5">{view === 'loans' ? 'Principal' : 'Activity'}</span>
              </div>
              <div>
                {view === 'people'
                  ? personRows.map((person) => {
                    const kinds = new Set(person.loans.map((loan) => loan.kind));
                    const allClosed = person.loans.every((loan) => loan.closed);
                    const count = plural(person.loans.length, 'loan');
                    const caption = allClosed ? `Closed · ${count}` : kinds.size > 1 ? `Lent & borrowed · ${count}` : kinds.has('borrowed') ? `Borrowed · ${count}` : count;
                    const lastClosed = person.loans.map((loan) => loan.updatedAt.slice(0, 10)).sort().at(-1) ?? '';
                    const c5 = allClosed && lastClosed
                      ? `Closed ${shortDate(lastClosed)}`
                      : person.latest ? `Last: ${activityVerb(person.latest.kind, person.latest.entry.part)} ${shortDate(person.latest.entry.isoDate)}` : 'No entries yet';
                    return listRow(`person-${person.personId}`, {
                      active: person.loans.some((loan) => loan.id === selectedId),
                      avatar: initials(person.name),
                      title: person.name,
                      caption,
                      net: person.net,
                      interest: person.interest,
                      c5,
                      onOpen: () => setSelectedId(person.loans[0].id),
                    });
                  })
                  : loanRows.map(({ loan }) => listRow(`loan-${loan.id}`, {
                    active: loan.id === selectedId,
                    avatar: initials(loan.personName),
                    title: `${loan.personName}${loan.name ? ` · ${loan.name}` : ''}`,
                    caption: `${loan.kind === 'lent' ? 'Lent' : 'Borrowed'} ${longDate(loan.startDate)}${loan.closed ? ` · closed ${shortDate(loan.updatedAt.slice(0, 10))}` : ''}`,
                    net: loan.net,
                    interest: loan.balance.interestPaise,
                    c5: `${amt(loan.balance.principalPaise)} principal`,
                    onOpen: () => setSelectedId(loan.id),
                  }))}
                {visibleLoans.length === 0 && (
                  <div className="empty"><span className="t-small muted">No loans match these filters.</span></div>
                )}
              </div>
            </div>
          </>
        )}

        {empty && (
          <div className="empty" style={{ marginTop: 'var(--sp-6)' }}>
            <span className="empty__icon"><Icon name="handshake" /></span>
            <span className="t-heading">No loans yet</span>
            <span className="t-small muted">Mark a transfer as “Money lent” in Activity, or add a loan here. Repayments and interest can then be attached to it.</span>
            <button type="button" className="btn btn--primary" onClick={openNew}><Icon name="add" />New loan</button>
          </div>
        )}
      </main>

      <DetailPanel
        open={selected != null}
        onClose={closePanel}
        label="Loan detail"
        bar={(
          <>
            <span className="t-overline muted">LOAN</span>
            <span className="grow"></span>
            <button type="button" className="icon-btn icon-btn--sm icon-btn--plain ln-edit" title="Edit loan" aria-label="Edit loan" onClick={() => setDialog({ type: 'edit-loan' })}>
              <Icon name="edit" />
            </button>
          </>
        )}
        footer={selected && (
          <>
            <button type="button" className="btn btn--ghost btn--sm" style={{ color: 'var(--spend)' }} onClick={() => askDeleteLoan(selected)}><Icon name="delete" />Delete loan</button>
            <span className="grow"></span>
            <span className="t-caption muted">Saves to Drive automatically</span>
          </>
        )}
      >
        {selected && (
          <LoanDetail
            loan={selected}
            slicesByTxn={slicesByTxn}
            onAddEntry={() => setDialog({ type: 'entry' })}
            onAttach={() => setDialog({ type: 'attach' })}
            onToggleClosed={() => run(() => setLoanClosed(selected.id, !selected.closed), selected.closed ? 'Loan reopened.' : 'Loan closed.')}
            onOpenEntry={(entry) => setDialog(entry.manual ? { type: 'entry', txnId: entry.txnId } : { type: 'attach', txnId: entry.txnId })}
          />
        )}
      </DetailPanel>

      {dialog?.type === 'new' && (
        <NewLoanDialog
          people={people}
          candidates={candidates}
          onClose={closeDialog}
          onCreated={(id) => {
            setSelectedId(id);
            done('Loan created.');
          }}
        />
      )}
      {dialog?.type === 'edit-loan' && selected && (
        <EditLoanDialog loan={selected} people={people} onClose={closeDialog} onDone={done} />
      )}
      {dialog?.type === 'entry' && selected && (
        <EntryDialog
          loan={selected}
          txnId={dialog.txnId}
          onClose={closeDialog}
          onDone={done}
          onDelete={(txnId) => setDialog({
            type: 'confirm',
            title: 'Delete this entry?',
            body: 'This hand-added entry is removed for good, and the loan balance updates.',
            confirmLabel: 'Delete entry',
            action: () => deleteLoanTransaction(txnId),
          })}
        />
      )}
      {dialog?.type === 'attach' && selected && (
        <AttachDialog
          loan={selected}
          loans={loans}
          txnId={dialog.txnId}
          slicesByTxn={slicesByTxn}
          candidates={candidates}
          onClose={closeDialog}
          onDone={done}
          onDetach={(txnId, split) => setDialog({
            type: 'confirm',
            title: 'Detach this transaction?',
            body: split
              ? 'It goes back to an ordinary transaction in Activity and is removed from every loan it was split across.'
              : 'It goes back to an ordinary transaction in Activity, and the loan balance updates.',
            confirmLabel: 'Detach',
            action: () => detachTransactionFromLoan(txnId),
          })}
        />
      )}
      {dialog?.type === 'confirm' && (
        <ConfirmDialog
          title={dialog.title}
          body={dialog.body}
          confirmLabel={dialog.confirmLabel}
          onClose={closeDialog}
          onConfirm={() => {
            try {
              dialog.action();
              done(`${dialog.confirmLabel.replace(/^Delete/, 'Deleted').replace(/^Detach$/, 'Detached')}.`);
            } catch (reason) {
              setDialog(null);
              setError(errorText(reason));
            }
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Detail panel body
// ---------------------------------------------------------------------------------------------

function LoanDetail({
  loan,
  slicesByTxn,
  onAddEntry,
  onAttach,
  onToggleClosed,
  onOpenEntry,
}: {
  loan: LoanView;
  slicesByTxn: Map<number, { part: string | null; paise: number; transferRole: string | null }[]>;
  onAddEntry: () => void;
  onAttach: () => void;
  onToggleClosed: () => void;
  onOpenEntry: (entry: Entry) => void;
}) {
  const { balance } = loan;
  const percent = balance.principalPaise > 0 ? Math.max(0, Math.min(100, Math.round((balance.repaidPaise / balance.principalPaise) * 100))) : 0;
  const note = [...loan.entries].reverse().find((entry) => entry.part === 'principal' && entry.manual && entry.remarks)?.remarks;
  const splitCaption = (txnId: number) => (slicesByTxn.get(txnId) ?? [])
    .map((slice) => `${amt(slice.paise)} ${(slice.part as LoanPart | null) ?? loanPartOf(slice.transferRole) ?? 'entry'}`)
    .join(' + ');

  return (
    <>
      <div className="row gap-3">
        <span className="avatar" style={{ width: 44, height: 44 }}>{initials(loan.personName)}</span>
        <div className="grow col gap-0">
          <span className="t-subtitle">{loan.personName}</span>
          <span className="t-small muted">{loan.kind === 'lent' ? 'Lent' : 'Borrowed'} · since {longDate(loan.startDate)}{loan.name ? ` · ${loan.name}` : ''}</span>
        </div>
        <span className={`badge${loan.closed ? '' : ' badge--income'}`}>{loan.closed ? 'Closed' : 'Open'}</span>
      </div>
      <div className="card card--subtle col gap-2">
        <div className="row row--between"><span className="t-small muted">Outstanding</span><span className={`t-amount ${loan.kind === 'lent' ? 'c-income' : 'c-spend'}`}>{formatInr(balance.outstandingPaise)}</span></div>
        <div className="split" role="progressbar" aria-label="Repaid" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%`, background: 'var(--accent)' }}></span></div>
        <div className="row row--between t-caption muted"><span>{amt(balance.repaidPaise)} repaid of {amt(balance.principalPaise)}</span><span>{percent}%</span></div>
      </div>
      <div className="grid grid-3" style={{ gap: 'var(--sp-2)' }}>
        <div className="card stat-col" style={{ padding: 'var(--sp-2) var(--sp-3)' }}><span className="t-caption muted">Principal</span><span className="t-stat">{amt(balance.principalPaise)}</span></div>
        <div className="card stat-col" style={{ padding: 'var(--sp-2) var(--sp-3)' }}><span className="t-caption muted">Repaid</span><span className="t-stat">{amt(balance.repaidPaise)}</span></div>
        <div className="card stat-col" style={{ padding: 'var(--sp-2) var(--sp-3)' }}><span className="t-caption muted">Interest</span><span className="t-stat c-accent">{amt(balance.interestPaise)}</span></div>
      </div>
      <div className="row gap-2 wrap">
        <button type="button" className="btn btn--sm btn--primary" onClick={onAddEntry}><Icon name="add" />Add entry</button>
        <button type="button" className="btn btn--sm" onClick={onAttach}><Icon name="link" />Attach existing</button>
        <button type="button" className="btn btn--sm" onClick={onToggleClosed}><Icon name={loan.closed ? 'replay' : 'task_alt'} />{loan.closed ? 'Reopen loan' : 'Close loan'}</button>
      </div>
      <div className="dp-section"><span className="t-overline muted">HISTORY</span>
        {loan.entries.length ? (
          <div className="hist">
            {loan.entries.map((entry) => {
              const icon = partIcon(loan.kind, entry.part);
              const money = entryAmount(loan.kind, entry.part, entry.paise);
              const detail = entry.split ? splitCaption(entry.txnId) : entry.manual ? entry.remarks || 'Added by hand' : entry.account || entry.remarks || 'Imported';
              const open = () => onOpenEntry(entry);
              return (
                <div
                  key={entry.key}
                  className="hist__row"
                  role="button"
                  tabIndex={0}
                  aria-label={`${partLabel(loan.kind, entry.part)}, ${longDate(entry.isoDate)}, ${money.text}. ${entry.manual ? 'Edit entry' : 'Linked transaction details'}`}
                  onClick={open}
                  onKeyDown={activateOnKey(open)}
                >
                  <span className="hist__dot"><span className={`ms ${icon.tone}`} aria-hidden="true">{icon.name}</span></span>
                  <div className="col gap-0" style={{ minWidth: 0 }}>
                    <span className="t-label">{partLabel(loan.kind, entry.part)}{entry.split && <> <span className="badge">Split</span></>}</span>
                    <span className="t-caption muted truncate">{longDate(entry.isoDate)} · {detail}</span>
                  </div>
                  <span className={`t-small-em tabular${money.tone ? ` ${money.tone}` : ''}`}>{money.text}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <span className="t-small muted">No entries yet. Add one, or attach a transaction from Activity.</span>
        )}
      </div>
      {note && <div className="dp-section"><span className="t-overline muted">NOTE</span><div className="note-box t-small">{note}</div></div>}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Shared controls
// ---------------------------------------------------------------------------------------------

function ChipMenu<T extends string>({
  label,
  menuLabel,
  isSet,
  value,
  options,
  onChange,
}: {
  label: string;
  menuLabel: string;
  isSet: boolean;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    anchorRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onPointer = (event: MouseEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = [...(anchorRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
        const index = items.indexOf(document.activeElement as HTMLElement);
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <span className="anchor" ref={anchorRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`chip chip--btn${isSet ? ' is-set' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${menuLabel}: ${label}`}
        onClick={() => setOpen((current) => !current)}
      >
        {label}<Icon name="expand_more" />
      </button>
      {open && (
        <div className="pop" role="menu" aria-label={menuLabel}>
          <div className="pop__list">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={option.value === value}
                className={`pop__item${option.value === value ? ' is-selected' : ''}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                <span className="grow">{option.label}</span>{option.value === value && <Icon name="check" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

function Dialog({
  id,
  icon,
  tone,
  title,
  subtitle,
  wide,
  onClose,
  onSubmit,
  children,
  actions,
}: {
  id: string;
  icon: string;
  tone?: 'danger';
  title: string;
  subtitle?: string;
  wide?: boolean;
  onClose: () => void;
  onSubmit: () => void;
  children?: ReactNode;
  actions: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const form = formRef.current;
    const focusables = () => (form
      ? [...form.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')]
      : []);
    (form?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0])?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !form) return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!form.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className="w-modal ln" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form
        ref={formRef}
        className={`w-dialog${wide ? ' w-dialog--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="w-dialog__head">
          <span className={`w-dialog__icon${tone ? ` w-dialog__icon--${tone}` : ''}`}><Icon name={icon} /></span>
          <div className="col gap-1"><span id={`${id}-title`} className="t-heading">{title}</span>{subtitle && <span className="t-small muted">{subtitle}</span>}</div>
        </div>
        {children}
        <div className="w-dialog__actions">{actions}</div>
      </form>
    </div>
  );
}

function Field({ id, label, help, error, multi, children }: { id: string; label: string; help?: string; error?: string; multi?: boolean; children: ReactNode }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <div className={`field__box${multi ? ' field__box--multi' : ''}${error ? ' is-error' : ''}`}>{children}</div>
      {help && <span className="field__help">{help}</span>}
    </div>
  );
}

function DateField({ id, label, value, onChange, readOnly }: { id: string; label: string; value: string; onChange: (value: string) => void; readOnly?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Field id={id} label={label}>
      <input ref={ref} id={id} type="date" value={value} readOnly={readOnly} required onChange={(event) => onChange(event.target.value)} />
      <span
        className="ms muted field__icon"
        aria-hidden="true"
        onClick={() => {
          if (readOnly) return;
          try {
            ref.current?.showPicker();
          } catch {
            ref.current?.focus();
          }
        }}
      >calendar_today</span>
    </Field>
  );
}

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={`seg__item${option.value === value ? ' is-selected' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function DialogError({ message }: { message: string }) {
  return message ? <div className="banner banner--danger" role="alert"><Icon name="error" /><span className="banner__copy t-small">{message}</span></div> : null;
}

function TxnPicker({
  rows,
  selectedId,
  suggestedId,
  onSelect,
}: {
  rows: TxnRow[];
  selectedId: number | null;
  suggestedId?: number | null;
  onSelect: (txn: TxnRow) => void;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const filtered = rows
    .filter((txn) => !needle || [txn.counterpartyName, txn.rawDetails, txn.remarks, txn.note, txn.accountName, (txn.paise / 100).toFixed(2), txn.isoDate]
      .some((text) => text?.toLowerCase().includes(needle)))
    .sort((a, b) => Number(b.id === suggestedId) - Number(a.id === suggestedId))
    .slice(0, 100);
  return (
    <div className="ln-pick">
      <div className="field__box field__box--sm">
        <Icon name="search" className="muted" />
        <input aria-label="Search transactions" placeholder="Search payee, note, amount" value={query} onChange={(event) => setQuery(event.target.value)} data-autofocus />
      </div>
      <div className="ln-pick__list" role="listbox" aria-label="Transactions">
        {filtered.map((txn) => (
          <button
            key={txn.id}
            type="button"
            role="option"
            aria-selected={txn.id === selectedId}
            className={`pop__item${txn.id === selectedId ? ' is-selected' : ''}`}
            onClick={() => onSelect(txn)}
          >
            <span className="grow col gap-0">
              <span className="t-small-em truncate">{txnName(txn)}{txn.id === suggestedId && <> <span className="badge badge--accent">Suggested</span></>}</span>
              <span className="t-caption muted truncate">{[longDate(txn.isoDate), txn.accountName].filter(Boolean).join(' · ')}</span>
            </span>
            <span className={`t-small-em tabular ${txn.direction === 'in' ? 'c-income' : ''}`}>{signedTxn(txn)}</span>
          </button>
        ))}
        {!filtered.length && <span className="t-small muted ln-pick__empty">No unattached transactions match.</span>}
      </div>
    </div>
  );
}

function PersonInput({ id, value, onChange, people }: { id: string; value: string; onChange: (value: string) => void; people: { id: number; name: string }[] }) {
  return (
    <>
      <input id={id} list={`${id}-list`} autoComplete="off" placeholder="Choose or type a name" value={value} onChange={(event) => onChange(event.target.value)} data-autofocus />
      <datalist id={`${id}-list`}>{people.map((person) => <option key={person.id} value={person.name} />)}</datalist>
      <Icon name="expand_more" className="muted" />
    </>
  );
}

function resolvePerson(name: string, people: { id: number; name: string }[]): number {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Choose or type a person.');
  const existing = people.find((person) => person.name.trim().toLowerCase() === trimmed.toLowerCase());
  return existing ? existing.id : addPerson(trimmed);
}

const KIND_OPTIONS: { value: LoanKind; label: string }[] = [
  { value: 'lent', label: 'I lent money' },
  { value: 'borrowed', label: 'I borrowed money' },
];

// ---------------------------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------------------------

function NewLoanDialog({
  people,
  candidates,
  onClose,
  onCreated,
}: {
  people: { id: number; name: string }[];
  candidates: TxnRow[];
  onClose: () => void;
  onCreated: (loanId: number) => void;
}) {
  const [kind, setKind] = useState<LoanKind>('lent');
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [linkedId, setLinkedId] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');

  const principalDirection = kind === 'lent' ? 'out' : 'in';
  const matching = candidates.filter((txn) => txn.direction === principalDirection);
  const linked = candidates.find((txn) => txn.id === linkedId) ?? null;
  const personNeedle = person.trim().toLowerCase();
  const typedPaise = parseAmount(amount);
  const suggestion = matching.find((txn) => personNeedle && txn.counterpartyName?.toLowerCase().includes(personNeedle))
    ?? (typedPaise > 0 ? matching.find((txn) => txn.paise === typedPaise) : undefined)
    ?? null;

  const choose = (txn: TxnRow) => {
    setLinkedId(txn.id);
    setPicking(false);
    setAmount((txn.paise / 100).toFixed(2).replace(/\.00$/, ''));
    setDate(txn.isoDate);
    if (!person.trim() && txn.counterpartyName) setPerson(txn.counterpartyName);
  };

  const submit = () => {
    setError('');
    const paise = linked ? linked.paise : parseAmount(amount);
    if (!person.trim()) { setError('Choose or type a person.'); return; }
    if (!Number.isSafeInteger(paise) || paise <= 0) { setError('Enter an amount greater than zero.'); return; }
    if (!date) { setError('Choose a date.'); return; }
    try {
      const personId = resolvePerson(person, people);
      const loanId = createLoan({ name, personId, kind });
      if (linked) attachTransactionToLoan(linked.id, loanId, 'principal');
      else addLoanTransaction({ loanId, part: 'principal', paise, isoDate: date, remarks: note.trim() || null });
      onCreated(loanId);
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return (
    <Dialog
      id="nl"
      icon="handshake"
      title="New loan"
      subtitle="Link the transfer that started it, or enter it by hand."
      wide
      onClose={onClose}
      onSubmit={submit}
      actions={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn btn--primary">Add loan</button></>}
    >
      <Seg label="Direction" value={kind} options={KIND_OPTIONS} onChange={(value) => { setKind(value); setLinkedId(null); }} />
      <div className="grid grid-2" style={{ gap: 'var(--sp-3)' }}>
        <Field id="nl-person" label="Person" help="From People & groups, or type a new name">
          <PersonInput id="nl-person" value={person} onChange={setPerson} people={people} />
        </Field>
        <Field id="nl-amount" label="Amount">
          <span className="muted">₹</span>
          <input id="nl-amount" inputMode="decimal" placeholder="0" value={amount} readOnly={!!linked} onChange={(event) => setAmount(event.target.value)} />
        </Field>
        <DateField id="nl-date" label="Date" value={date} onChange={setDate} readOnly={!!linked} />
        <Field id="nl-name" label="Loan name (optional)">
          <input id="nl-name" placeholder="e.g. Shop deposit" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
      </div>
      <div className="card card--subtle row gap-3">
        <Icon name="link" className="c-accent" />
        <div className="grow col gap-0">
          <span className="t-small-em">{linked ? 'Linked transaction' : 'Link to a transaction'}</span>
          <span className="t-caption muted">{linked ? describeTxn(linked) : suggestion ? `Suggested: ${describeTxn(suggestion)}` : 'Optional. Pick the transfer from Activity so it isn’t counted twice.'}</span>
        </div>
        {linked
          ? <button type="button" className="btn btn--sm" onClick={() => setLinkedId(null)}>Remove</button>
          : <button type="button" className="btn btn--sm" aria-expanded={picking} onClick={() => setPicking((current) => !current)}>Choose</button>}
      </div>
      {picking && !linked && <TxnPicker rows={matching} selectedId={linkedId} suggestedId={suggestion?.id} onSelect={choose} />}
      <Field id="nl-note" label="Note" multi>
        <textarea
          id="nl-note"
          placeholder={linked ? 'Notes stay on the linked transaction in Activity' : 'What it’s for'}
          value={note}
          disabled={!!linked}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <DialogError message={error} />
    </Dialog>
  );
}

function EditLoanDialog({ loan, people, onClose, onDone }: { loan: LoanView; people: { id: number; name: string }[]; onClose: () => void; onDone: (message: string) => void }) {
  const [kind, setKind] = useState<LoanKind>(loan.kind);
  const [person, setPerson] = useState(loan.personName);
  const [name, setName] = useState(loan.name);
  const [error, setError] = useState('');
  const submit = () => {
    try {
      const personId = person.trim() === loan.personName ? loan.personId : resolvePerson(person, people);
      updateLoan(loan.id, { name, kind, personId });
      onDone('Loan updated.');
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  return (
    <Dialog
      id="el"
      icon="edit"
      title="Edit loan"
      subtitle="Changing the direction or person updates every entry on this loan."
      wide
      onClose={onClose}
      onSubmit={submit}
      actions={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn btn--primary">Save</button></>}
    >
      <Seg label="Direction" value={kind} options={KIND_OPTIONS} onChange={setKind} />
      <div className="grid grid-2" style={{ gap: 'var(--sp-3)' }}>
        <Field id="el-person" label="Person" help="From People & groups, or type a new name">
          <PersonInput id="el-person" value={person} onChange={setPerson} people={people} />
        </Field>
        <Field id="el-name" label="Loan name (optional)">
          <input id="el-name" placeholder="e.g. Shop deposit" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
      </div>
      <DialogError message={error} />
    </Dialog>
  );
}

function EntryDialog({
  loan,
  txnId,
  onClose,
  onDone,
  onDelete,
}: {
  loan: LoanView;
  txnId?: number;
  onClose: () => void;
  onDone: (message: string) => void;
  onDelete: (txnId: number) => void;
}) {
  const existing = useMemo(() => (txnId != null ? getEditableLoanTransaction(txnId) : null), [txnId]);
  const [part, setPart] = useState<LoanPart>(existing?.part ?? 'repayment');
  const [amount, setAmount] = useState(existing ? (existing.paise / 100).toFixed(2).replace(/\.00$/, '') : '');
  const [date, setDate] = useState(existing?.isoDate ?? today());
  const [note, setNote] = useState(existing?.remarks ?? '');
  const [error, setError] = useState('');
  const editing = txnId != null;
  const submit = () => {
    const paise = parseAmount(amount);
    if (!Number.isSafeInteger(paise) || paise <= 0) { setError('Enter an amount greater than zero.'); return; }
    if (!date) { setError('Choose a date.'); return; }
    try {
      if (editing) {
        updateLoanTransaction(txnId, { part, paise, isoDate: date, remarks: note.trim() || null });
        onDone('Entry updated.');
      } else {
        addLoanTransaction({ loanId: loan.id, part, paise, isoDate: date, remarks: note.trim() || null });
        onDone('Entry added.');
      }
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  return (
    <Dialog
      id="le"
      icon={editing ? 'edit' : 'add'}
      title={editing ? 'Edit entry' : 'Add entry'}
      subtitle={`A repayment, interest or more principal on ${loan.kind === 'lent' ? 'money you lent to' : 'money you borrowed from'} ${loan.personName}.`}
      onClose={onClose}
      onSubmit={submit}
      actions={(
        <>
          {editing && <button type="button" className="btn btn--ghost" style={{ color: 'var(--spend)' }} onClick={() => onDelete(txnId)}><Icon name="delete" />Delete entry</button>}
          {editing && <span className="grow hide-phone"></span>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary">{editing ? 'Save' : 'Add entry'}</button>
        </>
      )}
    >
      <Seg label="Part" value={part} options={PARTS.map((item) => ({ value: item.part, label: item.label }))} onChange={setPart} />
      <div className="grid grid-2" style={{ gap: 'var(--sp-3)' }}>
        <Field id="le-amount" label="Amount">
          <span className="muted">₹</span>
          <input id="le-amount" inputMode="decimal" placeholder="0" value={amount} onChange={(event) => setAmount(event.target.value)} data-autofocus />
        </Field>
        <DateField id="le-date" label="Date" value={date} onChange={setDate} />
      </div>
      <Field id="le-note" label="Note" multi>
        <textarea id="le-note" placeholder="e.g. Cash, or what it was for" value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <DialogError message={error} />
    </Dialog>
  );
}

function AttachDialog({
  loan,
  loans,
  txnId,
  slicesByTxn,
  candidates,
  onClose,
  onDone,
  onDetach,
}: {
  loan: LoanView;
  loans: LoanView[];
  txnId?: number;
  slicesByTxn: Map<number, { loanId: number; part: string | null; paise: number; transferRole: string | null }[]>;
  candidates: TxnRow[];
  onClose: () => void;
  onDone: (message: string) => void;
  onDetach: (txnId: number, split: boolean) => void;
}) {
  const existing = useMemo(
    () => (txnId != null ? getDb().select().from(transactionsTable).where(eq(transactionsTable.id, txnId)).get() ?? null : null),
    [txnId],
  );
  const existingSlices = txnId != null ? slicesByTxn.get(txnId) ?? [] : [];
  const sliceKey = useRef(0);
  const nextKey = () => (sliceKey.current += 1);
  const [pickedId, setPickedId] = useState<number | null>(null);
  const txn = existing ?? candidates.find((row) => row.id === pickedId) ?? null;
  const [mode, setMode] = useState<'single' | 'split'>(existingSlices.length ? 'split' : 'single');
  const [part, setPart] = useState<LoanPart>(existing ? loanPartOf(existing.transferRole) ?? 'repayment' : 'repayment');
  const [slices, setSlices] = useState<Slice[]>(() => existingSlices.map((slice) => ({
    key: nextKey(),
    loanId: slice.loanId,
    part: (slice.part as LoanPart | null) ?? loanPartOf(slice.transferRole) ?? 'repayment',
    amount: (slice.paise / 100).toFixed(2).replace(/\.00$/, ''),
  })));
  const [error, setError] = useState('');

  const loanOptions = loans.filter((item) => !item.closed || item.id === loan.id || slices.some((slice) => slice.loanId === item.id));
  const allocated = slices.reduce((sum, slice) => sum + (parseAmount(slice.amount) || 0), 0);

  const pick = (row: TxnRow) => {
    setPickedId(row.id);
    const nextPart = defaultPartFor(loan.kind, row.direction);
    setPart(nextPart);
    setSlices([{ key: nextKey(), loanId: loan.id, part: nextPart, amount: (row.paise / 100).toFixed(2).replace(/\.00$/, '') }]);
  };
  const switchMode = (next: 'single' | 'split') => {
    setMode(next);
    if (next === 'split' && !slices.length && txn) {
      setSlices([{ key: nextKey(), loanId: loan.id, part, amount: (txn.paise / 100).toFixed(2).replace(/\.00$/, '') }]);
    }
  };
  const updateSlice = (key: number, patch: Partial<Slice>) => setSlices((current) => current.map((slice) => (slice.key === key ? { ...slice, ...patch } : slice)));

  const submit = () => {
    if (!txn) { setError('Choose a transaction to attach.'); return; }
    try {
      if (mode === 'single') {
        attachTransactionToLoan(txn.id, loan.id, part);
      } else {
        const allocations = slices.map((slice) => ({ loanId: slice.loanId, part: slice.part, paise: parseAmount(slice.amount) }));
        if (allocations.some((allocation) => !Number.isSafeInteger(allocation.paise) || allocation.paise <= 0)) {
          setError('Every slice needs an amount greater than zero.');
          return;
        }
        splitTransactionAcrossLoans(txn.id, allocations);
      }
      onDone(existing ? 'Transaction updated.' : 'Transaction attached to the loan.');
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return (
    <Dialog
      id="la"
      icon="link"
      title={existing ? 'Linked transaction' : 'Attach existing'}
      subtitle={existing
        ? 'Imported from your statement. Its amount and date stay as the bank reported them.'
        : 'Pick a transaction from Activity and say what it is for this loan.'}
      wide
      onClose={onClose}
      onSubmit={submit}
      actions={(
        <>
          {existing && <button type="button" className="btn btn--ghost" style={{ color: 'var(--spend)' }} onClick={() => onDetach(existing.id, existingSlices.length > 1)}><Icon name="link_off" />Detach</button>}
          {existing && <Link className="btn btn--ghost" to={`/transactions?txn=${existing.id}`}><Icon name="open_in_new" />Open in Activity</Link>}
          {existing && <span className="grow hide-phone"></span>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={!txn}>{existing ? 'Save' : 'Attach'}</button>
        </>
      )}
    >
      {txn ? (
        <div className="card card--subtle row gap-3">
          <Icon name="receipt_long" className="c-accent" />
          <div className="grow col gap-0" style={{ minWidth: 0 }}>
            <span className="t-small-em truncate">{txnName(txn)}</span>
            <span className="t-caption muted truncate">{[longDate(txn.isoDate), txn.accountName].filter(Boolean).join(' · ')}</span>
          </div>
          <span className={`t-small-em tabular ${txn.direction === 'in' ? 'c-income' : ''}`}>{signedTxn(txn)}</span>
          {!existing && <button type="button" className="btn btn--sm" onClick={() => setPickedId(null)}>Change</button>}
        </div>
      ) : (
        <TxnPicker rows={candidates} selectedId={pickedId} onSelect={pick} />
      )}
      {txn && (
        <>
          <Seg
            label="Attach as"
            value={mode}
            options={[{ value: 'single', label: `Part of this loan` }, { value: 'split', label: 'Split across loans' }]}
            onChange={switchMode}
          />
          {mode === 'single' ? (
            <div className="field">
              <span className="field__label" id="la-part">What it is for {loan.personName}</span>
              <Seg label="Part" value={part} options={PARTS.map((item) => ({ value: item.part, label: item.label }))} onChange={setPart} />
            </div>
          ) : (
            <div className="col gap-2">
              {slices.map((slice, index) => (
                <div className="ln-slice" key={slice.key}>
                  <div className="field__box field__box--sm">
                    <select aria-label={`Slice ${index + 1} loan`} value={slice.loanId} onChange={(event) => updateSlice(slice.key, { loanId: Number(event.target.value) })}>
                      {loanOptions.map((item) => <option key={item.id} value={item.id}>{item.personName}{item.name ? ` · ${item.name}` : ''} ({item.kind === 'lent' ? 'lent' : 'borrowed'})</option>)}
                    </select>
                    <Icon name="expand_more" className="muted" />
                  </div>
                  <div className="field__box field__box--sm">
                    <select aria-label={`Slice ${index + 1} part`} value={slice.part} onChange={(event) => updateSlice(slice.key, { part: event.target.value as LoanPart })}>
                      {PARTS.map((item) => <option key={item.part} value={item.part}>{item.label}</option>)}
                    </select>
                    <Icon name="expand_more" className="muted" />
                  </div>
                  <div className="field__box field__box--sm">
                    <span className="muted">₹</span>
                    <input aria-label={`Slice ${index + 1} amount`} inputMode="decimal" value={slice.amount} onChange={(event) => updateSlice(slice.key, { amount: event.target.value })} />
                  </div>
                  <button type="button" className="icon-btn icon-btn--sm icon-btn--plain" aria-label={`Remove slice ${index + 1}`} disabled={slices.length === 1} onClick={() => setSlices((current) => current.filter((item) => item.key !== slice.key))}>
                    <Icon name="close" />
                  </button>
                </div>
              ))}
              <div className="row row--between">
                <button type="button" className="btn btn--sm" onClick={() => setSlices((current) => [...current, { key: nextKey(), loanId: loan.id, part, amount: '' }])}><Icon name="add" />Add slice</button>
                <span className={`t-caption ${allocated > txn.paise ? 'c-spend' : 'muted'}`}>{formatInr(allocated)} of {formatInr(txn.paise)} allocated</span>
              </div>
            </div>
          )}
        </>
      )}
      <DialogError message={error} />
    </Dialog>
  );
}

function ConfirmDialog({ title, body, confirmLabel, onClose, onConfirm }: { title: string; body: string; confirmLabel: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog
      id="lc"
      icon="warning"
      tone="danger"
      title={title}
      subtitle={body}
      onClose={onClose}
      onSubmit={onConfirm}
      actions={<><button type="button" className="btn" onClick={onClose} data-autofocus>Cancel</button><button type="submit" className="btn btn--danger">{confirmLabel}</button></>}
    />
  );
}
