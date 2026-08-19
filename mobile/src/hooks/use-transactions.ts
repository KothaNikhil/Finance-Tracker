/**
 * Live, paged transaction list. Backed by `useLiveQuery` with a GROWING LIMIT: `loadMore` bumps
 * the window and the whole (bigger) window is re-read live, so every import/edit/delete refreshes
 * all loaded rows with no manual cache. `deps` on both live queries include the serialized filter
 * (and the limit) — WITHOUT them the change-listener would capture a stale query and freeze.
 *
 * Growing-LIMIT (not keyset) is deliberate: `useLiveQuery` owns exactly one query, so accumulating
 * pages in JS state would leave earlier pages stale on edits/deletes. The cost is bounded — the
 * limit only grows as the user scrolls, and `idx_transactions_date` makes the ordered-limit read
 * sub-millisecond even at 50k rows.
 */

import { useState } from 'react';

import { useLiveQuery } from '@/hooks/use-live-query';

import type { TxnFilter } from '@/core/analytics';
import type { TransactionRow } from '@/core/db/schema';
import { getDb } from '@/services/db/database';
import { txnCountQuery, txnListQuery } from '@/services/db/queries/transactions';

export interface TransactionListResult {
  /** The loaded window of rows (newest first), grown by `loadMore`. */
  rows: TransactionRow[];
  /** Total rows matching the filter (independent of the loaded window). */
  count: number;
  /** True while more matching rows exist beyond the loaded window. */
  hasMore: boolean;
  /** Grow the window by one page. No-op when there's nothing more. */
  loadMore: () => void;
  /** True until the first result lands (distinguishes "loading" from "genuinely empty"). */
  loading: boolean;
}

export function useTransactionList(filter: TxnFilter, pageSize = 50): TransactionListResult {
  const db = getDb();
  const filterKey = JSON.stringify(filter);

  const [pages, setPages] = useState(1);
  // Reset the window whenever the filter changes (search, category, month range, …). This is the
  // React-recommended "adjust state during render on a changed input" pattern — no effect needed.
  const [seenKey, setSeenKey] = useState(filterKey);
  if (filterKey !== seenKey) {
    setSeenKey(filterKey);
    setPages(1);
  }

  const limit = pages * pageSize;

  const list = useLiveQuery(txnListQuery(db, filter, limit), [filterKey, limit]);
  const countRes = useLiveQuery(txnCountQuery(db, filter), [filterKey]);

  const rows = (list.data ?? []) as TransactionRow[];
  const count = countRes.data?.[0]?.n ?? 0;
  const loading = list.updatedAt === undefined;
  // A full window (rows filled the limit) with more rows beyond it means there's another page.
  const hasMore = rows.length >= limit && limit < count;

  const loadMore = () => {
    setPages((p) => (p * pageSize < count ? p + 1 : p));
  };

  return { rows, count, hasMore, loadMore, loading };
}

/**
 * Live count of transactions matching a filter (default: all), with a `loading` flag so callers can
 * tell "still loading" from "genuinely zero" and avoid flashing an empty state on first render.
 */
export function useTransactionCount(filter: TxnFilter = {}): { count: number; loading: boolean } {
  const db = getDb();
  const key = JSON.stringify(filter);
  const { data, updatedAt } = useLiveQuery(txnCountQuery(db, filter), [key]);
  return { count: data?.[0]?.n ?? 0, loading: updatedAt === undefined };
}
