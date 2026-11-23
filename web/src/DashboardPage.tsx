import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { asc, eq } from 'drizzle-orm';
import {
  accountSpendQuery,
  categoryBreakdownQuery,
  merchantSpendQuery,
  monthlyForYearQuery,
  periodTotalsQuery,
  subcategoryBreakdownQuery,
  summaryQuery,
} from '@finance-tracker/core/db/queries/aggregates';
import { categories, subcategories } from '@finance-tracker/core/db/schema';
import { getDb } from '@finance-tracker/core/db/runtime';
import { inr, useDatabaseRevision } from './feature-utils';

type PeriodMode = 'month' | 'year' | 'all';
type TrendMode = 'spent' | 'net' | 'received';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function DashboardPage() {
  useDatabaseRevision();
  const navigate = useNavigate();
  const db = getDb();
  const now = new Date();
  const [mode, setMode] = useState<PeriodMode>('year');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [trendMode, setTrendMode] = useState<TrendMode>('spent');
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);

  const filter = useMemo(() => {
    if (mode === 'all') return {};
    if (mode === 'month') return { from: { year, month }, to: { year, month } };
    return { from: { year, month: 1 }, to: { year, month: 12 } };
  }, [mode, year, month]);
  const totals = periodTotalsQuery(db, filter).get() ?? {
    spentPaise: 0, receivedPaise: 0, refundPaise: 0, txnCount: 0,
  };
  const summary = summaryQuery(db, filter).get() ?? { reviewCount: 0 };
  const trend = monthlyForYearQuery(db, year).all();
  const categoriesList = db.select().from(categories).where(eq(categories.isArchived, false)).orderBy(asc(categories.sortOrder), asc(categories.id)).all();
  const subcategoryNames = new Map(db.select().from(subcategories).orderBy(asc(subcategories.sortOrder), asc(subcategories.id)).all().map((item) => [item.id, item.name]));
  const breakdown = categoryBreakdownQuery(db, filter).all();
  const merchantSpend = merchantSpendQuery(db, filter).all().slice(0, 8);
  const accountSpend = accountSpendQuery(db, filter).all().slice(0, 6);
  const selectedCategory = selectedCategoryId == null
    ? null
    : categoriesList.find((item) => item.id === selectedCategoryId) ?? null;
  const subcategoriesForSelected = selectedCategory
    ? subcategoryBreakdownQuery(db, selectedCategory.id, filter).all()
    : [];
  const categoryTotal = breakdown.reduce((sum, item) => sum + item.spentPaise, 0);
  const trendRows = Array.from({ length: 12 }, (_, index) => {
    const row = trend.find((item) => item.month === index + 1);
    const value = trendMode === 'received'
      ? row?.receivedPaise ?? 0
      : trendMode === 'net'
        ? (row?.spentPaise ?? 0) - (row?.refundPaise ?? 0)
        : row?.spentPaise ?? 0;
    return { month: index + 1, value };
  });
  const peak = Math.max(1, ...trendRows.map((row) => row.value));
  const maximum = trendRows.reduce((best, row) => row.value > best.value ? row : best, trendRows[0]);
  const average = Math.round(trendRows.reduce((sum, row) => sum + row.value, 0) / 12);
  const periodLabel = mode === 'all'
    ? 'All time'
    : mode === 'month'
      ? `${MONTHS[month - 1]} ${year}`
      : String(year);
  const periodRange = mode === 'month'
    ? { from: `${year}-${String(month).padStart(2, '0')}-01`, to: `${year}-${String(month).padStart(2, '0')}-31` }
    : { from: `${year}-01-01`, to: `${year}-12-31` };

  const shiftPeriod = (amount: number) => {
    if (mode === 'month') {
      const date = new Date(year, month - 1 + amount, 1);
      setYear(date.getFullYear());
      setMonth(date.getMonth() + 1);
    } else {
      setYear((value) => value + amount);
    }
  };
  const openActivity = (from = mode === 'all' ? '' : periodRange.from, to = mode === 'all' ? '' : periodRange.to, categoryId?: number) => {
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    if (categoryId != null) query.set('category', String(categoryId));
    navigate(`/transactions?${query}`);
  };

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div><p className="eyebrow">OVERVIEW</p><h1>Your money at a glance</h1><p className="muted">{periodLabel}</p></div>
        <div className="period-controls">
          <div className="row gap-1">
            <button className="icon-button" aria-label="Previous period" disabled={mode === 'all'} onClick={() => shiftPeriod(-1)}>‹</button>
            <strong>{periodLabel}</strong>
            <button className="icon-button" aria-label="Next period" disabled={mode !== 'all' && year === now.getFullYear() && (mode !== 'month' || month === now.getMonth() + 1)} onClick={() => shiftPeriod(1)}>›</button>
          </div>
          <div className="segmented" role="group" aria-label="Dashboard period">
            {(['month', 'year', 'all'] as const).map((value) => <button key={value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{value === 'all' ? 'All' : value === 'month' ? 'Month' : 'Year'}</button>)}
          </div>
          {mode === 'month' && <select aria-label="Month" value={month} onChange={(event) => setMonth(Number(event.target.value))}>{MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select>}
        </div>
      </div>

      <div className="metric-grid metric-grid-four">
        <article className="metric-card metric-hero"><span className="metric-label">Net spent</span><strong>{inr(totals.spentPaise - totals.refundPaise)}</strong><span className="muted">{totals.txnCount.toLocaleString()} counted transactions</span></article>
        <article className="metric-card"><span className="metric-label">Spent</span><strong>{inr(totals.spentPaise)}</strong><span className="metric-icon spend">↘</span></article>
        <article className="metric-card"><span className="metric-label">Received</span><strong>{inr(totals.receivedPaise)}</strong><span className="metric-icon income">↗</span></article>
        <article className="metric-card"><span className="metric-label">Refunds & cashback</span><strong>{inr(totals.refundPaise)}</strong><span className="muted">Taken off spending</span></article>
      </div>

      {summary.reviewCount > 0 && <div className="review-callout"><span><strong>{summary.reviewCount} transactions need review</strong><small>Choose a category to help future imports.</small></span><Link className="button button-quiet" to="/transactions?review=1">Review now</Link></div>}

      <div className="dashboard-grid">
        <article className="card feature-card">
          <div className="card-heading"><div><h2>Monthly {trendMode === 'received' ? 'income' : 'spending'}</h2><p className="muted">Select a month to see the transactions.</p></div>
            <div className="segmented" role="group" aria-label="Trend metric">
              {(['spent', 'net', 'received'] as const).map((value) => <button key={value} className={trendMode === value ? 'active' : ''} onClick={() => setTrendMode(value)}>{value === 'received' ? 'In' : value === 'net' ? 'Net' : 'Spent'}</button>)}
            </div>
          </div>
          <div className="trend-chart" role="list" aria-label={`${year} monthly ${trendMode}`}>
            {trendRows.map((row) => <button key={row.month} className="trend-bar" title={`${MONTHS[row.month - 1]} ${year}: ${inr(row.value)}`} aria-label={`${MONTHS[row.month - 1]} ${year}: ${inr(row.value)}`} onClick={() => openActivity(`${year}-${String(row.month).padStart(2, '0')}-01`, `${year}-${String(row.month).padStart(2, '0')}-31`)}>
              <span className="trend-bar-fill" style={{ height: `${Math.max(2, row.value / peak * 100)}%` }} />
              <span className="trend-bar-label">{MONTHS[row.month - 1]}</span>
            </button>)}
          </div>
          <div className="row row-between muted small"><span>Average {inr(average)} / month</span><span>Highest: {MONTHS[maximum.month - 1]} {inr(maximum.value)}</span></div>
        </article>
        <div className="dashboard-side">
          <article className="card feature-card account-card">
            <div className="card-heading"><h2>By account</h2><span className="muted">Spent</span></div>
            {accountSpend.length ? accountSpend.map((item) => <div className="compact-row" key={item.key}><span className="category-avatar">🏦</span><strong>{item.key}</strong><span>{inr(item.spentPaise)}</span></div>) : <p className="muted">No account spending in this period.</p>}
          </article>
        </div>
      </div>

      <div className="dashboard-grid dashboard-grid-two">
        <article className="card feature-card">
          <div className="card-heading"><div><h2>Where it went</h2><p className="muted">Select a category for a breakdown.</p></div></div>
          {breakdown.length ? <div className="breakdown-list">{breakdown.map((item) => {
            const category = item.categoryId == null ? null : categoriesList.find((row) => row.id === item.categoryId);
            const percentage = categoryTotal ? item.spentPaise / categoryTotal * 100 : 0;
            return <button key={item.categoryId ?? 'none'} className={`breakdown-row${selectedCategoryId === item.categoryId ? ' selected' : ''}`} onClick={() => setSelectedCategoryId(item.categoryId)}>
              <span className="category-avatar">{category?.emoji || '•'}</span><span className="breakdown-main"><strong>{category?.name ?? 'Uncategorized'}</strong><span className="progress-track"><span style={{ width: `${percentage}%` }} /></span></span><strong>{inr(item.spentPaise)}</strong><span className="muted small">{percentage.toFixed(1)}%</span>
            </button>;
          })}</div> : <p className="muted">No spending in this period.</p>}
        </article>
        <article className="card feature-card">
          <div className="card-heading"><h2>Top payees</h2><button className="text-button" onClick={() => openActivity()}>See all</button></div>
          {merchantSpend.length ? merchantSpend.map((item) => <div className="merchant-row" key={item.key}><span>{item.key}</span><span className="muted">{item.txnCount} txns</span><strong>{inr(item.spentPaise)}</strong></div>) : <p className="muted">No payee spending in this period.</p>}
        </article>
      </div>

      {selectedCategory && <aside className="category-drill card" aria-label={`${selectedCategory.name} breakdown`}>
        <div className="card-heading"><div><p className="eyebrow">CATEGORY · {periodLabel}</p><h2>{selectedCategory.emoji ? `${selectedCategory.emoji} ` : ''}{selectedCategory.name}</h2></div><button className="icon-button" aria-label="Close category detail" onClick={() => setSelectedCategoryId(null)}>×</button></div>
        <div className="row row-between"><span className="muted">Spent in {periodLabel}</span><strong>{inr(breakdown.find((item) => item.categoryId === selectedCategory.id)?.spentPaise ?? 0)}</strong></div>
        <h3>Sub-categories</h3>
        {subcategoriesForSelected.map((item) => <div className="merchant-row" key={item.subcategoryId ?? 'none'}><span>{item.subcategoryId == null ? 'No sub-category' : subcategoryNames.get(item.subcategoryId) ?? 'Other'}</span><strong>{inr(item.spentPaise)}</strong><span className="muted">{item.txnCount} txns</span></div>)}
        <button className="button button-primary" onClick={() => openActivity(undefined, undefined, selectedCategory.id)}>View transactions</button>
      </aside>}
    </section>
  );
}
