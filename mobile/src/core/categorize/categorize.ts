/**
 * The auto-categorizer. One pure function, `categorize`, decides a category for a transaction
 * by trying rules from strongest to weakest:
 *
 *   1. Learned rules   — what the user's past edits taught us (by VPA, then merchant, then tag)
 *   2. Paytm tag       — the tag the user put on it in Paytm (their own label; very reliable)
 *   3. Merchant brand  — a known brand keyword in the counterparty / details text
 *   4. Statement kind  — a last-resort guess from the wording ("Paid to", "Gold Coin…", …)
 *
 * Anything weak or unmatched comes back with `needsReview: true` so the UI can flag it.
 */

import {
  KIND_DEFAULTS,
  MERCHANT_RULES,
  TAG_ALIASES,
  TAG_NEEDS_REVIEW,
  TAG_TRANSFERS,
} from './rules';
import type {
  CategoryIndex,
  CategoryRef,
  CategorizeInput,
  CategorySuggestion,
  LearnedRule,
  SubcategoryRef,
} from './types';

/**
 * Fold any text to a stable lookup key: lower-case, and collapse every run of non-alphanumeric
 * characters (emoji, punctuation, spaces) to a single space. So "Self-Transfer" and
 * "Self Transfer" both become "self transfer", and "ZEPTO Marketplace" becomes "zepto marketplace".
 */
export function normalizeText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Normalize a Paytm tag: drop the leading '#', then fold like any other text (strips emoji). */
export function normalizeTag(tag: string | null | undefined): string {
  if (!tag) return '';
  return normalizeText(tag.replace(/^#/, ''));
}

/** Build the lookup index the categorizer and the category picker share. */
export function buildCategoryIndex(
  categories: { id: number; name: string; emoji: string | null }[],
  subcategories: { id: number; categoryId: number; name: string }[],
): CategoryIndex {
  const refs: CategoryRef[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    emoji: c.emoji,
    subcategories: subcategories
      .filter((s) => s.categoryId === c.id)
      .map((s): SubcategoryRef => ({ id: s.id, name: s.name })),
  }));

  const byName = new Map<string, CategoryRef>();
  const byId = new Map<number, CategoryRef>();
  for (const ref of refs) {
    byName.set(normalizeText(ref.name), ref);
    byId.set(ref.id, ref);
  }
  return { categories: refs, byName, byId };
}

/** Find a sub-category by name within a category (normalized match). */
function findSubcategory(category: CategoryRef, subName?: string): SubcategoryRef | null {
  if (!subName) return null;
  const target = normalizeText(subName);
  return category.subcategories.find((s) => normalizeText(s.name) === target) ?? null;
}

/** Resolve a category (and optional sub-category) name to ids, or null if the category is gone. */
function resolveByName(
  index: CategoryIndex,
  categoryName: string,
  subName?: string,
): { categoryId: number; subcategoryId: number | null } | null {
  const cat = index.byName.get(normalizeText(categoryName));
  if (!cat) return null;
  return { categoryId: cat.id, subcategoryId: findSubcategory(cat, subName)?.id ?? null };
}

/** Try to match a learned rule, checking the most specific matcher (VPA) first. */
function matchLearned(input: CategorizeInput, index: CategoryIndex, learned: LearnedRule[]): CategorySuggestion | null {
  if (learned.length === 0) return null;

  const keys: Record<string, string> = {
    vpa: normalizeText(input.counterpartyVpa),
    merchant: normalizeText(input.counterpartyName),
    tag: normalizeTag(input.rawTag),
  };

  // VPA is the most precise (same payee), tag the broadest — prefer in that order.
  for (const matcherType of ['vpa', 'merchant', 'tag'] as const) {
    const key = keys[matcherType];
    if (!key) continue;
    const rule = learned.find((r) => r.matcherType === matcherType && r.matcherKey === key);
    if (!rule) continue;
    const cat = index.byId.get(rule.categoryId);
    if (!cat) continue; // category was deleted since the rule was learned
    const subValid = rule.subcategoryId != null && cat.subcategories.some((s) => s.id === rule.subcategoryId);
    return {
      categoryId: cat.id,
      subcategoryId: subValid ? rule.subcategoryId : null,
      confidence: 'high',
      needsReview: false,
      via: 'learned',
      reason: `Learned: ${key}`,
    };
  }
  return null;
}

/** Try the Paytm tag: transfers, deferred features, alias table, then a direct name/sub match. */
function matchTag(input: CategorizeInput, index: CategoryIndex): CategorySuggestion | null {
  const tag = normalizeTag(input.rawTag);
  if (!tag) return null;

  // Tags that mean "not a spend category" — confidently leave uncategorized.
  if (TAG_TRANSFERS.has(tag)) {
    return {
      categoryId: null,
      subcategoryId: null,
      confidence: 'high',
      needsReview: false,
      via: 'transfer',
      reason: `Tagged "${input.rawTag}" (transfer)`,
    };
  }

  // Deferred-feature tags — park under Others but flag.
  if (TAG_NEEDS_REVIEW.has(tag)) {
    const resolved = resolveByName(index, 'Others');
    return {
      categoryId: resolved?.categoryId ?? null,
      subcategoryId: resolved?.subcategoryId ?? null,
      confidence: 'low',
      needsReview: true,
      via: 'tag',
      reason: `Tagged "${input.rawTag}" — confirm`,
    };
  }

  const alias = TAG_ALIASES[tag];
  if (alias) {
    const resolved = resolveByName(index, alias.category, alias.subcategory);
    if (resolved) {
      return {
        ...resolved,
        confidence: alias.ambiguous ? 'low' : 'high',
        needsReview: !!alias.ambiguous,
        via: 'tag',
        reason: `Tag "${input.rawTag}"`,
      };
    }
  }

  // No alias — but the tag might already name a category (or sub-category) directly.
  const direct = index.byName.get(tag);
  if (direct) {
    return {
      categoryId: direct.id,
      subcategoryId: null,
      confidence: 'high',
      needsReview: false,
      via: 'tag',
      reason: `Tag "${input.rawTag}"`,
    };
  }
  for (const cat of index.categories) {
    const sub = cat.subcategories.find((s) => normalizeText(s.name) === tag);
    if (sub) {
      return {
        categoryId: cat.id,
        subcategoryId: sub.id,
        confidence: 'high',
        needsReview: false,
        via: 'tag',
        reason: `Tag "${input.rawTag}"`,
      };
    }
  }
  return null; // tag present but unrecognized — fall through to merchant / kind
}

/** Try a known brand keyword against the counterparty name and the raw details. */
function matchMerchant(input: CategorizeInput, index: CategoryIndex): CategorySuggestion | null {
  const haystack = `${normalizeText(input.counterpartyName)} ${normalizeText(input.rawDetails)}`;
  for (const rule of MERCHANT_RULES) {
    if (haystack.includes(rule.keyword)) {
      const resolved = resolveByName(index, rule.category, rule.subcategory);
      if (resolved) {
        return {
          ...resolved,
          confidence: 'medium',
          needsReview: false,
          via: 'merchant',
          reason: `Merchant "${rule.keyword}"`,
        };
      }
    }
  }
  return null;
}

/** Last resort: guess from the statement wording (parsed kind). */
function matchKind(input: CategorizeInput, index: CategoryIndex, tagWasPresent: boolean): CategorySuggestion {
  const def = KIND_DEFAULTS[input.kind] ?? KIND_DEFAULTS.other;
  const resolved = def.category ? resolveByName(index, def.category, def.subcategory) : null;

  // A tag was present but we couldn't map it — that's a weak signal, so always ask.
  const needsReview = def.review || (tagWasPresent && def.category == null);
  return {
    categoryId: resolved?.categoryId ?? null,
    subcategoryId: resolved?.subcategoryId ?? null,
    confidence: def.category ? 'medium' : needsReview ? 'low' : 'high',
    needsReview,
    via: def.category ? 'kind' : def.review ? 'none' : 'transfer',
    reason: tagWasPresent && def.category == null ? `Unrecognized tag "${input.rawTag}"` : def.reason,
  };
}

/**
 * Decide a category for one transaction. Pure: same inputs → same output, no side effects.
 * `learned` may be empty (a fresh install with no edits yet).
 */
export function categorize(
  input: CategorizeInput,
  index: CategoryIndex,
  learned: LearnedRule[] = [],
): CategorySuggestion {
  return (
    matchLearned(input, index, learned) ??
    matchTag(input, index) ??
    matchMerchant(input, index) ??
    matchKind(input, index, normalizeTag(input.rawTag) !== '')
  );
}
