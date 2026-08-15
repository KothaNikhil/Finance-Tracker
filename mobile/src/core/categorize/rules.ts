/**
 * The rule tables that drive auto-categorization. These are pure data, derived from the
 * user's real Paytm statements (the tags they've assigned) and their seed category list, so
 * they can be unit-tested and tweaked without touching the matching logic in `categorize.ts`.
 *
 * All keys here are stored in NORMALIZED form (see normalizeTag / normalizeText): lower-cased,
 * emoji and punctuation collapsed to single spaces. That's how Paytm's `#🥘 Food` becomes the
 * lookup key `food`, and `#💵 Self-Transfer` and `#💵 Self Transfer` both become `self transfer`.
 */

import type { TxnKind } from '../import/types';

/** A tag that names one of the user's spend categories (optionally a specific sub-category). */
export interface TagAlias {
  category: string;
  subcategory?: string;
  /**
   * True when the tag maps to more than one plausible category (e.g. Fuel could be Bike or
   * Car). We still make the guess, but flag it for review.
   */
  ambiguous?: boolean;
}

/**
 * Paytm tag (normalized) → the user's category. The category/subcategory names must match the
 * seed list in `core/db/seed.ts`; a unit test enforces that so a typo can't silently break.
 */
export const TAG_ALIASES: Record<string, TagAlias> = {
  food: { category: 'Food & Dining' },
  groceries: { category: 'Groceries' },
  medical: { category: 'Medicine & Health' },
  commute: { category: 'Commute' },
  shopping: { category: 'Shopping' },
  recharge: { category: 'Recharge' },
  travel: { category: 'Travel' },
  miscellaneous: { category: 'Others' },
  services: { category: 'Services' },
  'financial services': { category: 'Services', subcategory: 'Financial Services' },
  fitness: { category: 'Fitness' },
  'bill payments': { category: 'Credit Card Payment', subcategory: 'Bill payment' },
  investment: { category: 'Investments & Mutual Funds' },
  refund: { category: 'CashBack', subcategory: 'Refund' },
  'car emi': { category: 'Car', subcategory: 'Car EMI' },
  // Fuel exists under both Bike and Car — guess Bike but ask the user to confirm.
  fuel: { category: 'Bike', subcategory: 'Fuel', ambiguous: true },
};

/**
 * Tags that mean "this isn't a spend/income category — it's a transfer between accounts or a
 * plain money-in/out with a person". We confidently leave these UNcategorized (no review
 * needed): forcing a spend category on them would pollute the dashboards.
 */
export const TAG_TRANSFERS = new Set(['self transfer', 'money received', 'money transfer']);

/**
 * Tags for features that don't exist in v1 yet (the Money Lent tracker is post-v1). We park
 * them under "Others" but always flag for review so they're easy to find later.
 */
export const TAG_NEEDS_REVIEW = new Set(['money lent']);

/** A well-known merchant/brand keyword → category. Matched as a substring, medium confidence. */
export interface MerchantRule {
  keyword: string;
  category: string;
  subcategory?: string;
}

/**
 * Brand keywords for when a row has no usable tag. Kept deliberately to well-known brands so a
 * substring match is safe; most Paytm counterparties are individual people (no brand to match),
 * which correctly fall through to "needs review".
 */
export const MERCHANT_RULES: MerchantRule[] = [
  { keyword: 'zomato', category: 'Food & Dining', subcategory: 'Restaurant' },
  { keyword: 'swiggy', category: 'Food & Dining', subcategory: 'Restaurant' },
  { keyword: 'domino', category: 'Food & Dining', subcategory: 'Dominos' },
  { keyword: 'zepto', category: 'Groceries' },
  { keyword: 'blinkit', category: 'Groceries' },
  { keyword: 'jiomart', category: 'Groceries' },
  { keyword: 'bigbasket', category: 'Groceries' },
  { keyword: 'metro', category: 'Commute', subcategory: 'Metro' },
  { keyword: 'bmtc', category: 'Commute', subcategory: 'Bus' },
  { keyword: 'irctc', category: 'Travel' },
  { keyword: 'reliance jio', category: 'Recharge', subcategory: 'Mobile' },
  { keyword: 'fastag', category: 'Car', subcategory: 'FASTag' },
  { keyword: 'zudio', category: 'Shopping', subcategory: 'Clothes' },
  { keyword: 'pharmacy', category: 'Medicine & Health' },
  { keyword: 'medicals', category: 'Medicine & Health' },
  { keyword: 'netflix', category: 'Entertainment', subcategory: 'Subscriptions' },
  { keyword: 'spotify', category: 'Entertainment', subcategory: 'Subscriptions' },
  { keyword: 'hotstar', category: 'Entertainment', subcategory: 'Subscriptions' },
];

/**
 * Last-resort guess from the statement wording (the parsed `kind`) when neither a tag nor a
 * merchant matched. `null` category means "leave uncategorized" (transfers, plain income);
 * `review: true` means we couldn't tell and a human should look.
 */
export interface KindDefault {
  category: string | null;
  subcategory?: string;
  review: boolean;
  reason: string;
}

export const KIND_DEFAULTS: Record<TxnKind, KindDefault> = {
  gold: { category: 'Investments & Mutual Funds', subcategory: 'Paytm gold', review: false, reason: 'Paytm gold' },
  refund: { category: 'CashBack', subcategory: 'Refund', review: false, reason: 'Refund' },
  billpay: { category: 'Credit Card Payment', subcategory: 'Bill payment', review: false, reason: 'Credit-card bill' },
  recharge: { category: 'Recharge', review: false, reason: 'Recharge' },
  self: { category: null, review: false, reason: 'Self-transfer' },
  received: { category: null, review: false, reason: 'Money received' },
  // These could be anything — a person you paid, an unknown merchant. Ask the user.
  sent: { category: null, review: true, reason: 'Money sent — needs a category' },
  paid: { category: null, review: true, reason: 'Unrecognized merchant' },
  other: { category: null, review: true, reason: 'Could not categorize' },
};
