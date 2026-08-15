/**
 * Live-query hooks for the editable reference lists (categories + sub-categories, payment
 * modes, people). Backed by Drizzle's `useLiveQuery`, so any add / rename / reorder / delete
 * from the repository re-renders every screen that shows these lists — no manual refresh.
 */

import { asc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useMemo } from 'react';

import { buildCategoryIndex, type CategoryIndex } from '@/core/categorize';
import { categories, paymentModes, people, subcategories } from '@/core/db/schema';
import { getDb } from '@/services/db/database';

/** Categories with their nested sub-categories, kept in sync with the database. */
export function useCategoryIndex(): CategoryIndex {
  const db = getDb();
  const cats = useLiveQuery(
    db
      .select({ id: categories.id, name: categories.name, emoji: categories.emoji })
      .from(categories)
      .where(eq(categories.isArchived, false))
      .orderBy(asc(categories.sortOrder), asc(categories.id)),
  );
  const subs = useLiveQuery(
    db
      .select({ id: subcategories.id, categoryId: subcategories.categoryId, name: subcategories.name })
      .from(subcategories)
      .where(eq(subcategories.isArchived, false))
      .orderBy(asc(subcategories.sortOrder), asc(subcategories.id)),
  );

  return useMemo(() => buildCategoryIndex(cats.data ?? [], subs.data ?? []), [cats.data, subs.data]);
}

/** The payment-mode and "For" people lists, kept in sync with the database. */
export function useLists(): {
  paymentModes: { id: number; name: string }[];
  people: { id: number; name: string }[];
} {
  const db = getDb();
  const pm = useLiveQuery(
    db
      .select({ id: paymentModes.id, name: paymentModes.name })
      .from(paymentModes)
      .where(eq(paymentModes.isArchived, false))
      .orderBy(asc(paymentModes.sortOrder), asc(paymentModes.id)),
  );
  const pe = useLiveQuery(
    db
      .select({ id: people.id, name: people.name })
      .from(people)
      .where(eq(people.isArchived, false))
      .orderBy(asc(people.sortOrder), asc(people.id)),
  );

  return { paymentModes: pm.data ?? [], people: pe.data ?? [] };
}
