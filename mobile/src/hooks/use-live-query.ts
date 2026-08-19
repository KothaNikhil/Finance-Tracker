/**
 * A drop-in replacement for drizzle's `useLiveQuery` that COALESCES change events.
 *
 * Why: expo-sqlite's `addDatabaseChangeListener` fires once PER ROW (it reports a `rowId`), so a
 * bulk write — importing a large statement, the dev seeder, "Delete all data" — emits thousands of
 * events. Drizzle's built-in `useLiveQuery` re-runs the whole query on every one of them, which
 * freezes the app for minutes. Here we schedule a single re-query per burst (a short debounce), so
 * N row-events cost N cheap no-ops + one query. Single-row edits still refresh within a frame.
 *
 * Behaviour otherwise mirrors drizzle's hook: initial run on mount / `deps` change, subscribes to
 * the query's `.from()` table, returns `{ data, error, updatedAt }` (`updatedAt` undefined until the
 * first result lands, so callers can tell "loading" from "empty").
 */

import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { addDatabaseChangeListener } from 'expo-sqlite';
import { useEffect, useState } from 'react';

/** Collapse a burst of per-row change events into one re-query after this many ms of quiet. */
const COALESCE_MS = 50;

export function useLiveQuery<T extends PromiseLike<unknown> & { config?: { table?: unknown } }>(
  query: T,
  deps: readonly unknown[] = [],
): { data: Awaited<T>; error: Error | undefined; updatedAt: Date | undefined } {
  const [data, setData] = useState<Awaited<T>>([] as Awaited<T>);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [updatedAt, setUpdatedAt] = useState<Date | undefined>(undefined);

  useEffect(() => {
    const entity = query.config?.table;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = () => {
      query.then(
        (d) => {
          if (cancelled) return;
          setData(d as Awaited<T>);
          setUpdatedAt(new Date());
        },
        (e: Error) => {
          if (!cancelled) setError(e);
        },
      );
    };

    run(); // initial fetch

    let listener: { remove: () => void } | undefined;
    if (is(entity, SQLiteTable)) {
      const tableName = getTableConfig(entity).name;
      listener = addDatabaseChangeListener(({ tableName: changed }) => {
        if (changed !== tableName) return;
        if (timer) return; // a re-query is already scheduled — coalesce this burst
        timer = setTimeout(() => {
          timer = null;
          if (!cancelled) run();
        }, COALESCE_MS);
      });
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      listener?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are supplied by the caller (query params)
  }, deps);

  return { data, error, updatedAt };
}
