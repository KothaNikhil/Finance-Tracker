import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { asc, sql } from 'drizzle-orm';
import type { TxnFilter } from '@finance-tracker/core/analytics/filter';
import {
  accountSpendQuery,
  categoryBreakdownQuery,
  merchantSpendQuery,
  monthlyForYearQuery,
  periodTotalsQuery,
  subcategoryBreakdownQuery,
  summaryQuery,
} from '@finance-tracker/core/db/queries/aggregates';
import { categories, subcategories, transactions } from '@finance-tracker/core/db/schema';
import { getDb } from '@finance-tracker/core/db/runtime';
import { supabase } from './auth';
import { useDatabaseRevision } from './feature-utils';
import { DetailPanel, Icon, MONTHS_LONG, MONTHS_SHORT, TopActions, formatInr } from './shell';
import './DashboardPage.css';

type PeriodMode = 'month' | 'year' | 'all';
type TrendMode = 'spent' | 'net' | 'received';
/** Category id, or 'uncategorized' for the empty bucket. */
type CategoryKey = number | 'uncategorized';

const TOP_CATEGORIES = 9;
const SOURCE_LABELS: Record<string, string> = { paytm: 'UPI', cc: 'Statement', bank: 'Bank', manual: 'Manual' };

const pad = (value: number) => String(value).padStart(2, '0');
const keyOf = (categoryId: number | null): CategoryKey => categoryId ?? 'uncategorized';
const filterIdOf = (key: CategoryKey) => (key === 'uncategorized' ? null : key);

function greeting(date: Date) {
  const hour = date.getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

/** Round a chart peak up to a "nice" axis maximum (52,719 → 60,000). */
function niceMax(peak: number) {
  if (peak <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(peak)) / 2;
  return Math.ceil((peak * 1.05) / step) * step;
}

function useFirstName() {
  const [name, setName] = useState('');
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      const meta = data.session?.user.user_metadata ?? {};
      const full = String(meta.full_name ?? meta.name ?? '').trim();
      if (active) setName(full.split(/\s+/)[0] ?? '');
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return name;
}

function Delta({ current, previous, label, upClass, downClass }: { current: number; previous: number; label: string; upClass: string; downClass: string }) {
  if (!previous) return <span className="t-caption muted">Nothing in {label}</span>;
  const change = Math.round(((current - previous) / previous) * 100);
  const up = change >= 0;
  return (
    <span className="t-caption muted kpi__delta">
      <Icon name={up ? 'arrow_upward' : 'arrow_downward'} className={up ? upClass : downClass} />
      {Math.abs(change)}% vs {label}
    </span>
  );
}

export function DashboardPage() {
  useDatabaseRevision();
  const db = getDb();
  const now = new Date();
  const firstName = useFirstName();
  const [mode, setMode] = useState<PeriodMode>('year');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [trendMode, setTrendMode] = useState<TrendMode>('spent');
  const [selectedKey, setSelectedKey] = useState<CategoryKey | null>(null);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const closePanel = useCallback(() => setSelectedKey(null), []);

  const filter = useMemo<TxnFilter>(() => {
    if (mode === 'all') return {};
    if (mode === 'month') return { from: { year, month }, to: { year, month } };
    return { from: { year, month: 1 }, to: { year, month: 12 } };
  }, [mode, year, month]);
  const previousFilter = useMemo<TxnFilter | null>(() => {
    if (mode === 'all') return null;
    if (mode === 'month') {
      const date = new Date(year, month - 2, 1);
      const key = { year: date.getFullYear(), month: date.getMonth() + 1 };
      return { from: key, to: key };
    }
    return { from: { year: year - 1, month: 1 }, to: { year: year - 1, month: 12 } };
  }, [mode, year, month]);

  const emptyTotals = { spentPaise: 0, receivedPaise: 0, refundPaise: 0, txnCount: 0 };
  const overall = summaryQuery(db, {}).get();
  const hasData = (overall?.savedCount ?? 0) > 0;
  const reviewCount = overall?.reviewCount ?? 0;
  const totals = periodTotalsQuery(db, filter).get() ?? emptyTotals;
  const previousTotals = previousFilter ? periodTotalsQuery(db, previousFilter).get() ?? emptyTotals : null;
  const trend = monthlyForYearQuery(db, year).all();
  const categoriesList = db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.id)).all();
  const subcategoryNames = new Map(db.select().from(subcategories).all().map((item) => [item.id, item.name]));
  const breakdown = categoryBreakdownQuery(db, filter, trendMode).all();
  const merchantSpend = merchantSpendQuery(db, filter, trendMode).all().slice(0, 8);
  const accountSpend = accountSpendQuery(db, filter, trendMode).all().slice(0, 6);
  const isIncome = trendMode === 'received';
  const amountLabel = isIncome ? 'Received' : trendMode === 'net' ? 'Net spent' : 'Spent';
  const emptyLabel = isIncome ? 'No income' : 'No spending';
  const accountKey = sql<string>`coalesce(nullif(trim(${transactions.accountName}), ''), '(unknown)')`;
  const accountSources = new Map<string, string>();
  for (const row of db.select({ key: accountKey, source: transactions.source, n: sql<number>`count(*)` })
    .from(transactions).groupBy(accountKey, transactions.source).orderBy(sql`count(*) desc`).all()) {
    if (!accountSources.has(row.key)) accountSources.set(row.key, row.source);
  }

  const categoryInfo = (key: CategoryKey) => {
    const category = key === 'uncategorized' ? null : categoriesList.find((item) => item.id === key);
    return { emoji: category?.emoji || (key === 'uncategorized' ? '❔' : '•'), name: category?.name ?? 'Uncategorized' };
  };
  const categoryTotal = breakdown.reduce((sum, item) => sum + item.spentPaise, 0);
  const share = (paise: number) => (categoryTotal > 0 ? (paise / categoryTotal) * 100 : 0);
  const topShare = breakdown.length ? share(breakdown[0].spentPaise) : 0;
  // Net rows can be negative (refunds above spend); their bars collapse to empty.
  const barWidth = (pct: number) => `${topShare > 0 ? Math.max(0, (pct / topShare) * 100) : 0}%`;
  const collapse = !showAllCategories && breakdown.length > TOP_CATEGORIES + 1;
  const visibleBreakdown = collapse ? breakdown.slice(0, TOP_CATEGORIES) : breakdown;
  const rest = collapse ? breakdown.slice(TOP_CATEGORIES) : [];
  const restPaise = rest.reduce((sum, item) => sum + item.spentPaise, 0);

  const trendRows = Array.from({ length: 12 }, (_, index) => {
    const row = trend.find((item) => item.month === index + 1);
    const value = trendMode === 'received'
      ? row?.receivedPaise ?? 0
      : trendMode === 'net'
        ? (row?.spentPaise ?? 0) - (row?.refundPaise ?? 0)
        : row?.spentPaise ?? 0;
    return { month: index + 1, value: Math.max(0, value) };
  });
  const chartMax = niceMax(Math.max(...trendRows.map((row) => row.value)));
  const activeRows = trendRows.filter((row) => row.value > 0);
  const maximum = trendRows.reduce((best, row) => (row.value > best.value ? row : best), trendRows[0]);
  const average = activeRows.length ? Math.round(activeRows.reduce((sum, row) => sum + row.value, 0) / activeRows.length) : 0;
  const selectedMonth = mode === 'month' ? month : -1;
  const tipRow = selectedMonth > 0 ? trendRows[selectedMonth - 1] : null;

  const periodTitle = mode === 'all' ? 'All time' : mode === 'month' ? `${MONTHS_LONG[month - 1]} ${year}` : String(year);
  const periodLabel = mode === 'all' ? 'All' : mode === 'month' ? `${MONTHS_SHORT[month - 1]} ${year}` : String(year);
  const periodName = mode === 'all' ? 'All time' : mode === 'month' ? `${MONTHS_SHORT[month - 1]} ${year}` : String(year);
  const previousLabel = mode === 'month' ? MONTHS_SHORT[(month + 10) % 12] : String(year - 1);
  const atLatest = year > now.getFullYear() || (year === now.getFullYear() && (mode !== 'month' || month >= now.getMonth() + 1));

  const activityLink = (categoryKey?: CategoryKey) => {
    const query = new URLSearchParams();
    if (mode !== 'all') {
      query.set('from', mode === 'month' ? `${year}-${pad(month)}-01` : `${year}-01-01`);
      query.set('to', mode === 'month' ? `${year}-${pad(month)}-31` : `${year}-12-31`);
    }
    if (categoryKey != null) query.set('category', String(categoryKey));
    // Net mixes spend with refunds (money in), so it can't be narrowed to one direction.
    if (trendMode !== 'net') query.set('direction', isIncome ? 'in' : 'out');
    const text = query.toString();
    return text ? `/transactions?${text}` : '/transactions';
  };

  const shiftPeriod = (amount: number) => {
    if (mode === 'month') {
      const date = new Date(year, month - 1 + amount, 1);
      setYear(date.getFullYear());
      setMonth(date.getMonth() + 1);
    } else {
      setYear((value) => value + amount);
    }
  };
  const selectMonth = (value: number) => {
    setMonth(value);
    setMode('month');
  };

  // Category detail panel data.
  const selectedRow = selectedKey == null ? null : breakdown.find((item) => keyOf(item.categoryId) === selectedKey) ?? null;
  const selectedInfo = selectedKey == null ? null : categoryInfo(selectedKey);
  const panelFilter: TxnFilter | null = selectedKey == null ? null : { ...filter, categoryId: filterIdOf(selectedKey) };
  const subRows = selectedKey == null
    ? []
    : selectedKey === 'uncategorized'
      ? (selectedRow ? [{ subcategoryId: null, spentPaise: selectedRow.spentPaise, txnCount: selectedRow.txnCount }] : [])
      : subcategoryBreakdownQuery(db, selectedKey, filter, trendMode).all();
  const panelPayees = panelFilter ? merchantSpendQuery(db, panelFilter, trendMode).all().slice(0, 3) : [];
  const miniRows = selectedKey == null
    ? []
    : MONTHS_SHORT.map((_, index) => {
      const key = { year, month: index + 1 };
      return Math.max(0, categoryBreakdownQuery(db, { from: key, to: key, categoryId: filterIdOf(selectedKey) }, trendMode).get()?.spentPaise ?? 0);
    });
  const miniMax = niceMax(Math.max(0, ...miniRows));

  if (!hasData) {
    return (
      <div className="w-body">
        <main className="w-main">
          <TopActions><Link className="btn btn--sm btn--primary hide-phone" to="/import"><Icon name="file_download" />Import</Link></TopActions>
          <div className="empty" style={{ marginTop: 'var(--sp-6)' }}>
            <span className="empty__icon"><Icon name="insights" /></span>
            <span className="t-heading">Nothing to show yet</span>
            <span className="t-small muted">Your Drive file has no transactions. Import statements here, or from the phone app. Both use the same file.</span>
            <Link className="btn btn--primary" to="/import"><Icon name="file_download" />Import statements</Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="w-body">
      <main className="w-main">
        <TopActions><Link className="btn btn--sm btn--primary hide-phone" to="/import"><Icon name="file_download" />Import</Link></TopActions>

        <div className="w-head">
          <div className="w-head__copy">
            <span className="t-small muted">{greeting(now)}{firstName ? `, ${firstName}` : ''}</span>
            <span className="t-title">{periodTitle}</span>
          </div>
          <div className="period">
            <div className="card card--none row gap-0" style={{ padding: 2 }}>
              <button type="button" className={`icon-btn icon-btn--plain icon-btn--sm${mode === 'all' ? ' is-disabled' : ''}`} aria-label="Previous" disabled={mode === 'all'} onClick={() => shiftPeriod(-1)}><Icon name="chevron_left" /></button>
              <span className="t-label tabular" style={{ minWidth: 70, textAlign: 'center' }} aria-live="polite">{periodLabel}</span>
              <button type="button" className={`icon-btn icon-btn--plain icon-btn--sm${mode === 'all' || atLatest ? ' is-disabled' : ''}`} aria-label="Next" disabled={mode === 'all' || atLatest} onClick={() => shiftPeriod(1)}><Icon name="chevron_right" /></button>
            </div>
            <div className="seg" role="group" aria-label="Period">
              {(['month', 'year', 'all'] as const).map((value) => (
                <button key={value} type="button" className={`seg__item${mode === value ? ' is-selected' : ''}`} aria-pressed={mode === value} onClick={() => setMode(value)}>
                  {value === 'all' ? 'All' : value === 'month' ? 'Month' : 'Year'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-4">
          <div className="card card--lg kpi kpi-card--hero"><span className="t-overline muted">NET SPENT</span><span className="kpi__value">{formatInr(totals.spentPaise - totals.refundPaise)}</span><span className="t-caption muted">{totals.txnCount.toLocaleString('en-IN')} counted transactions</span></div>
          <div className="card card--lg kpi"><span className="t-overline muted">SPENT</span><span className="kpi__value c-spend">{formatInr(totals.spentPaise)}</span>
            {previousTotals ? <Delta current={totals.spentPaise} previous={previousTotals.spentPaise} label={previousLabel} upClass="c-spend" downClass="c-income" /> : <span className="t-caption muted">All time</span>}</div>
          <div className="card card--lg kpi"><span className="t-overline muted">RECEIVED</span><span className="kpi__value c-income">{formatInr(totals.receivedPaise)}</span>
            {previousTotals ? <Delta current={totals.receivedPaise} previous={previousTotals.receivedPaise} label={previousLabel} upClass="c-income" downClass="c-spend" /> : <span className="t-caption muted">All time</span>}</div>
          <div className="card card--lg kpi"><span className="t-overline muted">REFUNDS &amp; CASHBACK</span><span className="kpi__value c-accent">{formatInr(totals.refundPaise)}</span><span className="t-caption muted">Taken off spending</span></div>
        </div>

        <div className="grid grid-main-side">
          <div className="card card--lg">
            <div className="card__head"><div className="col gap-0"><span className="t-heading">Monthly {trendMode === 'received' ? 'income' : 'spending'}</span><span className="t-caption muted">Click a month to see it in detail</span></div>
              <div className="seg hide-phone" style={{ width: 180 }} role="group" aria-label="Chart metric">
                {(['spent', 'net', 'received'] as const).map((value) => (
                  <button key={value} type="button" className={`seg__item${trendMode === value ? ' is-selected' : ''}`} aria-pressed={trendMode === value} onClick={() => setTrendMode(value)}>
                    {value === 'received' ? 'In' : value === 'net' ? 'Net' : 'Spent'}
                  </button>
                ))}
              </div></div>
            <div className="chart-wrap">
              <div className="chart-grid"><div /><div /><div /><div /></div>
              <div className="bars">
                {trendRows.map((row) => {
                  const label = `${MONTHS_SHORT[row.month - 1]} · ${formatInr(row.value)}`;
                  const selected = selectedMonth > 0 ? row.month === selectedMonth : row.value > 0;
                  return (
                    <button key={row.month} type="button" className={`bars__col${selected ? ' is-selected' : ''}${row.value ? '' : ' is-empty'}`} title={label} aria-label={`${MONTHS_LONG[row.month - 1]} ${year}: ${formatInr(row.value)}`} aria-pressed={row.month === selectedMonth} onClick={() => selectMonth(row.month)}>
                      <div className="bars__stack"><div className="bars__bar" style={{ height: `${row.value ? (row.value / chartMax) * 100 : 2}%` }} /></div>
                      <span className="bars__x">{MONTHS_SHORT[row.month - 1]}</span>
                    </button>
                  );
                })}
                {tipRow && (
                  <span className="chart-tip" style={{ left: `${((tipRow.month - 0.5) / 12) * 100}%`, top: `calc(var(--sp-2) + (100% - var(--sp-2) - 20px) * ${1 - tipRow.value / chartMax})` }}>
                    {MONTHS_SHORT[tipRow.month - 1]} · {formatInr(tipRow.value)}
                  </span>
                )}
              </div>
            </div>
            <div className="row row--between t-caption muted" style={{ marginTop: 'var(--sp-2)' }}>
              <span>Average {formatInr(average, { noPaise: true })} / month</span>
              <span>{maximum.value ? `Highest: ${MONTHS_SHORT[maximum.month - 1]} ${formatInr(maximum.value, { noPaise: true })}` : `Nothing in ${year}`}</span>
            </div>
          </div>

          <div className="side-stack">
            {reviewCount > 0 && (
              <div className="card card--lg review-card">
                <div className="row row--top gap-3">
                  <span className="w-dialog__icon w-dialog__icon--review" style={{ width: 36, height: 36 }}><Icon name="flag" /></span>
                  <div className="grow col gap-1"><span className="t-heading">{reviewCount.toLocaleString('en-IN')} need review</span><span className="t-small muted">New payees from your last import. Picking a category teaches the app for next time.</span></div>
                </div>
                <Link className="btn btn--block" style={{ marginTop: 'var(--sp-3)' }} to="/transactions?review=1">Review now</Link>
              </div>
            )}
            <div className="card card--lg">
              <div className="card__head" style={{ marginBottom: 'var(--sp-1)' }}><span className="t-heading">By account</span><span className="t-caption muted">{amountLabel}</span></div>
              {accountSpend.length ? accountSpend.map((item) => {
                const source = accountSources.get(item.key) ?? '';
                return (
                  <div className="acc-row" key={item.key}>
                    <span className="acc-ico">{source === 'cc' ? '💳' : '🏦'}</span>
                    <div className="grow col gap-0"><span className="t-label">{item.key}</span><span className="t-caption muted">{SOURCE_LABELS[source] ?? 'Account'} · {item.txnCount.toLocaleString('en-IN')} txns</span></div>
                    <span className="t-label tabular">{formatInr(item.spentPaise)}</span>
                  </div>
                );
              }) : <span className="t-small muted">{emptyLabel} in {periodName}.</span>}
            </div>
          </div>
        </div>

        <div className="grid grid-2">
          <div className="card card--lg">
            <div className="card__head"><span className="t-heading">{isIncome ? 'Where it came from' : 'Where it went'}</span><span className="t-caption muted">Click a category for details</span></div>
            {breakdown.length ? (
              <div className="brk">
                {visibleBreakdown.map((item) => {
                  const key = keyOf(item.categoryId);
                  const info = categoryInfo(key);
                  const pct = share(item.spentPaise);
                  return (
                    <button key={key} type="button" className={`brk__row${selectedKey === key ? ' is-active' : ''}`} aria-expanded={selectedKey === key} onClick={() => setSelectedKey(key)}>
                      <span className="brk__em">{info.emoji}</span>
                      <div className="brk__main"><span className="t-label">{info.name}</span><div className="brk__track"><div className="brk__fill" style={{ width: barWidth(pct) }} /></div></div>
                      <span className="brk__amt t-small-em">{formatInr(item.spentPaise)}</span><span className="brk__pct t-caption muted">{pct.toFixed(1)}%</span>
                    </button>
                  );
                })}
                {rest.length > 0 && (
                  <button type="button" className="brk__row" aria-label={`Everything else (${rest.length}): show all categories`} onClick={() => setShowAllCategories(true)}>
                    <span className="brk__em">•</span>
                    <div className="brk__main"><span className="t-label">Everything else ({rest.length})</span><div className="brk__track"><div className="brk__fill" style={{ width: barWidth(share(restPaise)) }} /></div></div>
                    <span className="brk__amt t-small-em">{formatInr(restPaise)}</span><span className="brk__pct t-caption muted">{share(restPaise).toFixed(1)}%</span>
                  </button>
                )}
              </div>
            ) : <span className="t-small muted">{emptyLabel} in {periodName}.</span>}
          </div>

          <div className="card card--lg">
            <div className="card__head"><span className="t-heading">{isIncome ? 'Top payers' : 'Top payees'}</span><Link className="t-link" to={activityLink()}>See all</Link></div>
            {merchantSpend.length ? (
              <div className="merch">
                <span className="t-caption muted">{isIncome ? 'Payer' : 'Payee'}</span><span className="t-caption muted" style={{ textAlign: 'right' }}>Txns</span><span className="t-caption muted" style={{ textAlign: 'right' }}>{amountLabel}</span>
                {merchantSpend.map((item) => [
                  <span key={`${item.key}-n`} className="t-label nm" title={item.key}>{item.key}</span>,
                  <span key={`${item.key}-c`} className="t-small muted tabular" style={{ textAlign: 'right' }}>{item.txnCount.toLocaleString('en-IN')}</span>,
                  <span key={`${item.key}-s`} className="t-small-em tabular" style={{ textAlign: 'right' }}>{formatInr(item.spentPaise, { noPaise: true })}</span>,
                ])}
              </div>
            ) : <span className="t-small muted">{emptyLabel} in {periodName}.</span>}
          </div>
        </div>
      </main>

      <DetailPanel
        open={selectedKey != null && selectedInfo != null}
        onClose={closePanel}
        label="Category detail"
        bar={<span className="t-overline muted">CATEGORY · {periodName.toUpperCase()}</span>}
        footer={selectedKey != null && (
          <Link className="btn btn--primary btn--block" to={activityLink(selectedKey)}><Icon name="history" />View {(selectedRow?.txnCount ?? 0).toLocaleString('en-IN')} in Activity</Link>
        )}
      >
        {selectedInfo && (
          <>
            <div className="row gap-3"><span className="dp-cat__em" style={{ width: 44, height: 44, fontSize: 22 }}>{selectedInfo.emoji}</span>
              <div className="grow col gap-0"><span className="t-subtitle">{selectedInfo.name}</span>              <span className="t-small muted">{share(selectedRow?.spentPaise ?? 0).toFixed(1)}% of {isIncome ? 'income' : 'spending'} · {(selectedRow?.txnCount ?? 0).toLocaleString('en-IN')} transactions</span></div></div>
                          <div className="card card--subtle row row--between"><span className="t-small muted">{amountLabel} in {periodName}</span><span className="t-amount">{formatInr(selectedRow?.spentPaise ?? 0)}</span></div>
            <div className="dp-section"><span className="t-overline muted">BY MONTH{mode === 'all' ? ` · ${year}` : ''}</span>
              <div className="bars mini-bars">
                {miniRows.map((value, index) => (
                  <div key={index} className={`bars__col${selectedMonth < 0 || selectedMonth === index + 1 ? ' is-selected' : ''}${value ? '' : ' is-empty'}`} title={`${MONTHS_SHORT[index]} · ${formatInr(value)}`}>
                    <div className="bars__stack"><div className="bars__bar" style={{ height: `${value ? (value / miniMax) * 100 : 2}%` }} /></div><span className="bars__x">{MONTHS_SHORT[index][0]}</span>
                  </div>
                ))}
              </div></div>
            {subRows.length > 0 && (
              <div className="dp-section"><span className="t-overline muted">SUB-CATEGORIES</span>
                <div className="brk">
                  {subRows.map((item) => {
                    const pct = selectedRow && selectedRow.spentPaise > 0 ? Math.max(0, Math.round((item.spentPaise / selectedRow.spentPaise) * 100)) : 0;
                    return (
                      <div className="brk__row" key={item.subcategoryId ?? 'none'}><span />
                        <div className="brk__main"><span className="t-label">{item.subcategoryId == null ? 'No sub-category' : subcategoryNames.get(item.subcategoryId) ?? 'Other'}</span><div className="brk__track"><div className="brk__fill" style={{ width: `${pct}%` }} /></div></div>
                        <span className="brk__amt t-small-em">{formatInr(item.spentPaise)}</span><span className="brk__pct t-caption muted">{pct}%</span></div>
                    );
                  })}
                </div></div>
            )}
            {panelPayees.length > 0 && (
              <div className="dp-section"><span className="t-overline muted">TOP PAYEES</span>
                <div className="dl">
                  {panelPayees.map((item) => <div className="dl__row" key={item.key}><span className="dl__v">{item.key}</span><span className="tabular">{formatInr(item.spentPaise)}</span></div>)}
                </div></div>
            )}
          </>
        )}
      </DetailPanel>
    </div>
  );
}
