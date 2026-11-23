/**
 * The auto-categorizer. One pure function, `categorize`, decides a category + sub-category for a
 * transaction.
 *
 *   WITH A NOTE — the note (learned note rule, then static note keyword) decides, because people
 *   describe *what* they bought in the note, while one payee (a person) can be paid for many things.
 *   The note beats the learned payee and the merchant brand. A Paytm tag can only confirm it:
 *     - tag agrees  → keep the note's category (and its sub-category), no review
 *     - tag differs → still suggest the note's category, but flag the row for review
 *   Intentional transfers (transfer tag, or a self/received row with no tag) are never re-filed.
 *
 *   WITHOUT A NOTE — strongest to weakest:
 *     1. Learned payee   — what the user's past edits taught us (by VPA, then merchant name)
 *     2. Paytm tag       — the tag Paytm/the user put on it (auto-filled from merchant+note)
 *     3. Merchant brand  — a known brand keyword in the counterparty / narration text
 *     4. Statement kind  — a last-resort guess from the wording ("Paid to", "Gold Coin…", …)
 *
 * Anything weak or unmatched comes back with `needsReview: true` so the UI can flag it.
 */

import { fuzzyEqual } from './fuzzy';
import {
  KEYWORD_RULES,
  KIND_DEFAULTS,
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

/** Try to match a learned PAYEE rule (VPA then merchant name) — these teach the category. */
function matchLearnedPayee(input: CategorizeInput, index: CategoryIndex, learned: LearnedRule[]): CategorySuggestion | null {
  if (learned.length === 0) return null;

  const keys: Record<string, string> = {
    vpa: normalizeText(input.counterpartyVpa),
    merchant: normalizeText(input.counterpartyName),
  };

  // VPA is the most precise (same payee) → prefer it over the merchant name.
  for (const matcherType of ['vpa', 'merchant'] as const) {
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

/** Try a known brand keyword as a substring of the payee text: name, narration, and VPA. */
function matchBrand(input: CategorizeInput, index: CategoryIndex): CategorySuggestion | null {
  const haystack = [
    normalizeText(input.counterpartyName),
    normalizeText(input.rawDetails),
    normalizeText(input.counterpartyVpa),
  ].join(' ');
  for (const rule of KEYWORD_RULES) {
    if (rule.on !== 'brand') continue;
    if (haystack.includes(rule.keyword)) {
      const resolved = resolveByName(index, rule.category, rule.subcategory);
      if (resolved) {
        return {
          ...resolved,
          confidence: rule.ambiguous ? 'low' : 'medium',
          needsReview: !!rule.ambiguous,
          via: 'merchant',
          reason: `Merchant "${rule.keyword}"`,
        };
      }
    }
  }
  return null;
}

/** What the note tells us: a category + optional sub, plus whether that guess is ambiguous. */
interface NoteMatch {
  categoryId: number;
  subcategoryId: number | null;
  ambiguous: boolean;
  /** True when a rule the user taught us matched (stronger than a static keyword). */
  learned: boolean;
}

/**
 * Read the user's note (a hand-typed note, plus the imported Paytm remarks / bank UPI note). First
 * honour anything the user has taught us about a note (learned `note` rules, matched fuzzily to
 * tolerate typos like "biriani"), then fall back to the static note purpose-words (whole-word match
 * so "tea" doesn't hit "steam"). The hand-typed note is folded in first so its words are considered.
 */
function matchNote(input: CategorizeInput, index: CategoryIndex, learned: LearnedRule[]): NoteMatch | null {
  const note = normalizeText([input.userNote, input.remarks].filter(Boolean).join(' '));
  if (!note) return null;
  const tokens = note.split(' ').filter(Boolean);

  // 1. Learned note rules — fuzzy against the whole note or any single token.
  for (const rule of learned) {
    if (rule.matcherType !== 'note' || !rule.matcherKey) continue;
    const hit = fuzzyEqual(note, rule.matcherKey) || tokens.some((t) => fuzzyEqual(t, rule.matcherKey));
    if (!hit) continue;
    const cat = index.byId.get(rule.categoryId);
    if (!cat) continue; // category deleted since it was learned
    const subValid = rule.subcategoryId != null && cat.subcategories.some((s) => s.id === rule.subcategoryId);
    return { categoryId: cat.id, subcategoryId: subValid ? rule.subcategoryId : null, ambiguous: false, learned: true };
  }

  // 2. Static note keywords — whole-word match (pad so we match whole tokens only).
  const padded = ` ${note} `;
  for (const rule of KEYWORD_RULES) {
    if (rule.on !== 'note') continue;
    if (!padded.includes(` ${rule.keyword} `)) continue;
    const resolved = resolveByName(index, rule.category, rule.subcategory);
    if (resolved) return { ...resolved, ambiguous: !!rule.ambiguous, learned: false };
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

/** A row the user means as "not spending" (self-transfer / money received) — a note must not re-file it. */
function isIntentionalTransfer(input: CategorizeInput, tag: CategorySuggestion | null): boolean {
  if (tag) return tag.via === 'transfer';
  const def = KIND_DEFAULTS[input.kind] ?? KIND_DEFAULTS.other;
  return def.category == null && !def.review;
}

/** A note is present: it picks the category; a Paytm tag can only confirm it or send it to review. */
function decideFromNote(input: CategorizeInput, note: NoteMatch, tag: CategorySuggestion | null): CategorySuggestion {
  const fromNote = { categoryId: note.categoryId, subcategoryId: note.subcategoryId, via: 'note' as const };

  if (!tag) {
    return {
      ...fromNote,
      confidence: note.ambiguous ? 'low' : note.learned ? 'high' : 'medium',
      needsReview: note.ambiguous,
      reason: 'From note',
    };
  }
  if (tag.categoryId === note.categoryId) {
    // Two ambiguous guesses agreeing (e.g. "petrol" + #Fuel → Bike?) still don't settle Bike vs Car.
    const bothUnsure = note.ambiguous && tag.needsReview;
    return {
      ...fromNote,
      subcategoryId: note.subcategoryId ?? tag.subcategoryId,
      confidence: bothUnsure ? 'low' : 'high',
      needsReview: bothUnsure,
      reason: `Note and tag "${input.rawTag}" agree`,
    };
  }
  return {
    ...fromNote,
    confidence: 'low',
    needsReview: true,
    reason: `Note differs from tag "${input.rawTag}" — confirm`,
  };
}

/**
 * Decide a category + sub-category for one transaction. Pure: same inputs → same output, no side
 * effects. `learned` may be empty (a fresh install with no edits yet). See the file header for the
 * priority rules.
 */
export function categorize(
  input: CategorizeInput,
  index: CategoryIndex,
  learned: LearnedRule[] = [],
): CategorySuggestion {
  const tag = matchTag(input, index);
  const note = matchNote(input, index, learned);

  if (note && !isIntentionalTransfer(input, tag)) return decideFromNote(input, note, tag);

  return (
    matchLearnedPayee(input, index, learned) ??
    tag ??
    matchBrand(input, index) ??
    matchKind(input, index, normalizeTag(input.rawTag) !== '')
  );
}
