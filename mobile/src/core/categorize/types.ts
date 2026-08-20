/**
 * Contracts for auto-categorization (Step 4).
 *
 * The categorizer is a **pure function**: given one transaction, the current category list,
 * and any rules the user's past edits have taught us, it returns a best-guess category with a
 * confidence and a "needs review" flag. It has no database or React Native imports, so it runs
 * in a unit test and would run unchanged on a future web build.
 */

import type { Direction } from '../domain/money';
import type { TxnKind } from '../import/types';

/** How sure we are about a guess. Drives whether a row is flagged for review. */
export type Confidence = 'high' | 'medium' | 'low' | 'none';

/** Where a guess came from — shown to the user as the "why". */
export type SuggestionVia = 'learned' | 'tag' | 'merchant' | 'note' | 'kind' | 'transfer' | 'none';

/** A sub-category as held in the index (id + display name). */
export interface SubcategoryRef {
  id: number;
  name: string;
}

/** A category with its nested sub-categories, as held in the index. */
export interface CategoryRef {
  id: number;
  name: string;
  emoji: string | null;
  subcategories: SubcategoryRef[];
}

/**
 * Reference data plus fast lookups, built once from the database before an import.
 * Everything the categorizer needs to know about the user's current categories.
 */
export interface CategoryIndex {
  categories: CategoryRef[];
  /** normalized category name → category */
  byName: Map<string, CategoryRef>;
  /** category id → category */
  byId: Map<number, CategoryRef>;
}

/**
 * What kind of value a learned rule matches on:
 *  - `vpa` / `merchant` — the payee; these teach the CATEGORY (a payee is ~always one category).
 *  - `note` — the user's hand-typed note; teaches the SUB-CATEGORY (and category when the payee is
 *    unknown). Matched fuzzily to tolerate typos.
 *  - `tag` — a Paytm tag.
 */
export type MatcherType = 'vpa' | 'merchant' | 'note' | 'tag';

/**
 * A mapping the user taught us by editing a transaction's category, e.g.
 * "this counterparty VPA → Groceries". Applied to future imports with high confidence.
 * `matcherKey` is already normalized (see normalizeText / normalizeTag).
 */
export interface LearnedRule {
  matcherType: MatcherType;
  matcherKey: string;
  categoryId: number;
  subcategoryId: number | null;
}

/** The fields of a transaction the categorizer looks at. */
export interface CategorizeInput {
  kind: TxnKind;
  direction: Direction;
  rawTag: string | null;
  counterpartyName: string | null;
  counterpartyVpa: string | null;
  rawDetails: string;
  /** The user-typed note (Paytm remarks, or the bank UPI narration's note segment). */
  remarks?: string | null;
}

/** The categorizer's verdict for one transaction. */
export interface CategorySuggestion {
  categoryId: number | null;
  subcategoryId: number | null;
  confidence: Confidence;
  /** True when the guess is weak or absent and a human should confirm it. */
  needsReview: boolean;
  /** Short human-readable explanation, e.g. 'Tag "#🥘 Food"' or 'Learned: zepto'. */
  reason: string;
  via: SuggestionVia;
}
