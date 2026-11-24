import { asc, eq } from 'drizzle-orm';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import {
  acceptAllReviews,
  acceptTransactionReview,
  addCategory,
  addPerson,
  addSubcategory,
  attachTransactionToLoan,
  createLoan,
  deleteTransaction,
  detachTransactionFromLoan,
  getAllTransactions,
  linkTxnToCardStatement,
  recategorizeTransaction,
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
import { categories, imports, loanAllocations, paymentModes, people, subcategories, type TransactionRow } from '@finance-tracker/core/db/schema';
import { defaultLoanFlow, isTransferRole, LOAN_FLOWS, loanFlowError, loanFlowLabel, loanFlowOf, loanPartForFlow, loanPartOf, ROLE_META, type LoanFlow, type LoanKind, type LoanPart } from '@finance-tracker/core/lending/roles';
import { monthKeyOf, type TxnFilter } from '@finance-tracker/core/analytics/filter';
import { getDb } from '@finance-tracker/core/db/runtime';
import { inr, useDatabaseRevision } from './feature-utils';
import { downloadExport } from './export-workbook';
import { DetailPanel, Icon, MONTHS_LONG, MONTHS_SHORT, TopActions, formatInr, longDate, shortDate } from './shell';
import './TransactionsPage.css';

type Direction = 'in' | 'out' | 'self';
type Menu = 'period' | 'category' | 'account' | 'person' | 'direction' | 'amount' | 'columns' | null;
type Category = typeof categories.$inferSelect;
type LoanRow = { id: number; name: string; personId: number; kind: string; closed: boolean };
type Subcategory = typeof subcategories.$inferSelect;

interface SplitDraft {
  loanId: string;
  flow: LoanFlow;
  amount: string;
}

type ListItem =
  | { type: 'group'; key: string; label: string; count: number; spent: number }
  | { type: 'row'; key: string; txn: TransactionRow };

const FILTER_KEYS = ['review', 'category', 'subcategory', 'account', 'person', 'direction', 'from', 'to', 'min', 'max'];
const DIRECTION_LABELS: Record<Direction, string> = { out: 'Money out', in: 'Money in', self: 'Self-transfers' };
const COLUMNS_KEY = 'finance-tracker.activity.columns';

/* ---------------- Small helpers ---------------- */

const fmtCount = (value: number) => value.toLocaleString('en-IN');
const hhmm = (time: string | null) => (time ?? '').slice(0, 5);
function time12(time: string | null): string {
  if (!time) return '';
  const [h, m] = time.split(':');
  const hour = Number(h);
  return `${(hour % 12) || 12}:${m} ${hour < 12 ? 'AM' : 'PM'}`;
}
function isOutgoing(txn: TransactionRow): boolean {
  if (txn.direction === 'self') return txn.originalDirection !== 'in';
  return txn.direction === 'out';
}
function signedPaise(txn: TransactionRow): number {
  return isOutgoing(txn) ? -txn.paise : txn.paise;
}
function isCardBill(txn: TransactionRow): boolean {
  return txn.linkedImportId != null || txn.transferRole === 'cc_payment';
}
function amountClass(txn: TransactionRow): string {
  if (txn.direction === 'in') return 'c-income';
  if (txn.direction === 'self' || isCardBill(txn)) return '';
  return 'c-spend';
}
function countsAsSpend(txn: TransactionRow): boolean {
  return txn.direction === 'out' && !isCardBill(txn);
}
function payeeOf(txn: TransactionRow): string {
  return txn.counterpartyName || txn.rawDetails || (isTransferRole(txn.transferRole) ? ROLE_META[txn.transferRole].label : '') || 'Transaction';
}
function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  return `${MONTHS_LONG[Number(month) - 1]} ${year}`;
}
function lastDayOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
}
function periodLabel(from: string, to: string): string {
  if (!from && !to) return 'All time';
  if (from && to) {
    const [fy, fm, fd] = from.split('-').map(Number);
    if (fd === 1 && from.endsWith('-01-01') && to === `${fy}-12-31`) return String(fy);
    if (fd === 1 && to === lastDayOfMonth(fy, fm)) return `${MONTHS_SHORT[fm - 1]} ${fy}`;
    return `${longDate(from)} – ${longDate(to)}`;
  }
  return from ? `From ${longDate(from)}` : `Until ${longDate(to)}`;
}
function sourceLabel(source: string): string {
  if (source === 'paytm') return 'Paytm UPI statement';
  if (source === 'manual') return 'Added by hand';
  return `${source.charAt(0).toUpperCase()}${source.slice(1)} statement`;
}
function rupeesToPaise(value: string | null): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}
function listParam(value: string | null): string[] {
  return value ? value.split(',').filter(Boolean) : [];
}
function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener('change', notify);
    return () => list.removeEventListener('change', notify);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName));
}

/** `.cb` drawn as an accessible checkbox. */
function Check({ on, mixed = false, label, onToggle }: { on: boolean; mixed?: boolean; label: string; onToggle: () => void }) {
  return (
    <span
      className={`cb${on ? ' is-on' : ''}${mixed && !on ? ' is-mixed' : ''}`}
      role="checkbox"
      aria-checked={mixed && !on ? 'mixed' : on}
      aria-label={label}
      tabIndex={0}
      onClick={(event) => { event.stopPropagation(); onToggle(); }}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onToggle(); }
      }}
    ><Icon name="check" /></span>
  );
}

/** A `.field__box` that looks like the mock's static value + chevron but is a real native select. */
function SelectBox({ label, value, display, disabled, small = true, onChange, children }: {
  label: string; value: string; display: string; disabled?: boolean; small?: boolean; onChange: (value: string) => void; children: ReactNode;
}) {
  return (
    <label className={`field__box${small ? ' field__box--sm' : ''} act-select-box${disabled ? ' is-disabled' : ''}`} style={disabled ? { opacity: 0.6 } : undefined}>
      <span className="act-select-value">{display}</span><span className="ms muted" aria-hidden="true">expand_more</span>
      <select className="act-select" aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{children}</select>
    </label>
  );
}

/** Closes a popover on outside pointer-down and on Escape (before the detail panel sees Escape). */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, ref, close]);
}

/* ---------------- Category picker (two-column .picker) ---------------- */

function CategoryPicker({
  className, style, categoryRows, subRows, initialCategoryId, initialSubId, suggestedSubId, othersCount, payee, onSave, onClose, onError,
}: {
  className: string;
  style?: CSSProperties;
  categoryRows: Category[];
  subRows: Subcategory[];
  initialCategoryId: number | null;
  initialSubId: number | null;
  suggestedSubId?: number | null;
  othersCount?: number;
  payee?: string;
  onSave: (categoryId: number, subId: number | null, applyOthers: boolean) => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(initialCategoryId ?? categoryRows[0]?.id ?? null);
  const [subId, setSubId] = useState<number | null>(initialSubId);
  const [applyOthers, setApplyOthers] = useState(true);
  const [explicitNoSub, setExplicitNoSub] = useState(false);
  useDismiss(true, ref, onClose);
  const q = query.trim().toLowerCase();
  const subsOf = (id: number) => subRows.filter((sub) => sub.categoryId === id && !sub.isArchived);
  const visibleCats = categoryRows.filter((cat) => !q || cat.name.toLowerCase().includes(q) || subsOf(cat.id).some((sub) => sub.name.toLowerCase().includes(q)));
  const activeId = visibleCats.some((cat) => cat.id === categoryId) ? categoryId : visibleCats[0]?.id ?? null;
  const active = categoryRows.find((cat) => cat.id === activeId) ?? null;
  const activeMatches = !q || (active?.name.toLowerCase().includes(q) ?? false);
  const visibleSubs = active ? subsOf(active.id).filter((sub) => activeMatches || sub.name.toLowerCase().includes(q)) : [];
  const chosenSub = activeId === categoryId ? subId : null;
  const save = () => { if (activeId != null) onSave(activeId, chosenSub, applyOthers); };
  const create = (kind: 'category' | 'sub') => {
    const name = query.trim() || window.prompt(kind === 'category' ? 'New category name' : 'New sub-category name')?.trim() || '';
    if (!name) return;
    try {
      if (kind === 'category') { setCategoryId(addCategory(name)); setSubId(null); }
      else if (activeId != null) { setCategoryId(activeId); setSubId(addSubcategory(activeId, name)); }
      setQuery('');
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return (
    <div className={className} style={style} ref={ref} role="dialog" aria-label="Choose a category">
      <div className="pop__search"><label className="field__box field__box--sm is-focused"><Icon name="search" className="muted" />
        <input className="act-input grow" autoFocus aria-label="Search or create a category" placeholder="Type to search or create…" value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } }} />
        <span className="kbd">esc</span></label></div>
      <div className="picker">
        <div className="picker__col"><span className="picker__label t-overline muted">CATEGORY</span><div className="pop__list" role="listbox" aria-label="Category">
          {visibleCats.map((cat) => (
            <button type="button" role="option" aria-selected={cat.id === activeId} key={cat.id} className={`pop__item${cat.id === activeId ? ' is-hover is-selected' : ''}`}
              onClick={() => { setCategoryId(cat.id); setSubId(cat.id === initialCategoryId ? initialSubId : null); setExplicitNoSub(false); }}
              onDoubleClick={() => onSave(cat.id, null, applyOthers)}>
              <span>{cat.emoji || '•'}</span><span className="grow">{cat.name}</span>{cat.id === activeId && <Icon name="chevron_right" className="ms-16" />}
            </button>
          ))}
          <button type="button" className="pop__item c-accent" onClick={() => create('category')}><Icon name="add" className="ms-16" />New category</button>
        </div></div>
        <div className="picker__col"><span className="picker__label t-overline muted">{active ? `${active.name.toUpperCase()} ›` : 'SUB-CATEGORY'}</span><div className="pop__list" role="listbox" aria-label="Sub-category">
          {visibleSubs.map((sub) => (
            <button type="button" role="option" aria-selected={sub.id === chosenSub} key={sub.id} className={`pop__item${sub.id === chosenSub ? ' is-selected' : ''}`}
              onClick={() => { setCategoryId(activeId); setSubId(sub.id); setExplicitNoSub(false); }}
              onDoubleClick={() => activeId != null && onSave(activeId, sub.id, applyOthers)}>
              <span className="grow">{sub.name}</span>{sub.id === suggestedSubId && <span className="t-caption muted">suggested</span>}
            </button>
          ))}
          {active && <button type="button" className={`pop__item muted${chosenSub == null && (explicitNoSub || (activeId === initialCategoryId && initialCategoryId != null)) ? ' is-selected' : ''}`} onClick={() => { setCategoryId(activeId); setSubId(null); setExplicitNoSub(true); }}>No sub-category</button>}
          {active && <button type="button" className="pop__item c-accent" onClick={() => create('sub')}><Icon name="add" className="ms-16" />New sub-category</button>}
        </div></div>
      </div>
      <div className="pop__foot">
        {othersCount && payee
          ? <label className="row gap-1 t-small"><Check on={applyOthers} label={`Also apply to ${othersCount} other “${payee}” rows`} onToggle={() => setApplyOthers((value) => !value)} />Also apply to {othersCount} other “{payee}” rows</label>
          : <span />}
        <button type="button" className="btn btn--sm btn--primary" disabled={activeId == null} onClick={save}>Save</button>
      </div>
    </div>
  );
}

/* ---------------- Page ---------------- */

export function TransactionsPage({ search, onSearchChange }: { search: string; onSearchChange: (value: string) => void }) {
  const revision = useDatabaseRevision();
  const [params, setParams] = useSearchParams();
  const db = getDb();
  const isPhone = useMediaQuery('(max-width: 719px)');

  const rows = useMemo(() => getAllTransactions().sort((a, b) => b.isoDate.localeCompare(a.isoDate) || (b.time ?? '').localeCompare(a.time ?? '') || b.id - a.id), [revision]);
  const categoryRows = useMemo(
    () => db.select().from(categories).where(eq(categories.isArchived, false)).orderBy(asc(categories.sortOrder), asc(categories.id)).all(),
    [db, revision],
  );
  const subRows = useMemo(() => db.select().from(subcategories).orderBy(asc(subcategories.sortOrder), asc(subcategories.id)).all(), [db, revision]);
  const paymentModeRows = useMemo(() => db.select().from(paymentModes).where(eq(paymentModes.isArchived, false)).orderBy(asc(paymentModes.sortOrder), asc(paymentModes.id)).all(), [db, revision]);
  const peopleRows = useMemo(() => db.select().from(people).where(eq(people.isArchived, false)).orderBy(asc(people.sortOrder), asc(people.id)).all(), [db, revision]);
  const importRows = useMemo(() => new Map(db.select().from(imports).all().map((row) => [row.id, row])), [db, revision]);
  const loanLinkedIds = useMemo(() => new Set(db.select({ txnId: loanAllocations.txnId }).from(loanAllocations).all().map((row) => row.txnId)), [db, revision]);
  const loans = useMemo(() => loansQuery(db).all(), [db, revision]);
  const statements = useMemo(() => cardStatementsQuery(db).all(), [db, revision]);
  const categoryMap = useMemo(() => new Map(categoryRows.map((item) => [item.id, item])), [categoryRows]);
  const subMap = useMemo(() => new Map(subRows.map((item) => [item.id, item])), [subRows]);
  const personMap = useMemo(() => new Map(peopleRows.map((item) => [item.id, item.name])), [peopleRows]);

  /* ----- Filters (kept in the URL so other pages can deep-link) ----- */
  const reviewOnly = params.get('review') === '1';
  const catFilter = listParam(params.get('category'));
  const subFilter = listParam(params.get('subcategory')).map(Number);
  const accountFilter = params.get('account') ?? '';
  const personFilter = params.get('person') ?? '';
  const directionParam = params.get('direction');
  const direction: Direction | '' = directionParam === 'in' || directionParam === 'out' || directionParam === 'self' ? directionParam : '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const minParam = params.get('min') ?? '';
  const maxParam = params.get('max') ?? '';
  const [localSearch, setLocalSearch] = useState('');
  const term = (search.trim() || localSearch.trim()).toLowerCase();

  const updateParams = useCallback((patch: Record<string, string | null>, replace = true) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === '') next.delete(key);
        else next.set(key, value);
      }
      return next;
    }, { replace });
  }, [setParams]);

  const accountNames = useMemo(
    () => [...new Set(rows.flatMap((txn) => txn.accountName ? [txn.accountName] : []))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const years = useMemo(() => [...new Set(rows.map((txn) => Number(txn.isoDate.slice(0, 4))))].sort((a, b) => b - a), [rows]);
  const reviewTotal = useMemo(() => rows.reduce((count, txn) => count + (txn.needsReview ? 1 : 0), 0), [rows]);

  // Every filter except the category one — the category popover counts against this.
  const base = useMemo(() => {
    const minPaise = rupeesToPaise(minParam);
    const maxPaise = rupeesToPaise(maxParam);
    return rows.filter((txn) => {
      if (reviewOnly && !txn.needsReview) return false;
      if (accountFilter && txn.accountName !== accountFilter) return false;
      if (personFilter && (personFilter === 'unset' ? txn.personId != null : txn.personId !== Number(personFilter))) return false;
      if (direction && txn.direction !== direction) return false;
      if (from && txn.isoDate < from) return false;
      if (to && txn.isoDate > to) return false;
      if (minPaise != null && txn.paise < minPaise) return false;
      if (maxPaise != null && txn.paise > maxPaise) return false;
      if (term) {
        const text = `${txn.counterpartyName ?? ''} ${txn.counterpartyVpa ?? ''} ${txn.rawDetails} ${txn.note ?? ''} ${txn.remarks ?? ''} ${txn.rawTag ?? ''} ${(txn.paise / 100).toFixed(2)}`.toLowerCase();
        if (!text.includes(term)) return false;
      }
      return true;
    });
  }, [rows, reviewOnly, accountFilter, personFilter, direction, from, to, minParam, maxParam, term]);
  const matchesCategory = useCallback((txn: TransactionRow, cats: string[], subs: number[]) => {
    if (!cats.length && !subs.length) return true;
    if (txn.categoryId == null) return cats.includes('uncategorized');
    return cats.includes(String(txn.categoryId)) || (txn.subcategoryId != null && subs.includes(txn.subcategoryId));
  }, []);
  const catKey = catFilter.join(',');
  const subKey = subFilter.join(',');
  const filtered = useMemo(() => base.filter((txn) => matchesCategory(txn, catFilter, subFilter)), [base, catKey, subKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => {
    let spent = 0; let received = 0; let refunds = 0;
    for (const txn of filtered) {
      if (countsAsSpend(txn)) spent += txn.paise;
      if (txn.direction === 'in') { received += txn.paise; if (txn.isRefund) refunds += txn.paise; }
    }
    return { spent, received, net: spent - refunds };
  }, [filtered]);

  const items = useMemo(() => {
    const out: ListItem[] = [];
    let group: Extract<ListItem, { type: 'group' }> | null = null;
    for (const txn of filtered) {
      const key = txn.isoDate.slice(0, 7);
      if (!group || group.key !== `g-${key}`) {
        group = { type: 'group', key: `g-${key}`, label: monthLabel(key), count: 0, spent: 0 };
        out.push(group);
      }
      group.count += 1;
      if (countsAsSpend(txn)) group.spent += txn.paise;
      out.push({ type: 'row', key: `t-${txn.id}`, txn });
    }
    return out;
  }, [filtered]);

  /* ----- Selection, panel, menus ----- */
  const selectedId = Number(params.get('txn')) || null;
  const selected = selectedId == null ? null : rows.find((txn) => txn.id === selectedId) ?? null;
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [menu, setMenu] = useState<Menu>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [columns, setColumns] = useState<{ account: boolean; person: boolean }>(() => {
    try { return { account: true, person: true, ...JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? '{}') }; } catch { return { account: true, person: true }; }
  });
  useEffect(() => { localStorage.setItem(COLUMNS_KEY, JSON.stringify(columns)); }, [columns]);

  useEffect(() => {
    const alive = new Set(rows.map((txn) => txn.id));
    setSelectedIds((current) => [...current].every((id) => alive.has(id)) ? current : new Set([...current].filter((id) => alive.has(id))));
  }, [rows]);

  const run = (action: () => void) => {
    setError('');
    try { action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const selectTxn = useCallback((id: number) => {
    setError('');
    setParams((current) => { const next = new URLSearchParams(current); next.set('txn', String(id)); return next; }, { replace: Number(params.get('txn')) > 0 });
  }, [params, setParams]);
  const closeDetail = useCallback(() => updateParams({ txn: null }), [updateParams]);
  const toggleSelected = (id: number) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allSelected = filtered.length > 0 && filtered.every((txn) => selectedIds.has(txn.id));
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(filtered.map((txn) => txn.id)));
  const clearFilters = () => {
    updateParams(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])));
    setLocalSearch('');
    onSearchChange('');
  };

  /* ----- Virtualization (window scroll; spacer rows keep the mock's table layout) ----- */
  const listRef = useRef<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const offset = Math.round(element.getBoundingClientRect().top + window.scrollY);
    if (Math.abs(offset - scrollMargin) > 1) setScrollMargin(offset);
  });
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: (index) => isPhone ? (items[index]?.type === 'group' ? 37 : 57) : (items[index]?.type === 'group' ? 35 : 49),
    getItemKey: (index) => `${isPhone ? 'm' : 't'}${items[index]?.key ?? index}`,
    overscan: 8,
    scrollMargin,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const padTop = virtualItems.length ? Math.max(0, virtualItems[0].start - scrollMargin) : 0;
  const padBottom = virtualItems.length ? Math.max(0, virtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1].end - scrollMargin)) : 0;

  const filteredIndex = useMemo(() => new Map(filtered.map((txn, index) => [txn.id, index])), [filtered]);
  const itemIndex = useMemo(() => new Map(items.map((item, index) => [item.key, index])), [items]);
  const move = useCallback((offset: 1 | -1) => {
    if (!filtered.length) return;
    const current = selectedId == null ? -1 : filteredIndex.get(selectedId) ?? -1;
    const next = filtered[Math.min(filtered.length - 1, Math.max(0, current + offset))];
    if (!next) return;
    selectTxn(next.id);
    const index = itemIndex.get(`t-${next.id}`);
    if (index != null) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [filtered, filteredIndex, itemIndex, selectedId, selectTxn, virtualizer]);

  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => { setPickerOpen(false); }, [selectedId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || exportOpen) return;
      if (event.key === 'j') { event.preventDefault(); move(1); }
      else if (event.key === 'k') { event.preventDefault(); move(-1); }
      else if (event.key === 'e' && selected) { event.preventDefault(); setPickerOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, selected, exportOpen]);

  /* ----- Render helpers ----- */
  const categoryText = (txn: TransactionRow) => {
    const cat = txn.categoryId == null ? null : categoryMap.get(txn.categoryId);
    if (!cat) return 'Uncategorized';
    const sub = txn.subcategoryId == null ? null : subMap.get(txn.subcategoryId);
    return `${cat.name}${sub ? ` · ${sub.name}` : ''}`;
  };
  const emojiOf = (txn: TransactionRow) => (txn.categoryId == null ? null : categoryMap.get(txn.categoryId)?.emoji) || (txn.categoryId == null ? '❔' : '•');
  const catPill = (txn: TransactionRow) => txn.needsReview
    ? <span className="cat-pill cat-pill--review"><span className="em">❔</span><span>Needs a category</span></span>
    : <span className="cat-pill"><span className="em">{emojiOf(txn)}</span><span>{categoryText(txn)}</span></span>;
  const isLoanLinked = (txn: TransactionRow) => txn.loanId != null || isTransferRole(txn.transferRole) && txn.transferRole !== 'cc_payment' && txn.transferRole !== 'cc_payment_received' || loanLinkedIds.has(txn.id);
  const noteLine = (txn: TransactionRow) => {
    const bits: string[] = [];
    if (txn.note?.trim()) bits.push(txn.note.trim());
    if (txn.isRefund) bits.push('Refund');
    if (txn.direction === 'self') bits.push('Self-transfer · not counted');
    if (isTransferRole(txn.transferRole) && txn.transferRole !== 'cc_payment') bits.push(ROLE_META[txn.transferRole].label);
    else if (txn.loanId != null || loanLinkedIds.has(txn.id)) bits.push('Money lent');
    if (txn.linkedImportId != null) bits.push('Card bill · linked');
    return bits.join(' · ');
  };

  const selectionMode = selectedIds.size > 0;
  const spacerRow = (height: number, key: string) => (
    <tr className="act-spacer" aria-hidden="true" key={key}>
      <td style={{ height }} /><td /><td /><td />
      {columns.account && <td className="hide-tablet hide-with-panel" />}
      {columns.person && <td className="hide-tablet hide-with-panel" />}
      <td />
    </tr>
  );
  const renderTableItem = (item: ListItem, index: number) => {
    if (item.type === 'group') {
      return (
        <tr className="t-group" key={item.key} data-index={index} ref={virtualizer.measureElement}>
          <td colSpan={3}><b>{item.label}</b> · {fmtCount(item.count)} transactions</td><td></td>
          {columns.account && <td className="hide-tablet hide-with-panel"></td>}
          {columns.person && <td className="hide-tablet hide-with-panel"></td>}
          <td className="num tabular">Spent {formatInr(item.spent)}</td>
        </tr>
      );
    }
    const txn = item.txn;
    const on = selectedIds.has(txn.id);
    const note = noteLine(txn);
    const account = txn.accountName || '—';
    const payee = payeeOf(txn);
    return (
      <tr
        key={item.key} data-index={index} ref={virtualizer.measureElement} data-id={txn.id}
        className={`t-row${selected?.id === txn.id ? ' is-active' : ''}${on ? ' is-checked' : ''}`}
        tabIndex={0} aria-selected={selected?.id === txn.id}
        onClick={() => selectTxn(txn.id)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter') { event.preventDefault(); selectTxn(txn.id); }
          else if (event.key === ' ') { event.preventDefault(); toggleSelected(txn.id); }
        }}
      >
        <td className="c-check"><Check on={on} label={`Select ${payee}`} onToggle={() => toggleSelected(txn.id)} /></td>
        <td className="tabular"><div className="cellstack"><span>{shortDate(txn.isoDate)}</span><span className="t-caption muted">{hhmm(txn.time)}</span></div></td>
        <td><div className="cellstack"><span className="t-label">{txn.needsReview && <span className="review-mark" title="Needs review"></span>}{payee}</span>
          <span className="t-caption muted">{note || <><span className="only-compact">{account}</span><span className="only-with-panel">{account}</span></>}</span></div></td>
        <td>{catPill(txn)}</td>
        {columns.account && <td className="hide-tablet hide-with-panel muted">{account}</td>}
        {columns.person && <td className="hide-tablet hide-with-panel muted">{txn.personId == null ? '—' : personMap.get(txn.personId) ?? '—'}</td>}
        <td className={`num t-label ${amountClass(txn)}`}>{formatInr(signedPaise(txn), { sign: true })}</td>
      </tr>
    );
  };
  const renderPhoneItem = (item: ListItem, index: number) => {
    if (item.type === 'group') {
      return <div className="mlist__group" key={item.key} data-index={index} ref={virtualizer.measureElement}><span className="t-overline muted">{item.label.toUpperCase()}</span><span className="t-caption muted tabular">Spent {formatInr(item.spent)}</span></div>;
    }
    const txn = item.txn;
    const on = selectedIds.has(txn.id);
    const payee = payeeOf(txn);
    return (
      <div
        key={item.key} data-index={index} ref={virtualizer.measureElement} data-id={txn.id}
        className={`mrow${on ? ' is-checked' : ''}`} role="button" tabIndex={0} aria-label={`${payee}, ${formatInr(signedPaise(txn), { sign: true })}`}
        onClick={() => (selectionMode ? toggleSelected(txn.id) : selectTxn(txn.id))}
        onContextMenu={(event) => { event.preventDefault(); toggleSelected(txn.id); }}
        onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === 'Enter') { event.preventDefault(); selectTxn(txn.id); } }}
      >
        {selectionMode && <Check on={on} label={`Select ${payee}`} onToggle={() => toggleSelected(txn.id)} />}
        <span className="mrow__glyph">{txn.needsReview ? '❔' : emojiOf(txn)}</span>
        <div className="mrow__left"><span className="t-label">{payee}</span><span className="t-caption muted">{txn.needsReview ? 'Needs a category' : categoryText(txn)} · {shortDate(txn.isoDate)}</span></div>
        <div className="mrow__right"><span className={`t-label tabular ${amountClass(txn)}`}>{formatInr(signedPaise(txn), { sign: true })}</span>
          {txn.needsReview ? <span className="badge badge--review">Review</span> : <span className="t-caption muted">{hhmm(txn.time)}</span>}</div>
      </div>
    );
  };

  /* ----- Empty / no-results copy ----- */
  const catNames = [
    ...catFilter.map((id) => id === 'uncategorized' ? 'Uncategorized' : categoryMap.get(Number(id))?.name ?? 'Unknown'),
    ...subFilter.map((id) => { const sub = subMap.get(id); return sub ? `${categoryMap.get(sub.categoryId)?.name ?? ''} · ${sub.name}` : 'Unknown'; }),
  ];
  const filterDescriptions = [
    catNames.length ? `Category: ${catNames.join(', ')}` : '',
    accountFilter ? `Account: ${accountFilter}` : '',
    personFilter ? `For: ${personFilter === 'unset' ? 'Not set' : personMap.get(Number(personFilter)) ?? 'Unknown'}` : '',
    direction ? DIRECTION_LABELS[direction] : '',
    minParam || maxParam ? `Amount: ${amountLabel(minParam, maxParam)}` : '',
    reviewOnly ? 'Needs review' : '',
  ].filter(Boolean);
  const noResultsCopy = `Nothing${from || to ? ` in ${periodLabel(from, to)}` : ''} matches${term ? ` “${search.trim() || localSearch.trim()}”` : ' these filters'}${filterDescriptions.length ? ` with ${filterDescriptions.join(', ')}` : ''}.`;

  const bulkSum = useMemo(() => rows.reduce((sum, txn) => sum + (selectedIds.has(txn.id) ? signedPaise(txn) : 0), 0), [rows, selectedIds]);
  const empty = rows.length === 0;
  const noResults = !empty && filtered.length === 0;
  const footText = reviewOnly
    ? `Showing ${fmtCount(filtered.length)} of ${fmtCount(reviewTotal)} that need review`
    : `Showing ${fmtCount(filtered.length)} of ${fmtCount(rows.length)}${virtualItems.length < items.length ? ' · more load as you scroll' : ''}`;

  return (
    <div className="w-body act">
      <TopActions>
        <Link className="btn btn--sm btn--primary hide-phone" to="/import"><Icon name="file_download" />Import</Link>
      </TopActions>
      <main className="w-main">
        {!empty && (
          <div className="card card--none">
            <div className="sumstrip">
              <div className="stat-col first-only"><span className="t-caption muted">Showing</span><span className="t-stat">{reviewOnly ? `${fmtCount(filtered.length)} need review` : `${fmtCount(filtered.length)} transactions`}</span></div>
              <div className="stat-divider first-only"></div>
              <div className="stat-col"><span className="t-caption muted">Spent</span><span className="t-stat c-spend">{formatInr(summary.spent)}</span></div>
              <div className="stat-divider"></div>
              <div className="stat-col"><span className="t-caption muted">Received</span><span className="t-stat c-income">{formatInr(summary.received)}</span></div>
              <div className="stat-divider"></div>
              <div className="stat-col"><span className="t-caption muted">Net spent</span><span className="t-stat">{formatInr(summary.net)}</span></div>
            </div>
          </div>
        )}

        {!empty && (
          <div className="col gap-2">
            <label className="field__box field__box--sm only-phone"><Icon name="search" className="muted" />
              <input className="act-input grow" aria-label="Search payee, note, amount" placeholder="Search payee, note, amount…" value={localSearch} onChange={(event) => setLocalSearch(event.target.value)} /></label>
            <Toolbar
              menu={menu} setMenu={setMenu}
              from={from} to={to} years={years}
              categoryRows={categoryRows} subRows={subRows} base={base} catFilter={catFilter} subFilter={subFilter} matchesCategory={matchesCategory}
              accountNames={accountNames} accountFilter={accountFilter}
              peopleRows={peopleRows} personFilter={personFilter}
              direction={direction} minParam={minParam} maxParam={maxParam}
              reviewOnly={reviewOnly} reviewTotal={reviewTotal}
              columns={columns} setColumns={setColumns}
              updateParams={updateParams} onExport={() => { setMenu(null); setExportOpen(true); }}
            />
          </div>
        )}

        {reviewOnly && !empty && filtered.length > 0 && (
          <div className="banner banner--review">
            <Icon name="flag" />
            <div className="banner__copy t-small">{fmtCount(filtered.length)} transactions need a category. Pick one in the panel, or select several and use <b>Set category</b>.</div>
            <button type="button" className="banner__action" onClick={() => run(() => { const count = acceptAllReviews(); setNotice(`Accepted ${fmtCount(count)} review suggestions.`); })}>Accept all</button>
          </div>
        )}
        {notice && <div className="banner banner--success" role="status"><Icon name="check_circle" /><div className="banner__copy t-small">{notice}</div><button type="button" className="banner__action" onClick={() => setNotice('')}>Dismiss</button></div>}
        {error && <div className="banner banner--danger" role="alert"><Icon name="error" /><div className="banner__copy t-small">{error}</div><button type="button" className="banner__action" onClick={() => setError('')}>Dismiss</button></div>}

        {!empty && !noResults && !isPhone && (
          <div className="tbl-wrap hide-phone">
            <table className="tbl" aria-label="Transactions">
              <thead>
                <tr>
                  <th className="c-check"><Check on={allSelected} mixed={selectionMode} label="Select all" onToggle={toggleAll} /></th>
                  <th className="c-date is-sorted" aria-sort="descending">Date <Icon name="arrow_downward" /></th>
                  <th>Payee and note</th>
                  <th className="c-cat">Category</th>
                  {columns.account && <th className="c-acc hide-tablet hide-with-panel">Account</th>}
                  {columns.person && <th className="c-for hide-tablet hide-with-panel">For</th>}
                  <th className="c-amt num">Amount</th>
                </tr>
              </thead>
              <tbody ref={(element) => { listRef.current = element; }}>
                {padTop > 0 && spacerRow(padTop, 'pad-top')}
                {virtualItems.map((virtualItem) => renderTableItem(items[virtualItem.index], virtualItem.index))}
                {padBottom > 0 && spacerRow(padBottom, 'pad-bottom')}
              </tbody>
            </table>
            <div className="tbl-foot t-caption muted">{footText}</div>
          </div>
        )}

        {!empty && !noResults && isPhone && (
          <div className="mlist only-phone" ref={(element) => { listRef.current = element; }} role="list" aria-label="Transactions">
            {padTop > 0 && <div aria-hidden="true" style={{ height: padTop, flexShrink: 0 }} />}
            {virtualItems.map((virtualItem) => renderPhoneItem(items[virtualItem.index], virtualItem.index))}
            {padBottom > 0 && <div aria-hidden="true" style={{ height: padBottom, flexShrink: 0 }} />}
          </div>
        )}

        {noResults && (
          <div className="empty" style={{ marginTop: 'var(--sp-6)' }}>
            <span className="empty__icon"><Icon name="search_off" /></span>
            <span className="t-heading">No transactions match</span>
            <span className="t-small muted">{noResultsCopy}</span>
            <button type="button" className="btn" onClick={clearFilters}>Clear filters</button>
          </div>
        )}
        {empty && (
          <div className="empty" style={{ marginTop: 'var(--sp-6)' }}>
            <span className="empty__icon"><Icon name="receipt_long" /></span>
            <span className="t-heading">No transactions yet</span>
            <span className="t-small muted">Import a Paytm, bank or credit-card statement to get started. You can drop several files at once.</span>
            <Link className="btn btn--primary" to="/import"><Icon name="file_download" />Import statements</Link>
          </div>
        )}
      </main>

      <DetailPanel
        open={!!selected}
        onClose={closeDetail}
        label="Transaction detail"
        bar={<>
          <span className="t-overline muted">TRANSACTION</span>
          <span className="row gap-1 act-nav">
            <button type="button" className="icon-btn icon-btn--sm icon-btn--plain hide-phone" title="Previous (k)" aria-label="Previous transaction (k)" onClick={() => move(-1)}><Icon name="keyboard_arrow_up" /></button>
            <button type="button" className="icon-btn icon-btn--sm icon-btn--plain hide-phone" title="Next (j)" aria-label="Next transaction (j)" onClick={() => move(1)}><Icon name="keyboard_arrow_down" /></button>
          </span>
        </>}
        footer={<>
          <span className="save-note t-caption grow"><Icon name="cloud_done" />Changes save to Drive automatically</span>
          <span className="t-caption muted hide-phone shortcut-hint"><span className="kbd">j</span><span className="kbd">k</span> move</span>
        </>}
      >
        {selected && (
          <TransactionDetail
            key={selected.id}
            txn={selected}
            rows={rows}
            categoryRows={categoryRows}
            subRows={subRows}
            categoryMap={categoryMap}
            subMap={subMap}
            peopleRows={peopleRows}
            paymentModeRows={paymentModeRows}
            importRows={importRows}
            loans={loans}
            statements={statements}
            loanLinked={isLoanLinked(selected)}
            pickerOpen={pickerOpen}
            setPickerOpen={setPickerOpen}
            run={run}
            onError={setError}
            onDeleted={closeDetail}
          />
        )}
      </DetailPanel>

      {selectionMode && (
        <BulkBar
          count={selectedIds.size}
          sum={bulkSum}
          categoryRows={categoryRows}
          subRows={subRows}
          peopleRows={peopleRows}
          onSetCategory={(categoryId, subId) => run(() => { for (const id of selectedIds) setTransactionCategory(id, categoryId, subId); setSelectedIds(new Set()); })}
          onSetPerson={(personId) => {
            const chosen = rows.filter((txn) => selectedIds.has(txn.id));
            if (chosen.some((txn) => txn.loanId != null || txn.transferRole != null || loanLinkedIds.has(txn.id))) {
              setError('Remove loan-linked transactions from the selection before changing “For”.');
              return;
            }
            run(() => { for (const txn of chosen) setTransactionPerson(txn.id, personId); setSelectedIds(new Set()); });
          }}
          onMarkReviewed={() => run(() => { for (const id of selectedIds) acceptTransactionReview(id); setSelectedIds(new Set()); })}
          onDelete={() => {
            if (!window.confirm(`Delete ${selectedIds.size} transactions?`)) return;
            run(() => { for (const id of selectedIds) deleteTransaction(id); setSelectedIds(new Set()); });
          }}
          onClear={() => setSelectedIds(new Set())}
          onError={setError}
        />
      )}

      {exportOpen && (
        <ExportDialog
          years={years}
          rows={rows}
          filtered={filtered}
          defaultYear={from ? Number(from.slice(0, 4)) : years[0] ?? new Date().getFullYear()}
          buildFilter={() => {
            const filter: TxnFilter = {};
            if (from) filter.from = monthKeyOf(from);
            if (to) filter.to = monthKeyOf(to);
            if (catFilter.length === 1 && !subFilter.length) filter.categoryId = catFilter[0] === 'uncategorized' ? null : Number(catFilter[0]);
            else if (subFilter.length === 1 && !catFilter.length) {
              filter.subcategoryId = subFilter[0];
              filter.categoryId = subMap.get(subFilter[0])?.categoryId;
            }
            if (accountFilter) filter.account = accountFilter;
            if (personFilter) filter.personId = personFilter === 'unset' ? null : Number(personFilter);
            if (direction) filter.direction = direction;
            if (reviewOnly) filter.needsReview = true;
            const minPaise = rupeesToPaise(minParam);
            const maxPaise = rupeesToPaise(maxParam);
            if (minPaise != null) filter.minPaise = minPaise;
            if (maxPaise != null) filter.maxPaise = maxPaise;
            if (term) filter.search = term;
            return filter;
          }}
          multiCategory={catFilter.length + subFilter.length > 1}
          onClose={() => setExportOpen(false)}
          onDone={(fileName) => { setExportOpen(false); setNotice(`Exported ${fileName}.`); }}
          onError={setError}
        />
      )}
    </div>
  );
}

function amountLabel(min: string, max: string): string {
  const fmt = (value: string) => formatInr(rupeesToPaise(value) ?? 0, { noPaise: Number(value) % 1 === 0 });
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  if (min) return `Over ${fmt(min)}`;
  if (max) return `Under ${fmt(max)}`;
  return 'Amount';
}

/* ---------------- Toolbar of filter chips ---------------- */

function ChipMenu({ id, menu, setMenu, label, icon, set, width, children }: {
  id: Exclude<Menu, null>; menu: Menu; setMenu: (menu: Menu) => void; label: ReactNode; icon?: string; set: boolean; width?: number; children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const open = menu === id;
  const close = useCallback(() => setMenu(null), [setMenu]);
  useDismiss(open, ref, close);
  return (
    <span className="anchor" ref={ref}>
      <button type="button" className={`chip chip--btn${set || open ? ' is-set' : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setMenu(open ? null : id)}>
        {icon && <Icon name={icon} />}{label}<Icon name="expand_more" />
      </button>
      {open && <div className="pop" role="dialog" style={{ top: 38, left: 0, width: width ?? 260 }}>{children}</div>}
    </span>
  );
}

function OptionList<T extends string>({ options, value, onPick }: { options: { value: T; label: ReactNode; count?: number }[]; value: T; onPick: (value: T) => void }) {
  return (
    <div className="pop__list" role="listbox">
      {options.map((option) => (
        <button type="button" role="option" aria-selected={option.value === value} key={option.value} className={`pop__item${option.value === value ? ' is-selected' : ''}`} onClick={() => onPick(option.value)}>
          <span className="grow">{option.label}</span>
          {option.count != null && <span className="t-caption muted tabular">{fmtCount(option.count)}</span>}
          {option.value === value && <Icon name="check" className="ms-16" />}
        </button>
      ))}
    </div>
  );
}

function Toolbar(props: {
  menu: Menu; setMenu: (menu: Menu) => void;
  from: string; to: string; years: number[];
  categoryRows: Category[]; subRows: Subcategory[]; base: TransactionRow[]; catFilter: string[]; subFilter: number[];
  matchesCategory: (txn: TransactionRow, cats: string[], subs: number[]) => boolean;
  accountNames: string[]; accountFilter: string;
  peopleRows: { id: number; name: string }[]; personFilter: string;
  direction: Direction | ''; minParam: string; maxParam: string;
  reviewOnly: boolean; reviewTotal: number;
  columns: { account: boolean; person: boolean }; setColumns: (update: (current: { account: boolean; person: boolean }) => { account: boolean; person: boolean }) => void;
  updateParams: (patch: Record<string, string | null>, replace?: boolean) => void;
  onExport: () => void;
}) {
  const { menu, setMenu, from, to, years, updateParams } = props;
  const now = new Date();
  const thisMonth = { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: lastDayOfMonth(now.getFullYear(), now.getMonth() + 1) };
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = { from: `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}-01`, to: lastDayOfMonth(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1) };
  const periodOptions = [
    { value: '|', label: 'All time' },
    { value: `${thisMonth.from}|${thisMonth.to}`, label: 'This month' },
    { value: `${lastMonth.from}|${lastMonth.to}`, label: 'Last month' },
    ...years.map((year) => ({ value: `${year}-01-01|${year}-12-31`, label: String(year) })),
  ];
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  useEffect(() => { setDraftFrom(from); setDraftTo(to); }, [from, to, menu]);

  // Category popover draft
  const [catQuery, setCatQuery] = useState('');
  const [draftCats, setDraftCats] = useState<string[]>(props.catFilter);
  const [draftSubs, setDraftSubs] = useState<number[]>(props.subFilter);
  useEffect(() => {
    if (menu === 'category') { setDraftCats(props.catFilter); setDraftSubs(props.subFilter); setCatQuery(''); }
  }, [menu]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => {
    const byCat = new Map<string, number>();
    const bySub = new Map<number, number>();
    if (menu !== 'category') return { byCat, bySub };
    for (const txn of props.base) {
      const key = txn.categoryId == null ? 'uncategorized' : String(txn.categoryId);
      byCat.set(key, (byCat.get(key) ?? 0) + 1);
      if (txn.subcategoryId != null) bySub.set(txn.subcategoryId, (bySub.get(txn.subcategoryId) ?? 0) + 1);
    }
    return { byCat, bySub };
  }, [menu, props.base]);
  const showCount = menu === 'category' ? props.base.filter((txn) => props.matchesCategory(txn, draftCats, draftSubs)).length : 0;
  const q = catQuery.trim().toLowerCase();
  const catOptions: { key: string; emoji: string; label: string; count: number; on: boolean; toggle: () => void }[] = [];
  if (menu === 'category') {
    const toggleCat = (key: string) => setDraftCats((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
    for (const cat of props.categoryRows) {
      if (!q || cat.name.toLowerCase().includes(q)) {
        catOptions.push({ key: `c${cat.id}`, emoji: cat.emoji || '•', label: cat.name, count: counts.byCat.get(String(cat.id)) ?? 0, on: draftCats.includes(String(cat.id)), toggle: () => toggleCat(String(cat.id)) });
      }
    }
    if (q) {
      for (const sub of props.subRows) {
        const cat = props.categoryRows.find((item) => item.id === sub.categoryId);
        if (!cat || sub.isArchived || !sub.name.toLowerCase().includes(q) || cat.name.toLowerCase().includes(q)) continue;
        catOptions.push({
          key: `s${sub.id}`, emoji: cat.emoji || '•', label: `${cat.name} · ${sub.name}`, count: counts.bySub.get(sub.id) ?? 0, on: draftSubs.includes(sub.id),
          toggle: () => setDraftSubs((current) => current.includes(sub.id) ? current.filter((item) => item !== sub.id) : [...current, sub.id]),
        });
      }
    }
    if (!q || 'uncategorized'.includes(q)) {
      catOptions.push({ key: 'uncategorized', emoji: '❔', label: 'Uncategorized', count: counts.byCat.get('uncategorized') ?? 0, on: draftCats.includes('uncategorized'), toggle: () => toggleCat('uncategorized') });
    }
  }
  const catSet = props.catFilter.length + props.subFilter.length > 0;
  const catLabel = !catSet ? 'Category' : props.catFilter.length + props.subFilter.length === 1
    ? (props.catFilter[0] === 'uncategorized' ? 'Uncategorized' : props.catFilter.length
      ? props.categoryRows.find((cat) => String(cat.id) === props.catFilter[0])?.name ?? 'Category'
      : props.subRows.find((sub) => sub.id === props.subFilter[0])?.name ?? 'Category')
    : `Category · ${props.catFilter.length + props.subFilter.length}`;

  const [draftMin, setDraftMin] = useState(props.minParam);
  const [draftMax, setDraftMax] = useState(props.maxParam);
  useEffect(() => { setDraftMin(props.minParam); setDraftMax(props.maxParam); }, [props.minParam, props.maxParam, menu]);

  const accountLabel = props.accountFilter || 'Account';
  const personName = props.personFilter === 'unset' ? 'Not set' : props.peopleRows.find((person) => String(person.id) === props.personFilter)?.name;
  const pick = (patch: Record<string, string | null>) => { updateParams(patch); setMenu(null); };

  return (
    <div className="toolbar toolbar--scroll">
      <ChipMenu id="period" menu={menu} setMenu={setMenu} icon="calendar_month" label={periodLabel(from, to)} set={!!(from || to)} width={280}>
        <OptionList options={periodOptions} value={`${from}|${to}`} onPick={(value) => { const [f, t] = value.split('|'); pick({ from: f || null, to: t || null }); }} />
        <div className="act-range" style={{ borderTop: 'var(--hairline) solid var(--border)' }}>
          <label className="field"><span className="field__label">From</span><span className="field__box field__box--sm"><input className="act-input" type="date" aria-label="From date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} /></span></label>
          <label className="field"><span className="field__label">To</span><span className="field__box field__box--sm"><input className="act-input" type="date" aria-label="To date" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} /></span></label>
        </div>
        <div className="pop__foot"><button type="button" className="btn btn--sm btn--ghost" onClick={() => pick({ from: null, to: null })}>Clear</button><button type="button" className="btn btn--sm btn--primary" onClick={() => pick({ from: draftFrom || null, to: draftTo || null })}>Apply range</button></div>
      </ChipMenu>

      <ChipMenu id="category" menu={menu} setMenu={setMenu} label={catLabel} set={catSet} width={300}>
        <div className="pop__search"><label className="field__box field__box--sm is-focused"><Icon name="search" className="muted" />
          <input className="act-input grow" autoFocus aria-label="Search categories" placeholder="Search categories" value={catQuery} onChange={(event) => setCatQuery(event.target.value)} /></label></div>
        <div className="pop__list" role="group" aria-label="Categories">
          {catOptions.map((option) => (
            <div key={option.key} className="pop__item" role="checkbox" aria-checked={option.on} tabIndex={0} onClick={option.toggle}
              onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); option.toggle(); } }}>
              <span className={`cb${option.on ? ' is-on' : ''}`} aria-hidden="true"><Icon name="check" /></span><span>{option.emoji}</span><span className="grow">{option.label}</span><span className="t-caption muted tabular">{fmtCount(option.count)}</span>
            </div>
          ))}
          {!catOptions.length && <div className="pop__item muted" style={{ cursor: 'default' }}>No categories match</div>}
        </div>
        <div className="pop__foot">
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setDraftCats([]); setDraftSubs([]); pick({ category: null, subcategory: null }); }}>Clear</button>
          <button type="button" className="btn btn--sm btn--primary" onClick={() => pick({ category: draftCats.join(',') || null, subcategory: draftSubs.join(',') || null })}>Show {fmtCount(showCount)}</button>
        </div>
      </ChipMenu>

      <ChipMenu id="account" menu={menu} setMenu={setMenu} label={accountLabel} set={!!props.accountFilter}>
        <OptionList options={[{ value: '', label: 'All accounts' }, ...props.accountNames.map((name) => ({ value: name, label: name }))]} value={props.accountFilter} onPick={(value) => pick({ account: value || null })} />
      </ChipMenu>

      <ChipMenu id="person" menu={menu} setMenu={setMenu} label={personName ? `For: ${personName}` : 'For'} set={!!props.personFilter}>
        <OptionList options={[{ value: '', label: 'Everyone' }, { value: 'unset', label: 'Not set' }, ...props.peopleRows.map((person) => ({ value: String(person.id), label: person.name }))]} value={props.personFilter} onPick={(value) => pick({ person: value || null })} />
      </ChipMenu>

      <ChipMenu id="direction" menu={menu} setMenu={setMenu} label={props.direction ? DIRECTION_LABELS[props.direction] : 'Money in & out'} set={!!props.direction}>
        <OptionList<Direction | ''> options={[{ value: '', label: 'Money in & out' }, { value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }, { value: 'self', label: 'Self-transfers' }]} value={props.direction} onPick={(value) => pick({ direction: value || null })} />
      </ChipMenu>

      <ChipMenu id="amount" menu={menu} setMenu={setMenu} label={amountLabel(props.minParam, props.maxParam)} set={!!(props.minParam || props.maxParam)} width={280}>
        <form onSubmit={(event) => { event.preventDefault(); pick({ min: draftMin.trim() || null, max: draftMax.trim() || null }); }}>
          <div className="act-range">
            <label className="field"><span className="field__label">Min ₹</span><span className="field__box field__box--sm"><input className="act-input" inputMode="decimal" autoFocus aria-label="Minimum amount in rupees" value={draftMin} onChange={(event) => setDraftMin(event.target.value)} /></span></label>
            <label className="field"><span className="field__label">Max ₹</span><span className="field__box field__box--sm"><input className="act-input" inputMode="decimal" aria-label="Maximum amount in rupees" value={draftMax} onChange={(event) => setDraftMax(event.target.value)} /></span></label>
          </div>
          <div className="pop__foot"><button type="button" className="btn btn--sm btn--ghost" onClick={() => pick({ min: null, max: null })}>Clear</button><button type="submit" className="btn btn--sm btn--primary">Apply</button></div>
        </form>
      </ChipMenu>

      <button type="button" className={`chip chip--btn chip--review${props.reviewOnly ? ' is-set' : ''}`} aria-pressed={props.reviewOnly} onClick={() => updateParams({ review: props.reviewOnly ? null : '1' })}>
        <Icon name="flag" />Needs review{props.reviewTotal > 0 && <span className="pill-count">{fmtCount(props.reviewTotal)}</span>}
      </button>
      <span className="toolbar__spacer hide-phone"></span>
      <ColumnsMenu menu={menu} setMenu={setMenu} columns={props.columns} setColumns={props.setColumns} />
      <button type="button" className="btn btn--sm" aria-label="Export" onClick={props.onExport}><Icon name="ios_share" /><span className="hide-phone">Export</span></button>
    </div>
  );
}

function ColumnsMenu({ menu, setMenu, columns, setColumns }: {
  menu: Menu; setMenu: (menu: Menu) => void;
  columns: { account: boolean; person: boolean }; setColumns: (update: (current: { account: boolean; person: boolean }) => { account: boolean; person: boolean }) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const open = menu === 'columns';
  const close = useCallback(() => setMenu(null), [setMenu]);
  useDismiss(open, ref, close);
  const options: { key: 'account' | 'person'; label: string }[] = [{ key: 'account', label: 'Account' }, { key: 'person', label: 'For' }];
  return (
    <span className="anchor hide-tablet" ref={ref}>
      <button type="button" className="btn btn--sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setMenu(open ? null : 'columns')}><Icon name="view_column" />Columns</button>
      {open && (
        <div className="pop" role="dialog" aria-label="Columns" style={{ top: 38, right: 0, width: 220 }}>
          <div className="pop__list">
            {options.map((option) => (
              <div key={option.key} className="pop__item" role="checkbox" aria-checked={columns[option.key]} tabIndex={0}
                onClick={() => setColumns((current) => ({ ...current, [option.key]: !current[option.key] }))}
                onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setColumns((current) => ({ ...current, [option.key]: !current[option.key] })); } }}>
                <span className={`cb${columns[option.key] ? ' is-on' : ''}`} aria-hidden="true"><Icon name="check" /></span><span className="grow">{option.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

/* ---------------- Detail panel body ---------------- */

function TransactionDetail({
  txn, rows, categoryRows, subRows, categoryMap, subMap, peopleRows, paymentModeRows, importRows, loans, statements, loanLinked, pickerOpen, setPickerOpen, run, onError, onDeleted,
}: {
  txn: TransactionRow;
  rows: TransactionRow[];
  categoryRows: Category[];
  subRows: Subcategory[];
  categoryMap: Map<number, Category>;
  subMap: Map<number, Subcategory>;
  peopleRows: { id: number; name: string }[];
  paymentModeRows: { id: number; name: string }[];
  importRows: Map<number, typeof imports.$inferSelect>;
  loans: LoanRow[];
  statements: (typeof imports.$inferSelect)[];
  loanLinked: boolean;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  run: (action: () => void) => void;
  onError: (message: string) => void;
  onDeleted: () => void;
}) {
  const db = getDb();
  const [tab, setTab] = useState<'ov' | 'dt'>('ov');
  const [editingNote, setEditingNote] = useState(false);
  const [lendOpen, setLendOpen] = useState(false);
  const [loanActionsOpen, setLoanActionsOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [attachLoanId, setAttachLoanId] = useState('');
  const [attachFlow, setAttachFlow] = useState<LoanFlow>(defaultLoanFlow(txn.direction));
  const [creatingLoan, setCreatingLoan] = useState(false);
  const [newLoanKind, setNewLoanKind] = useState<LoanKind>(txn.direction === 'in' ? 'borrowed' : 'lent');
  const [newLoanPersonId, setNewLoanPersonId] = useState('');
  const [newPersonName, setNewPersonName] = useState('');
  const [newLoanName, setNewLoanName] = useState('');
  const [splitRows, setSplitRows] = useState<SplitDraft[]>([{ loanId: '', flow: defaultLoanFlow(txn.direction), amount: '' }]);
  const [linkStatementId, setLinkStatementId] = useState('');
  const catRef = useRef<HTMLDivElement>(null);
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
  const [pickerTop, setPickerTop] = useState(236);
  useLayoutEffect(() => {
    if (pickerOpen && tab !== 'ov') { setTab('ov'); return; }
    if (!pickerOpen || !catRef.current) return;
    const panel = catRef.current.closest<HTMLElement>('.w-panel');
    setPanelEl(panel);
    // Like the mock, the picker is pinned to the panel and overlaps the category card slightly.
    if (panel) setPickerTop(Math.max(60, Math.round(catRef.current.getBoundingClientRect().top - panel.getBoundingClientRect().top + 24)));
  }, [pickerOpen, tab]);

  const out = isOutgoing(txn);
  const review = txn.needsReview;
  const category = txn.categoryId == null ? null : categoryMap.get(txn.categoryId) ?? null;
  const sub = txn.subcategoryId == null ? null : subMap.get(txn.subcategoryId) ?? null;
  const catText = category ? `${category.name}${sub ? ` · ${sub.name}` : ''}` : 'Uncategorized';
  const payee = payeeOf(txn);
  const importRow = txn.importId == null ? null : importRows.get(txn.importId) ?? null;
  const linkedStatement = txn.linkedImportId == null ? null : statements.find((item) => item.id === txn.linkedImportId) ?? importRows.get(txn.linkedImportId) ?? null;
  const isSelf = txn.direction === 'self';
  const selfLocked = txn.transferRole != null || txn.loanId != null || txn.linkedImportId != null;
  const lent = txn.loanId != null || loanLinked;
  const card = txn.linkedImportId != null;
  const personNameOf = (id: number) => peopleRows.find((item) => item.id === id)?.name ?? 'Someone';
  const loanLabel = (loan: LoanRow) => `${personNameOf(loan.personId)}${loan.name ? ` · ${loan.name}` : ''} · ${loan.kind === 'borrowed' ? 'borrowed' : 'lent'}`;
  const loanName = (id: number | null) => { const loan = loans.find((item) => item.id === id); return loan ? loanLabel(loan) : `Loan #${id}`; };
  const allocations = db.select().from(loanAllocations).where(eq(loanAllocations.txnId, txn.id)).all();
  const kindOf = (id: number) => loans.find((loan) => loan.id === id)?.kind as LoanKind | undefined;
  const partOf = (part: string | null): LoanPart | null => part === 'principal' || part === 'repayment' || part === 'interest' ? part : null;
  const openLoans = loans.filter((loan) => !loan.closed || loan.id === txn.loanId || allocations.some((item) => item.loanId === loan.id));
  const toggleLending = () => {
    if (lent) {
      setLoanActionsOpen((value) => !value);
      setLendOpen(false);
    } else setLendOpen((value) => !value);
    setCardOpen(false);
  };
  const editLoanAttachment = () => {
    setAttachLoanId(txn.loanId == null ? '' : String(txn.loanId));
    setAttachFlow((txn.loanId != null && loanFlowOf(kindOf(txn.loanId) ?? 'lent', loanPartOf(txn.transferRole))) || defaultLoanFlow(txn.direction));
    setCreatingLoan(false);
    setSplitRows(allocations.length ? allocations.map((item) => ({
      loanId: String(item.loanId),
      flow: loanFlowOf(kindOf(item.loanId) ?? 'lent', partOf(item.part) ?? loanPartOf(txn.transferRole)) ?? defaultLoanFlow(txn.direction),
      amount: String(item.paise / 100),
    })) : [{ loanId: '', flow: defaultLoanFlow(txn.direction), amount: '' }]);
    setLoanActionsOpen(false);
    setLendOpen(true);
  };
  // Paid must be a debit and Received a credit; interest follows the loan's kind.
  const attachKind: LoanKind | null = creatingLoan ? newLoanKind : kindOf(Number(attachLoanId)) ?? null;
  const attachError = attachKind ? loanFlowError(attachKind, attachFlow, txn.direction) : null;
  const canAttach = attachError == null && (creatingLoan ? newLoanPersonId !== '' : attachLoanId !== '');
  const splitErrors = splitRows.map((row) => {
    const kind = row.loanId ? kindOf(Number(row.loanId)) : undefined;
    return kind ? loanFlowError(kind, row.flow, txn.direction) : null;
  });
  const submitAttach = () => run(() => {
    let loanId = Number(attachLoanId);
    if (creatingLoan) loanId = createLoan({ name: newLoanName.trim(), personId: Number(newLoanPersonId), kind: newLoanKind });
    attachTransactionToLoan(txn.id, loanId, loanPartForFlow(attachKind ?? 'lent', attachFlow));
    setAttachLoanId('');
    setCreatingLoan(false);
    setNewLoanName('');
    setLendOpen(false);
    setLoanActionsOpen(false);
  });
  const addNewPerson = () => {
    const name = newPersonName.trim();
    if (!name) return;
    run(() => { setNewLoanPersonId(String(addPerson(name))); setNewPersonName(''); });
  };
  const othersSamePayee = txn.counterpartyName ? rows.filter((row) => row.id !== txn.id && row.counterpartyName === txn.counterpartyName) : [];
  const matchingStatements = cardOpen && !card ? matchingCardStatementsQuery(db, txn.paise).all() : [];

  // Suggestions: the current guess (accepting it) plus categories used for the same payee before.
  const suggestions = useMemo(() => {
    if (!review) return [];
    const list: { key: string; label: string; emoji: string; apply: () => void }[] = [];
    if (category) list.push({ key: 'guess', label: catText, emoji: category.emoji || '•', apply: () => run(() => acceptTransactionReview(txn.id)) });
    const tally = new Map<string, { categoryId: number; subId: number | null; count: number }>();
    for (const row of othersSamePayee) {
      if (row.categoryId == null || row.needsReview) continue;
      const key = `${row.categoryId}:${row.subcategoryId ?? ''}`;
      const entry = tally.get(key) ?? { categoryId: row.categoryId, subId: row.subcategoryId, count: 0 };
      entry.count += 1;
      tally.set(key, entry);
    }
    for (const entry of [...tally.values()].sort((a, b) => b.count - a.count)) {
      if (list.length >= 2) break;
      if (entry.categoryId === txn.categoryId && entry.subId === txn.subcategoryId) continue;
      const cat = categoryMap.get(entry.categoryId);
      if (!cat) continue;
      const subName = entry.subId == null ? '' : subMap.get(entry.subId)?.name ?? '';
      list.push({ key: `${entry.categoryId}:${entry.subId}`, label: `${cat.name}${subName ? ` · ${subName}` : ''}`, emoji: cat.emoji || '•', apply: () => run(() => setTransactionCategory(txn.id, entry.categoryId, entry.subId)) });
    }
    return list;
  }, [review, txn, category, catText, othersSamePayee, categoryMap, subMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const chips: { key: string; icon: string; label: string; on: boolean; disabled?: boolean; toggle: () => void }[] = out
    ? [
      { key: 'self', icon: 'swap_horiz', label: 'Self-transfer', on: isSelf, disabled: !isSelf && selfLocked, toggle: () => run(() => setTransactionSelfTransfer(txn.id, !isSelf)) },
      { key: 'lent', icon: 'group', label: 'Money lent', on: lent, toggle: toggleLending },
      { key: 'card', icon: 'credit_card', label: 'Card bill', on: card, disabled: isSelf, toggle: () => { setCardOpen((value) => !value); setLendOpen(false); setLoanActionsOpen(false); } },
    ]
    : [
      { key: 'refund', icon: 'undo', label: 'Refund', on: txn.isRefund, disabled: isSelf, toggle: () => run(() => setTransactionRefund(txn.id, !txn.isRefund)) },
      { key: 'self', icon: 'swap_horiz', label: 'Self-transfer', on: isSelf, disabled: !isSelf && selfLocked, toggle: () => run(() => setTransactionSelfTransfer(txn.id, !isSelf)) },
      { key: 'lent', icon: 'group', label: 'Money lent', on: lent, toggle: toggleLending },
    ];

  const personName = txn.personId == null ? 'Not set' : peopleRows.find((item) => item.id === txn.personId)?.name ?? 'Not set';
  const modeName = txn.paymentModeId == null ? 'Not set' : paymentModeRows.find((item) => item.id === txn.paymentModeId)?.name ?? 'Not set';
  const statementCaption = [importRow?.sourceLabel || sourceLabel(txn.source), txn.sourceRef ? 'UPI reference' : '', 'original text'].filter(Boolean).join(', ');
  const tabKey = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); setTab(tab === 'ov' ? 'dt' : 'ov'); }
  };

  return (
    <>
      <div className="dp-head">
        <div className="dp-title">
          <span className={`dp-badge ${out ? 'g-spend' : 'g-income'}`} style={{ background: `var(--${out ? 'spend' : 'income'}-muted)`, color: `var(--${out ? 'spend' : 'income'})` }}><Icon name={isSelf ? 'swap_horiz' : out ? 'north_east' : 'south_west'} /></span>
          <span className="t-heading grow truncate">{payee}</span>
          <span className={`dp-amount ${amountClass(txn) || ''}`}>{formatInr(signedPaise(txn), { sign: true })}</span>
        </div>
        <span className="t-small muted">{isSelf ? 'Self-transfer' : out ? 'Money out' : 'Money in'} · {longDate(txn.isoDate)}{txn.time ? ` · ${time12(txn.time)}` : ''}</span>
      </div>
      <div className="dp-tabs" role="tablist" aria-label="Transaction sections">
        <button type="button" role="tab" aria-selected={tab === 'ov'} className={`dp-tab${tab === 'ov' ? ' is-selected' : ''}`} onClick={() => setTab('ov')} onKeyDown={tabKey}>Overview</button>
        <button type="button" role="tab" aria-selected={tab === 'dt'} className={`dp-tab${tab === 'dt' ? ' is-selected' : ''}`} onClick={() => setTab('dt')} onKeyDown={tabKey}>Details</button>
      </div>

      {tab === 'ov' && (
        <div className="col gap-4" role="tabpanel" aria-label="Overview">
          <div className="dp-section"><span className="t-overline muted">CATEGORY</span>
            <div className={`dp-cat${review ? ' dp-cat--review' : ''}`} ref={catRef}>
              <span className="dp-cat__em">{review ? '❔' : category?.emoji || (category ? '•' : '❔')}</span>
              <div className="grow col gap-0" style={{ minWidth: 0 }}>
                <span className="t-label truncate">{review ? 'Needs a category' : catText}</span>
                <span className={`t-caption ${review ? 'c-review' : 'muted'}`}>{review
                  ? 'Couldn’t match this payee. Pick one and it will be remembered.'
                  : !category ? 'Not counted in any category yet' : txn.autoCategorized ? 'Auto-categorized from payee' : 'Set by you'}</span>
              </div>
              <span className="anchor"><button type="button" className="btn btn--sm" aria-haspopup="dialog" aria-expanded={pickerOpen} aria-keyshortcuts="e" onClick={() => setPickerOpen(!pickerOpen)}>{review || !category ? 'Pick' : 'Change'}<span className="kbd" style={{ marginLeft: 4 }}>e</span></button></span>
              <button type="button" className="icon-btn icon-btn--sm" title="Re-categorize" aria-label="Re-categorize" onClick={() => run(() => { recategorizeTransaction(txn.id); })}><Icon name="refresh" /></button>
            </div>
            {suggestions.length > 0 && (
              <div className="row wrap gap-1"><span className="t-caption muted">Suggested:</span>
                {suggestions.map((item) => <button type="button" key={item.key} className="chip" title={item.key === 'guess' ? 'Accept this suggestion' : 'Use this category'} onClick={item.apply}>{item.emoji} {item.label}</button>)}
              </div>
            )}
          </div>

          <div className="dp-section"><span className="t-overline muted">HOW IT’S COUNTED</span>
            <div className="toggle-chips">
              {chips.map((chip) => (
                <button type="button" key={chip.key} className={`tchip${chip.on ? ' is-on' : ''}`} aria-pressed={chip.on} disabled={chip.disabled} onClick={chip.toggle}>
                  <Icon name={chip.on ? 'check' : chip.icon} />{chip.label}
                </button>
              ))}
            </div>
            {isSelf && <span className="t-caption muted">Self-transfers move money between your own accounts, so they aren’t counted as spending.</span>}
            {lent && (
              <div className="card card--subtle col gap-2">
                <button type="button" className="lrow lrow--click act-loan-item" aria-label="Attached loan" aria-expanded={loanActionsOpen || lendOpen} onClick={toggleLending}>
                  <Icon name="group" />
                  <span className="grow col gap-1">
                    <span className="t-caption muted">{allocations.length ? 'Split across loans' : 'Attached to'}</span>
                    {txn.loanId != null ? <b className="t-small">{loanName(txn.loanId)}{isTransferRole(txn.transferRole) ? ` · ${ROLE_META[txn.transferRole].label}` : ''}</b>
                      : allocations.length ? allocations.map((item) => <span className="t-small" key={item.id}>{loanName(item.loanId)} · {loanFlowLabel(loanFlowOf(kindOf(item.loanId) ?? 'lent', partOf(item.part) ?? loanPartOf(txn.transferRole)))} · {inr(item.paise)}</span>)
                        : <span className="t-small">{isTransferRole(txn.transferRole) ? ROLE_META[txn.transferRole].label : 'Money lent'}</span>}
                  </span>
                  <Icon name={loanActionsOpen || lendOpen ? 'expand_less' : 'chevron_right'} />
                </button>
                {loanActionsOpen && (
                  <div className="row gap-2">
                    <button type="button" className="btn btn--sm" onClick={editLoanAttachment}><Icon name="edit" />Edit loan attachment</button>
                    <button type="button" className="btn btn--sm" onClick={() => run(() => { detachTransactionFromLoan(txn.id); setLoanActionsOpen(false); setLendOpen(false); })}><Icon name="link_off" />Remove from transaction</button>
                  </div>
                )}
              </div>
            )}
            {lendOpen && (
              <div className="card card--subtle col gap-2">
                <div className="row row--between gap-2">
                  <span className="t-small-em">{lent ? 'Edit loan attachment' : 'Add to Money Lent'}</span>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setLendOpen(false)}>Cancel</button>
                </div>
                <div className="seg" role="radiogroup" aria-label="Loan">
                  <button type="button" role="radio" aria-checked={!creatingLoan} className={`seg__item${creatingLoan ? '' : ' is-selected'}`} onClick={() => setCreatingLoan(false)}>Existing loan</button>
                  <button type="button" role="radio" aria-checked={creatingLoan} className={`seg__item${creatingLoan ? ' is-selected' : ''}`} onClick={() => setCreatingLoan(true)}><Icon name="add" />New loan</button>
                </div>
                {creatingLoan ? (
                  <div className="col gap-2">
                    <div className="seg" role="radiogroup" aria-label="New loan direction">
                      {(['lent', 'borrowed'] as const).map((kind) => (
                        <button type="button" key={kind} role="radio" aria-checked={newLoanKind === kind} className={`seg__item${newLoanKind === kind ? ' is-selected' : ''}`} onClick={() => setNewLoanKind(kind)}>{kind === 'lent' ? 'I lent' : 'I borrowed'}</button>
                      ))}
                    </div>
                    <SelectBox label="Person" value={newLoanPersonId} display={newLoanPersonId ? personNameOf(Number(newLoanPersonId)) : 'Choose a person…'} onChange={setNewLoanPersonId}>
                      <option value="">Choose a person…</option>{peopleRows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </SelectBox>
                    <div className="row gap-1">
                      <label className="field__box field__box--sm grow"><input className="act-input" aria-label="New person name" placeholder="Add a new person…" value={newPersonName} onChange={(event) => setNewPersonName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addNewPerson(); } }} /></label>
                      <button type="button" className="btn btn--sm" disabled={!newPersonName.trim()} onClick={addNewPerson}>Add</button>
                    </div>
                    <label className="field__box field__box--sm"><input className="act-input" aria-label="Loan name (optional)" placeholder="Loan name (optional), e.g. Wedding" value={newLoanName} onChange={(event) => setNewLoanName(event.target.value)} /></label>
                  </div>
                ) : openLoans.length > 0 ? (
                  <SelectBox label="Loan" value={attachLoanId} display={attachLoanId ? loanName(Number(attachLoanId)) : 'Choose a loan…'} onChange={setAttachLoanId}>
                    <option value="">Choose a loan…</option>{openLoans.map((loan) => <option key={loan.id} value={loan.id}>{loanLabel(loan)}</option>)}
                  </SelectBox>
                ) : (
                  <span className="t-small muted">No open loans yet. Choose <b>New loan</b> to create one.</span>
                )}
                <SelectBox label="Loan part" value={attachFlow} display={loanFlowLabel(attachFlow)} onChange={(value) => setAttachFlow(value as LoanFlow)}>
                  {LOAN_FLOWS.map((item) => <option key={item.flow} value={item.flow}>{item.label}</option>)}
                </SelectBox>
                {attachError && <span className="t-small c-spend" role="alert">{attachError}</span>}
                <button type="button" className="btn btn--sm btn--primary" style={{ alignSelf: 'flex-start' }} disabled={!canAttach} onClick={submitAttach}>{creatingLoan ? 'Create loan and add' : lent ? 'Save loan attachment' : 'Add to Money Lent'}</button>
                <span className="t-small-em">Split across loans</span>
                {splitRows.map((row, index) => (
                  <div className="col gap-1" key={index}><div className="row gap-1">
                    <div className="grow"><SelectBox label="Loan" value={row.loanId} display={row.loanId ? loanName(Number(row.loanId)) : 'Choose loan…'} onChange={(value) => setSplitRows((current) => current.map((item, i) => i === index ? { ...item, loanId: value } : item))}>
                      <option value="">Choose loan…</option>{openLoans.map((loan) => <option key={loan.id} value={loan.id}>{loanLabel(loan)}</option>)}
                    </SelectBox></div>
                    <SelectBox label="Split part" value={row.flow} display={loanFlowLabel(row.flow)} onChange={(value) => setSplitRows((current) => current.map((item, i) => i === index ? { ...item, flow: value as LoanFlow } : item))}>
                      {LOAN_FLOWS.map((item) => <option key={item.flow} value={item.flow}>{item.label}</option>)}
                    </SelectBox>
                    <label className="field__box field__box--sm" style={{ width: 96 }}><input className="act-input" inputMode="decimal" aria-label="Split amount in rupees" placeholder="₹" value={row.amount} onChange={(event) => setSplitRows((current) => current.map((item, i) => i === index ? { ...item, amount: event.target.value } : item))} /></label>
                    <button type="button" className="icon-btn icon-btn--sm icon-btn--plain" aria-label="Remove split row" onClick={() => setSplitRows((current) => current.filter((_, i) => i !== index))}><Icon name="close" /></button>
                  </div>{splitErrors[index] && <span className="t-small c-spend" role="alert">{splitErrors[index]}</span>}</div>
                ))}
                <div className="row gap-2">
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setSplitRows((current) => [...current, { loanId: '', flow: defaultLoanFlow(txn.direction), amount: '' }])}><Icon name="add" />Add slice</button>
                  <button type="button" className="btn btn--sm btn--primary" disabled={splitErrors.some(Boolean)} onClick={() => run(() => {
                    splitTransactionAcrossLoans(txn.id, splitRows.map((row) => ({ loanId: Number(row.loanId), part: loanPartForFlow(kindOf(Number(row.loanId)) ?? 'lent', row.flow), paise: Math.round(Number(row.amount) * 100) })));
                    setLendOpen(false);
                    setLoanActionsOpen(false);
                  })}>Save split</button>
                </div>
              </div>
            )}
            {cardOpen && (
              <div className="card card--subtle col gap-2">
                {card ? (
                  <div className="row row--between gap-2"><span className="t-small">Settles <b>{linkedStatement?.sourceLabel ?? `Import #${txn.linkedImportId}`}</b></span>
                    <button type="button" className="btn btn--sm" onClick={() => run(() => unlinkCardStatement(txn.id))}>Unlink card bill</button></div>
                ) : (
                  <>
                    <span className="t-small muted">Link this payment to the card statement it settled. Matching statements are suggested by exact payment amount.</span>
                    <SelectBox label="Card statement" value={linkStatementId} display={linkStatementId ? statements.find((item) => String(item.id) === linkStatementId)?.sourceLabel ?? 'Statement' : 'Choose statement…'} onChange={setLinkStatementId}>
                      <option value="">Choose statement…</option>
                      {matchingStatements.map((item) => <option key={item.id} value={item.id}>{item.sourceLabel} · {item.statementMonth ?? 'month unknown'} · {inr(item.totalDuePaise ?? 0)}</option>)}
                      {statements.filter((item) => !matchingStatements.some((match) => match.id === item.id)).map((item) => <option key={item.id} value={item.id}>{item.sourceLabel} · {item.statementMonth ?? 'month unknown'}</option>)}
                    </SelectBox>
                    <button type="button" className="btn btn--sm" style={{ alignSelf: 'flex-start' }} disabled={!linkStatementId} onClick={() => run(() => { linkTxnToCardStatement(txn.id, Number(linkStatementId)); setLinkStatementId(''); })}>Link statement</button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="dp-section"><div className="row row--between"><span className="t-overline muted">NOTES</span></div>
            {editingNote ? (
              <textarea className="note-box" autoFocus aria-label="Note" defaultValue={txn.note ?? ''} placeholder="Add a note…"
                onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); event.nativeEvent.stopImmediatePropagation(); setEditingNote(false); } }}
                onBlur={(event) => { const value = event.currentTarget.value; if (value !== (txn.note ?? '')) run(() => setTransactionNote(txn.id, value)); setEditingNote(false); }} />
            ) : txn.note?.trim() ? (
              <button type="button" className="note-box" aria-label="Edit note" onClick={() => setEditingNote(true)}>{txn.note}</button>
            ) : (
              <button type="button" className="note-box note-box--empty" onClick={() => setEditingNote(true)}><Icon name="edit" className="ms-16" /><span className="t-small">Add a note…</span></button>
            )}
          </div>

          <div className="grid grid-2" style={{ gap: 'var(--sp-2)' }}>
            <div className="field"><span className="field__label t-small">For</span>
              <SelectBox label="Transaction person" value={txn.personId == null ? '' : String(txn.personId)} display={personName} disabled={txn.loanId != null || txn.transferRole != null || loanLinked}
                onChange={(value) => run(() => setTransactionPerson(txn.id, value ? Number(value) : null))}>
                <option value="">Not set</option>{peopleRows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </SelectBox></div>
            <div className="field"><span className="field__label t-small">Payment mode</span>
              <SelectBox label="Transaction payment mode" value={txn.paymentModeId == null ? '' : String(txn.paymentModeId)} display={modeName}
                onChange={(value) => run(() => setTransactionPaymentMode(txn.id, value ? Number(value) : null))}>
                <option value="">Not set</option>{paymentModeRows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </SelectBox></div>
          </div>

          <button type="button" className="lrow lrow--click card card--none" style={{ padding: 'var(--sp-2) var(--sp-3)' }} onClick={() => setTab('dt')}>
            <Icon name="description" className="muted" />
            <div className="grow col gap-0" style={{ minWidth: 0 }}><span className="t-label">Statement details</span><span className="t-caption muted truncate">{statementCaption}</span></div>
            <Icon name="chevron_right" className="muted" />
          </button>
        </div>
      )}

      {tab === 'dt' && (
        <div className="col gap-4" role="tabpanel" aria-label="Details">
          <div className="dp-section"><span className="t-overline muted">TRANSACTION</span><div className="dl">
            <div className="dl__row"><span className="dl__k">Direction</span><span className="dl__v">{isSelf ? 'Self-transfer' : out ? 'Outgoing' : 'Incoming'}</span></div>
            <div className="dl__row"><span className="dl__k">Amount</span><span className="dl__v tabular">{formatInr(txn.paise)}</span></div>
            <div className="dl__row"><span className="dl__k">Date and time</span><span className="dl__v">{longDate(txn.isoDate)}{txn.time ? `, ${time12(txn.time)}` : ''}</span></div>
            <div className="dl__row"><span className="dl__k">{out ? 'Paid to' : 'Received from'}</span><span className="dl__v">{payee}{txn.counterpartyVpa ? ` · ${txn.counterpartyVpa}` : ''}</span></div>
            <div className="dl__row"><span className="dl__k">Account</span><span className="dl__v">{txn.accountName || '—'}</span></div>
          </div></div>
          <div className="dp-section"><span className="t-overline muted">PROVENANCE</span><div className="dl">
            <div className="dl__row"><span className="dl__k">Source</span><span className="dl__v">{sourceLabel(txn.source)}</span></div>
            {importRow && <div className="dl__row"><span className="dl__k">Imported from</span><span className="dl__v">{importRow.sourceLabel || '—'}</span></div>}
            {txn.importId != null && <div className="dl__row"><span className="dl__k">Import batch</span><span className="dl__v">#{txn.importId}{importRow ? ` · ${longDate(importRow.importedAt.slice(0, 10))}` : ''}</span></div>}
            <div className="dl__row"><span className="dl__k">UPI reference</span><span className="dl__v t-code" style={{ fontSize: 12 }}>{txn.sourceRef || '—'}</span></div>
            {txn.orderId && <div className="dl__row"><span className="dl__k">Order ID</span><span className="dl__v t-code" style={{ fontSize: 12 }}>{txn.orderId}</span></div>}
            <div className="dl__row"><span className="dl__k">Original text</span><span className="dl__v">{txn.rawDetails || '—'}</span></div>
            {txn.remarks && <div className="dl__row"><span className="dl__k">Imported remarks</span><span className="dl__v">{txn.remarks}</span></div>}
            {txn.linkedImportId != null && <div className="dl__row"><span className="dl__k">Card statement</span><span className="dl__v">{linkedStatement?.sourceLabel ?? `Import #${txn.linkedImportId}`}</span></div>}
            <div className="dl__row"><span className="dl__k">Record ID</span><span className="dl__v">#{txn.id}</span></div>
          </div></div>
          <button type="button" className="btn btn--danger btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => { if (window.confirm('Delete this transaction?')) run(() => { deleteTransaction(txn.id); onDeleted(); }); }}><Icon name="delete" />Delete transaction</button>
        </div>
      )}

      {pickerOpen && panelEl && createPortal(
        <CategoryPicker
          className="pop pop--in-panel"
          style={{ top: pickerTop }}
          categoryRows={categoryRows}
          subRows={subRows}
          initialCategoryId={txn.categoryId}
          initialSubId={txn.subcategoryId}
          suggestedSubId={review ? txn.subcategoryId : null}
          othersCount={othersSamePayee.length}
          payee={txn.counterpartyName ?? undefined}
          onClose={() => setPickerOpen(false)}
          onError={onError}
          onSave={(categoryId, subId, applyOthers) => run(() => {
            setTransactionCategory(txn.id, categoryId, subId);
            if (applyOthers) for (const row of othersSamePayee) setTransactionCategory(row.id, categoryId, subId, { learn: false });
            setPickerOpen(false);
          })}
        />,
        panelEl,
      )}
    </>
  );
}

/* ---------------- Standalone detail panel (used by other pages, e.g. Import) ---------------- */

/** The Activity transaction panel for one saved transaction, loading everything it needs itself. */
export function TransactionDetailPanel({ txnId, onClose, footerNote }: { txnId: number | null; onClose: () => void; footerNote?: ReactNode }) {
  const revision = useDatabaseRevision();
  const db = getDb();
  const open = txnId != null;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState('');
  const data = useMemo(() => {
    if (!open) return null;
    const categoryRows = db.select().from(categories).where(eq(categories.isArchived, false)).orderBy(asc(categories.sortOrder), asc(categories.id)).all();
    const subRows = db.select().from(subcategories).orderBy(asc(subcategories.sortOrder), asc(subcategories.id)).all();
    return {
      rows: getAllTransactions(),
      categoryRows,
      subRows,
      categoryMap: new Map(categoryRows.map((item) => [item.id, item])),
      subMap: new Map(subRows.map((item) => [item.id, item])),
      peopleRows: db.select().from(people).where(eq(people.isArchived, false)).orderBy(asc(people.sortOrder), asc(people.id)).all(),
      paymentModeRows: db.select().from(paymentModes).where(eq(paymentModes.isArchived, false)).orderBy(asc(paymentModes.sortOrder), asc(paymentModes.id)).all(),
      importRows: new Map(db.select().from(imports).all().map((row) => [row.id, row])),
      loanLinkedIds: new Set(db.select({ txnId: loanAllocations.txnId }).from(loanAllocations).all().map((row) => row.txnId)),
      loans: loansQuery(db).all(),
      statements: cardStatementsQuery(db).all(),
    };
  }, [db, open, revision]);
  const txn = data && txnId != null ? data.rows.find((row) => row.id === txnId) ?? null : null;
  useEffect(() => { setPickerOpen(false); setError(''); }, [txnId]);
  const run = (action: () => void) => {
    setError('');
    try { action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };

  return (
    // The Activity styles for panel controls are scoped to .act; display: contents keeps the panel a direct flex child.
    <div className="act" style={{ display: 'contents' }}>
    <DetailPanel
      open={open}
      onClose={onClose}
      label="Transaction detail"
      bar={<>
        <span className="t-overline muted">TRANSACTION</span>
        {txn && <Link className="btn btn--sm btn--ghost hide-phone" to={`/transactions?txn=${txn.id}`}>Open in Activity<Icon name="arrow_forward" /></Link>}
      </>}
      footer={<span className="save-note t-caption grow"><Icon name="cloud_done" />{footerNote ?? 'Changes save to Drive automatically'}</span>}
    >
      {error && <div className="banner banner--danger" role="alert"><Icon name="error" /><div className="banner__copy t-small">{error}</div></div>}
      {data && txn ? (
        <TransactionDetail
          key={txn.id}
          txn={txn}
          rows={data.rows}
          categoryRows={data.categoryRows}
          subRows={data.subRows}
          categoryMap={data.categoryMap}
          subMap={data.subMap}
          peopleRows={data.peopleRows}
          paymentModeRows={data.paymentModeRows}
          importRows={data.importRows}
          loans={data.loans}
          statements={data.statements}
          loanLinked={data.loanLinkedIds.has(txn.id)}
          pickerOpen={pickerOpen}
          setPickerOpen={setPickerOpen}
          run={run}
          onError={setError}
          onDeleted={onClose}
        />
      ) : open ? <span className="t-small muted">This transaction is no longer in your data.</span> : null}
    </DetailPanel>
    </div>
  );
}

/* ---------------- Bulk action bar ---------------- */

function BulkBar({ count, sum, categoryRows, subRows, peopleRows, onSetCategory, onSetPerson, onMarkReviewed, onDelete, onClear, onError }: {
  count: number; sum: number; categoryRows: Category[]; subRows: Subcategory[]; peopleRows: { id: number; name: string }[];
  onSetCategory: (categoryId: number, subId: number | null) => void; onSetPerson: (personId: number | null) => void;
  onMarkReviewed: () => void; onDelete: () => void; onClear: () => void; onError: (message: string) => void;
}) {
  const [open, setOpen] = useState<'category' | 'person' | null>(null);
  const personRef = useRef<HTMLSpanElement>(null);
  const closePerson = useCallback(() => setOpen(null), []);
  useDismiss(open === 'person', personRef, closePerson);
  return (
    <div className="bulk" role="toolbar" aria-label="Bulk actions">
      <span className="t-small-em">{fmtCount(count)} selected</span><span className="t-small muted tabular hide-phone">{formatInr(sum)}</span>
      <span className="bulk__sep hide-phone"></span>
      <span className="anchor">
        <button type="button" className="btn btn--sm" aria-haspopup="dialog" aria-expanded={open === 'category'} onClick={() => setOpen(open === 'category' ? null : 'category')}><Icon name="sell" /><span className="btn__label">Set category</span></button>
        {open === 'category' && (
          <CategoryPicker className="pop" categoryRows={categoryRows} subRows={subRows} initialCategoryId={null} initialSubId={null}
            onClose={() => setOpen(null)} onError={onError} onSave={(categoryId, subId) => { setOpen(null); onSetCategory(categoryId, subId); }} />
        )}
      </span>
      <span className="anchor" ref={personRef}>
        <button type="button" className="btn btn--sm" aria-haspopup="dialog" aria-expanded={open === 'person'} onClick={() => setOpen(open === 'person' ? null : 'person')}><Icon name="person" /><span className="btn__label">Set For</span></button>
        {open === 'person' && (
          <div className="pop" role="dialog" aria-label="Set For" style={{ width: 240 }}>
            <div className="pop__list">
              {peopleRows.map((person) => <button type="button" key={person.id} className="pop__item" onClick={() => { setOpen(null); onSetPerson(person.id); }}><span className="grow">{person.name}</span></button>)}
              <button type="button" className="pop__item muted" onClick={() => { setOpen(null); onSetPerson(null); }}>Not set</button>
            </div>
          </div>
        )}
      </span>
      <button type="button" className="btn btn--sm" onClick={onMarkReviewed}><Icon name="done_all" /><span className="btn__label">Mark reviewed</span></button>
      <button type="button" className="btn btn--sm btn--danger" onClick={onDelete}><Icon name="delete" /><span className="btn__label">Delete</span></button>
      <button type="button" className="icon-btn icon-btn--sm icon-btn--plain" aria-label="Clear selection" onClick={onClear}><Icon name="close" /></button>
    </div>
  );
}

/* ---------------- Export dialog ---------------- */

function ExportDialog({ years, rows, filtered, defaultYear, buildFilter, multiCategory, onClose, onDone, onError }: {
  years: number[]; rows: TransactionRow[]; filtered: TransactionRow[]; defaultYear: number;
  buildFilter: () => TxnFilter; multiCategory: boolean;
  onClose: () => void; onDone: (fileName: string) => void; onError: (message: string) => void;
}) {
  const [year, setYear] = useState<string>(years.includes(defaultYear) ? String(defaultYear) : 'all');
  const [include, setInclude] = useState<'filters' | 'all'>('filters');
  const [fileName, setFileName] = useState(`Expense_Tracker_${year === 'all' ? 'All' : year}`);
  const [nameEdited, setNameEdited] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDismiss(true, dialogRef, onClose);
  const inYear = (txn: TransactionRow) => year === 'all' || txn.isoDate.startsWith(`${year}-`);
  const filteredCount = filtered.filter(inYear).length;
  const allCount = rows.filter(inYear).length;
  const doExport = () => {
    try {
      const filter: TxnFilter = include === 'filters' ? buildFilter() : {};
      if (year !== 'all') {
        const y = Number(year);
        const ord = (key: { year: number; month: number }) => key.year * 12 + key.month;
        const fromKey = { year: y, month: 1 };
        const toKey = { year: y, month: 12 };
        filter.from = filter.from && ord(filter.from) > ord(fromKey) ? filter.from : fromKey;
        filter.to = filter.to && ord(filter.to) < ord(toKey) ? filter.to : toKey;
      }
      onDone(downloadExport(filter, fileName.trim() || 'Expense_Tracker'));
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
      onClose();
    }
  };
  return (
    <div className="w-modal">
      <div className="w-dialog" role="dialog" aria-modal="true" aria-labelledby="ex-t" ref={dialogRef}>
        <div className="w-dialog__head"><span className="w-dialog__icon"><Icon name="table_view" /></span>
          <div className="col gap-1"><span id="ex-t" className="t-heading">Export to Excel</span>
            <span className="t-small muted">A yearly workbook with one sheet per month, in the same layout as your tracker.</span></div></div>
        <div className="grid grid-2" style={{ gap: 'var(--sp-3)' }}>
          <div className="field"><span className="field__label">Year</span>
            <SelectBox small={false} label="Year" value={year} display={year === 'all' ? 'All years' : year} onChange={(value) => { setYear(value); if (!nameEdited) setFileName(`Expense_Tracker_${value === 'all' ? 'All' : value}`); }}>
              {years.map((item) => <option key={item} value={item}>{item}</option>)}<option value="all">All years</option>
            </SelectBox></div>
          <div className="field"><span className="field__label">Include</span>
            <SelectBox small={false} label="Include" value={include} display={include === 'filters' ? `Current filters · ${fmtCount(filteredCount)}` : `Everything · ${fmtCount(allCount)}`} onChange={(value) => setInclude(value as 'filters' | 'all')}>
              <option value="filters">Current filters · {fmtCount(filteredCount)}</option><option value="all">Everything · {fmtCount(allCount)}</option>
            </SelectBox></div>
        </div>
        {include === 'filters' && multiCategory && <span className="t-caption muted">Several categories are selected; the workbook includes every category for the other filters.</span>}
        <label className="field"><span className="field__label">File name</span>
          <span className="field__box"><input className="act-input grow" autoFocus aria-label="File name" value={fileName} onChange={(event) => { setFileName(event.target.value); setNameEdited(true); }} /><span className="muted">.xlsx</span></span></label>
        <div className="col gap-2">
          <span className="field__label">Save to</span>
          <div className="seg" role="radiogroup" aria-label="Save to">
            <button type="button" role="radio" aria-checked="true" className="seg__item is-selected"><Icon name="download" className="ms-16" />Download</button>
            <button type="button" role="radio" aria-checked="false" className="seg__item" disabled title="Saving exports to Drive is available in Settings"><Icon name="add_to_drive" className="ms-16" />Drive folder</button>
            <button type="button" role="radio" aria-checked="false" className="seg__item" disabled title="Saving exports to Drive is available in Settings">Both</button>
          </div>
        </div>
        <div className="w-dialog__actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn--primary" onClick={doExport}><Icon name="download" />Export</button></div>
      </div>
    </div>
  );
}
