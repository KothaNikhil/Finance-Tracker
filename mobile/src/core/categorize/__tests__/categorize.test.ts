import { SEED_CATEGORIES } from '../../db/seed';
import type { Direction } from '../../domain/money';
import type { TxnKind } from '../../import/types';
import { buildCategoryIndex, categorize, normalizeTag, normalizeText } from '../categorize';
import { KEYWORD_RULES, TAG_ALIASES } from '../rules';
import type { CategorizeInput, CategoryIndex, LearnedRule } from '../types';

/**
 * Build a CategoryIndex from the real seed list, assigning stable ids the way the database
 * would (categories 1..N; sub-categories numbered across all categories). This keeps the tests
 * honest: they run against the exact categories a fresh install ships with.
 */
function seedIndex(): CategoryIndex {
  const cats: { id: number; name: string; emoji: string | null }[] = [];
  const subs: { id: number; categoryId: number; name: string }[] = [];
  let subId = 1;
  SEED_CATEGORIES.forEach((c, i) => {
    const categoryId = i + 1;
    cats.push({ id: categoryId, name: c.name, emoji: c.emoji });
    c.subcategories.forEach((name) => subs.push({ id: subId++, categoryId, name }));
  });
  return buildCategoryIndex(cats, subs);
}

const INDEX = seedIndex();

/** A minimal transaction; override just the fields a test cares about. */
function input(over: Partial<CategorizeInput>): CategorizeInput {
  return {
    kind: 'paid' as TxnKind,
    direction: 'out' as Direction,
    rawTag: null,
    counterpartyName: null,
    counterpartyVpa: null,
    rawDetails: '',
    ...over,
  };
}

/** Resolve a category id by name for readable assertions. */
function catId(name: string): number {
  const id = INDEX.byName.get(normalizeText(name))?.id;
  if (id == null) throw new Error(`test setup: no category "${name}"`);
  return id;
}

describe('normalizeTag / normalizeText', () => {
  it('strips the # and emoji from a Paytm tag', () => {
    expect(normalizeTag('#🥘 Food')).toBe('food');
    expect(normalizeTag('#⛽️ Fuel')).toBe('fuel');
    expect(normalizeTag('#🏦 Financial Services')).toBe('financial services');
  });

  it('folds hyphen and spacing variants to the same key', () => {
    expect(normalizeTag('#💵 Self-Transfer')).toBe('self transfer');
    expect(normalizeTag('#💵 Self Transfer')).toBe('self transfer');
  });

  it('handles empty / null input', () => {
    expect(normalizeTag(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
  });
});

describe('categorize — Paytm tags (primary signal)', () => {
  it('maps a tag to the exact seed category with high confidence, no review', () => {
    const s = categorize(input({ rawTag: '#🥘 Food' }), INDEX);
    expect(s.categoryId).toBe(catId('Food & Dining'));
    expect(s.confidence).toBe('high');
    expect(s.needsReview).toBe(false);
    expect(s.via).toBe('tag');
  });

  it('maps a tag whose wording differs from the category name (Medical → Medicine & Health)', () => {
    const s = categorize(input({ rawTag: '#🏥 Medical' }), INDEX);
    expect(s.categoryId).toBe(catId('Medicine & Health'));
    expect(s.needsReview).toBe(false);
  });

  it('maps Miscellaneous → Others', () => {
    expect(categorize(input({ rawTag: '#🔄 Miscellaneous' }), INDEX).categoryId).toBe(catId('Others'));
  });

  it('resolves the sub-category when the alias names one', () => {
    const s = categorize(input({ rawTag: '#Car Emi', kind: 'self' }), INDEX);
    const car = INDEX.byName.get(normalizeText('Car'))!;
    expect(s.categoryId).toBe(car.id);
    expect(s.subcategoryId).toBe(car.subcategories.find((x) => x.name === 'Car EMI')!.id);
  });

  it('flags an AMBIGUOUS tag (Fuel could be Bike or Car) for review but still guesses', () => {
    const s = categorize(input({ rawTag: '#⛽️ Fuel' }), INDEX);
    expect(s.categoryId).toBe(catId('Bike'));
    expect(s.confidence).toBe('low');
    expect(s.needsReview).toBe(true);
  });

  it('treats transfer/income tags as intentionally uncategorized (no review)', () => {
    for (const tag of ['#💵 Self Transfer', '#💵 Money Received', '#💵 Money Transfer']) {
      const s = categorize(input({ rawTag: tag, kind: 'self' }), INDEX);
      expect(s.categoryId).toBeNull();
      expect(s.needsReview).toBe(false);
      expect(s.via).toBe('transfer');
    }
  });

  it('parks a deferred-feature tag (Money lent) under Others AND flags it', () => {
    const s = categorize(input({ rawTag: '#Money lent' }), INDEX);
    expect(s.categoryId).toBe(catId('Others'));
    expect(s.needsReview).toBe(true);
  });

  it('flags a present-but-unrecognized tag for review', () => {
    const s = categorize(input({ rawTag: '#🦄 Something New', kind: 'paid' }), INDEX);
    expect(s.needsReview).toBe(true);
    expect(s.categoryId).toBeNull();
  });
});

describe('categorize — merchant keywords (fallback when no tag)', () => {
  it('matches a brand in the counterparty name', () => {
    const s = categorize(input({ counterpartyName: 'ZEPTO Marketplace' }), INDEX);
    expect(s.categoryId).toBe(catId('Groceries'));
    expect(s.confidence).toBe('medium');
    expect(s.needsReview).toBe(false);
    expect(s.via).toBe('merchant');
  });

  it('matches Bengaluru Metro → Commute/Metro', () => {
    const s = categorize(input({ counterpartyName: 'Bengaluru Metro QR Tickets' }), INDEX);
    const commute = INDEX.byName.get('commute')!;
    expect(s.categoryId).toBe(commute.id);
    expect(s.subcategoryId).toBe(commute.subcategories.find((x) => x.name === 'Metro')!.id);
  });

  it('lets the tag win over a merchant keyword', () => {
    // Name contains "metro" (Commute) but the user tagged it Food — tag wins.
    const s = categorize(input({ rawTag: '#🥘 Food', counterpartyName: 'Metro Cafe' }), INDEX);
    expect(s.categoryId).toBe(catId('Food & Dining'));
    expect(s.via).toBe('tag');
  });
});

describe('categorize — kind fallback', () => {
  it('routes a Gold Coin redemption to Investments', () => {
    const s = categorize(input({ kind: 'gold', direction: 'out' }), INDEX);
    expect(s.categoryId).toBe(catId('Investments & Mutual Funds'));
    expect(s.needsReview).toBe(false);
  });

  it('routes a refund to CashBack', () => {
    const s = categorize(input({ kind: 'refund', direction: 'in' }), INDEX);
    expect(s.categoryId).toBe(catId('CashBack'));
  });

  it('leaves a plain self-transfer uncategorized without review', () => {
    const s = categorize(input({ kind: 'self', direction: 'self' }), INDEX);
    expect(s.categoryId).toBeNull();
    expect(s.needsReview).toBe(false);
  });

  it('flags an untagged, unknown "Paid to" merchant for review', () => {
    const s = categorize(input({ kind: 'paid', counterpartyName: 'Some Random Person' }), INDEX);
    expect(s.categoryId).toBeNull();
    expect(s.needsReview).toBe(true);
    expect(s.confidence).toBe('low');
  });
});

describe('categorize — learned rules (highest priority)', () => {
  const groceries = catId('Groceries');

  it('applies a learned VPA rule with high confidence', () => {
    const learned: LearnedRule[] = [
      // matcherKey is stored normalized — the repository normalizes before saving.
      { matcherType: 'vpa', matcherKey: normalizeText('shop123@ptys'), categoryId: groceries, subcategoryId: null },
    ];
    const s = categorize(input({ counterpartyVpa: 'shop123@ptys', kind: 'paid' }), INDEX, learned);
    expect(s.categoryId).toBe(groceries);
    expect(s.via).toBe('learned');
    expect(s.needsReview).toBe(false);
  });

  it('overrides even the Paytm tag (the user edited this one before)', () => {
    const learned: LearnedRule[] = [
      { matcherType: 'merchant', matcherKey: 'linga reddy', categoryId: groceries, subcategoryId: null },
    ];
    // Tag says Food, but the user previously re-filed this merchant as Groceries.
    const s = categorize(
      input({ rawTag: '#🥘 Food', counterpartyName: 'Linga Reddy' }),
      INDEX,
      learned,
    );
    expect(s.categoryId).toBe(groceries);
    expect(s.via).toBe('learned');
  });

  it('ignores a learned rule whose category was deleted', () => {
    const learned: LearnedRule[] = [
      { matcherType: 'merchant', matcherKey: 'ghost', categoryId: 9999, subcategoryId: null },
    ];
    const s = categorize(input({ counterpartyName: 'Ghost', kind: 'paid' }), INDEX, learned);
    expect(s.via).not.toBe('learned');
    expect(s.needsReview).toBe(true);
  });
});

describe('rule tables stay consistent with the seed categories', () => {
  it('every tag alias points at a real seed category (and sub-category, if named)', () => {
    const problems: string[] = [];
    for (const [tag, alias] of Object.entries(TAG_ALIASES)) {
      const cat = INDEX.byName.get(normalizeText(alias.category));
      if (!cat) {
        problems.push(`alias "${tag}" → missing category "${alias.category}"`);
        continue;
      }
      if (alias.subcategory) {
        const found = cat.subcategories.some((s) => normalizeText(s.name) === normalizeText(alias.subcategory!));
        if (!found) problems.push(`alias "${tag}" → missing sub "${alias.subcategory}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every keyword rule points at a real seed category (and sub-category, if named)', () => {
    const problems: string[] = [];
    for (const rule of KEYWORD_RULES) {
      const cat = INDEX.byName.get(normalizeText(rule.category));
      if (!cat) {
        problems.push(`keyword "${rule.keyword}" → missing category "${rule.category}"`);
        continue;
      }
      if (rule.subcategory) {
        const found = cat.subcategories.some((s) => normalizeText(s.name) === normalizeText(rule.subcategory!));
        if (!found) problems.push(`keyword "${rule.keyword}" → missing sub "${rule.subcategory}"`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('categorize — notes drive the sub-category', () => {
  const food = () => INDEX.byName.get(normalizeText('Food & Dining'))!;
  const groceries = () => INDEX.byName.get(normalizeText('Groceries'))!;
  const subId = (cat: ReturnType<typeof food>, name: string) =>
    cat.subcategories.find((s) => s.name === name)!.id;

  it('refines the sub-category from the note when it fits the tag category', () => {
    // Tag = Food (category), note "biriyani" → Food/Biriyani sub, still high confidence, no review.
    const s = categorize(input({ rawTag: '#🥘 Food', remarks: 'biriyani' }), INDEX);
    expect(s.categoryId).toBe(food().id);
    expect(s.subcategoryId).toBe(subId(food(), 'Biriyani'));
    expect(s.needsReview).toBe(false);
  });

  it('tolerates a typo in the note via conservative fuzzy matching (biriani ≈ biriyani)', () => {
    // "biriani" is not a static keyword, but a LEARNED note rule matches it fuzzily.
    const learned: LearnedRule[] = [
      { matcherType: 'note', matcherKey: 'biriyani', categoryId: food().id, subcategoryId: subId(food(), 'Biriyani') },
    ];
    const s = categorize(input({ rawTag: '#🥘 Food', remarks: 'biriani' }), INDEX, learned);
    expect(s.subcategoryId).toBe(subId(food(), 'Biriyani'));
  });

  it('keeps the stronger category but flags review when the note implies a different one', () => {
    // Learned payee = Groceries, but the note says "uthappam" (a static keyword? no) → use a static
    // Food note-word to force the conflict: note "dosa" (Food) vs learned Groceries.
    const learned: LearnedRule[] = [
      { matcherType: 'merchant', matcherKey: 'linga reddy', categoryId: groceries().id, subcategoryId: null },
    ];
    const s = categorize(input({ counterpartyName: 'Linga Reddy', remarks: 'dosa' }), INDEX, learned);
    expect(s.categoryId).toBe(groceries().id); // stronger signal kept
    expect(s.needsReview).toBe(true); // but surfaced for confirmation
  });

  it('supplies the category from the note when the payee is unknown', () => {
    // Random merchant, no tag, note "uthappam" learned as Food/Dosa → category comes from the note.
    const learned: LearnedRule[] = [
      { matcherType: 'note', matcherKey: 'uthappam', categoryId: food().id, subcategoryId: subId(food(), 'Dosa') },
    ];
    const s = categorize(input({ counterpartyName: 'Sri Krishna Tiffins', kind: 'paid', remarks: 'uthappam' }), INDEX, learned);
    expect(s.categoryId).toBe(food().id);
    expect(s.subcategoryId).toBe(subId(food(), 'Dosa'));
    expect(s.via).toBe('note');
  });

  it('matches note words whole-word only (no false substring hits)', () => {
    // "tea" must not fire on "steamed" — and with no other signal this stays needs-review.
    const s = categorize(input({ counterpartyName: 'Some Person', kind: 'paid', remarks: 'steamed momos' }), INDEX);
    expect(s.via).not.toBe('note');
  });

  it('never lets a note override an intentional transfer', () => {
    const s = categorize(input({ rawTag: '#💵 Self Transfer', kind: 'self', remarks: 'rent' }), INDEX);
    expect(s.categoryId).toBeNull();
    expect(s.needsReview).toBe(false);
    expect(s.via).toBe('transfer');
  });
});
