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

/**
 * A keyword → category rule. Two flavours, chosen by `on`:
 *  - `'brand'`  — a well-known merchant/brand. Matched as a **substring** of the payee text
 *                 (counterparty name + raw narration + VPA), medium confidence.
 *  - `'note'`   — a purpose word the user types in a note ("dosa", "petrol", "rent"). Matched
 *                 **whole-word** against the note ONLY (not the narration), so it drives the
 *                 sub-category (and the category when the payee is unknown).
 *
 * `ambiguous` means the keyword maps to more than one plausible place (e.g. fuel → Bike vs Car):
 * we still guess, but flag the row for review.
 *
 * ORDERING MATTERS — the table is scanned top-to-bottom and the FIRST keyword found wins, so a
 * compound/specific key must sit above a shorter one it contains (`reliance digital` before any
 * bare `reliance`, `metropolis` before `metro`, `boat lifestyle` before `lifestyle`).
 *
 * Never add a bare substring that collides with common words or with people's names (most UPI
 * counterparties are individuals): e.g. no bare `jio` (→ `jiomart`), no bare `cred` (→ "credited"),
 * no bare `nike`/`zara` (→ names). Use qualified forms instead. A unit test asserts every rule's
 * (category, sub) exists in the seed list.
 */
export interface KeywordRule {
  keyword: string;
  category: string;
  subcategory?: string;
  on: 'brand' | 'note';
  ambiguous?: boolean;
}

const FOOD = 'Food & Dining';
const GROC = 'Groceries';
const MED = 'Medicine & Health';

export const KEYWORD_RULES: KeywordRule[] = [
  // ── Brands (substring match on name / narration / VPA) ─────────────────────────────────────
  // Food & Dining
  { keyword: 'swiggy', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'zomato', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'eatsure', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'faasos', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'behrouz', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'oven story', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'box8', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'freshmenu', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'kfc', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'mcdonald', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'burger king', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'subway', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'wow momo', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'wow china', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'haldiram', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'bikanervala', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'sagar ratna', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'saravana bhavan', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'adyar ananda', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'a2b', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'barbeque nation', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'absolute barbecue', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'mainland china', category: FOOD, subcategory: 'Restaurant', on: 'brand' },
  { keyword: 'biryani blues', category: FOOD, subcategory: 'Biriyani', on: 'brand' },
  { keyword: 'domino', category: FOOD, subcategory: 'Dominos', on: 'brand' },
  { keyword: 'pizza hut', category: FOOD, subcategory: 'Dominos', on: 'brand' },
  { keyword: 'papa johns', category: FOOD, subcategory: 'Dominos', on: 'brand' },
  { keyword: 'la pinoz', category: FOOD, subcategory: 'Dominos', on: 'brand' },
  { keyword: 'starbucks', category: FOOD, subcategory: 'Tea', on: 'brand' },
  { keyword: 'cafe coffee day', category: FOOD, subcategory: 'Tea', on: 'brand' },
  { keyword: 'ccd', category: FOOD, subcategory: 'Tea', on: 'brand' },
  { keyword: 'barista', category: FOOD, subcategory: 'Tea', on: 'brand' },
  { keyword: 'costa coffee', category: FOOD, subcategory: 'Tea', on: 'brand' },
  { keyword: 'third wave', category: FOOD, subcategory: 'Tea', on: 'brand' },
  { keyword: 'blue tokai', category: FOOD, subcategory: 'Tea', on: 'brand' },
  { keyword: 'chaayos', category: FOOD, subcategory: 'Tea', on: 'brand' },
  { keyword: 'chai point', category: FOOD, subcategory: 'Tea', on: 'brand' },
  { keyword: 'chai sutta', category: FOOD, subcategory: 'Tea', on: 'brand' },
  { keyword: 'dunkin', category: FOOD, subcategory: 'Tea', on: 'brand' },
  // 'naturals ice' must sit above Personal Care's bare 'naturals' (salon).
  { keyword: 'naturals ice', category: FOOD, subcategory: 'Cake', on: 'brand' },
  { keyword: 'theobroma', category: FOOD, subcategory: 'Cake', on: 'brand' },
  { keyword: 'monginis', category: FOOD, subcategory: 'Cake', on: 'brand' },
  { keyword: 'mio amore', category: FOOD, subcategory: 'Cake', on: 'brand' },
  { keyword: 'baskin robbins', category: FOOD, subcategory: 'Cake', on: 'brand' },
  { keyword: 'cream stone', category: FOOD, subcategory: 'Cake', on: 'brand' },
  { keyword: 'havmor', category: FOOD, subcategory: 'Cake', on: 'brand' },
  { keyword: 'keventers', category: FOOD, subcategory: 'Cake', on: 'brand' },
  { keyword: 'belgian waffle', category: FOOD, subcategory: 'Cake', on: 'brand' },

  // Groceries
  { keyword: 'zepto', category: GROC, on: 'brand' },
  { keyword: 'blinkit', category: GROC, on: 'brand' },
  { keyword: 'instamart', category: GROC, on: 'brand' },
  { keyword: 'bigbasket', category: GROC, on: 'brand' },
  { keyword: 'jiomart', category: GROC, on: 'brand' },
  { keyword: 'dunzo', category: GROC, on: 'brand' },
  { keyword: 'dmart', category: GROC, on: 'brand' },
  { keyword: 'd mart', category: GROC, on: 'brand' },
  { keyword: 'reliance fresh', category: GROC, on: 'brand' },
  { keyword: 'reliance smart', category: GROC, on: 'brand' },
  { keyword: 'more supermarket', category: GROC, on: 'brand' },
  { keyword: 'spencers', category: GROC, on: 'brand' },
  { keyword: 'star bazaar', category: GROC, on: 'brand' },
  { keyword: 'nature basket', category: GROC, on: 'brand' },
  { keyword: 'nilgiris', category: GROC, on: 'brand' },
  { keyword: 'heritage fresh', category: GROC, on: 'brand' },
  { keyword: 'ratnadeep', category: GROC, on: 'brand' },
  { keyword: 'licious', category: GROC, on: 'brand' },
  { keyword: 'fresh to home', category: GROC, on: 'brand' },
  { keyword: 'freshtohome', category: GROC, on: 'brand' },
  { keyword: 'zappfresh', category: GROC, on: 'brand' },
  { keyword: 'amul', category: GROC, on: 'brand' },
  { keyword: 'mother dairy', category: GROC, subcategory: 'Milk', on: 'brand' },
  { keyword: 'country delight', category: GROC, subcategory: 'Milk', on: 'brand' },
  { keyword: 'nandini milk', category: GROC, subcategory: 'Milk', on: 'brand' },

  // Medicine & Health — 'metropolis' before Commute's 'metro'.
  { keyword: 'metropolis', category: MED, subcategory: 'Test', on: 'brand' },
  { keyword: 'pharmeasy', category: MED, on: 'brand' },
  { keyword: '1mg', category: MED, on: 'brand' },
  { keyword: 'netmeds', category: MED, on: 'brand' },
  { keyword: 'apollo pharmacy', category: MED, on: 'brand' },
  { keyword: 'medplus', category: MED, on: 'brand' },
  { keyword: 'wellness forever', category: MED, on: 'brand' },
  { keyword: 'frank ross', category: MED, on: 'brand' },
  { keyword: 'pharmacy', category: MED, on: 'brand' },
  { keyword: 'medical', category: MED, on: 'brand' },
  { keyword: 'medicals', category: MED, on: 'brand' },
  { keyword: 'hospital', category: MED, on: 'brand' },
  { keyword: 'clinic', category: MED, on: 'brand' },
  { keyword: 'nursing home', category: MED, on: 'brand' },
  { keyword: 'dr lal', category: MED, subcategory: 'Test', on: 'brand' },
  { keyword: 'lal path', category: MED, subcategory: 'Test', on: 'brand' },
  { keyword: 'thyrocare', category: MED, subcategory: 'Test', on: 'brand' },
  { keyword: 'agilus', category: MED, subcategory: 'Test', on: 'brand' },
  { keyword: 'vijaya diagnostic', category: MED, subcategory: 'Test', on: 'brand' },
  { keyword: 'srl diagnostic', category: MED, subcategory: 'Test', on: 'brand' },
  { keyword: 'diagnostic', category: MED, subcategory: 'Test', on: 'brand' },
  { keyword: 'pathology', category: MED, subcategory: 'Test', on: 'brand' },
  { keyword: 'aarthi scan', category: MED, subcategory: 'Scan', on: 'brand' },

  // Recharge & Telecom — qualified airtel variants before bare 'airtel'.
  { keyword: 'airtel digital tv', category: 'Recharge', subcategory: 'DTH', on: 'brand' },
  { keyword: 'airtel xstream', category: 'Recharge', subcategory: 'Wifi', on: 'brand' },
  { keyword: 'airtel', category: 'Recharge', subcategory: 'Mobile', on: 'brand' },
  { keyword: 'vodafone', category: 'Recharge', subcategory: 'Mobile', on: 'brand' },
  { keyword: 'vi recharge', category: 'Recharge', subcategory: 'Mobile', on: 'brand' },
  { keyword: 'bsnl broadband', category: 'Recharge', subcategory: 'Wifi', on: 'brand' },
  { keyword: 'bsnl', category: 'Recharge', subcategory: 'Mobile', on: 'brand' },
  { keyword: 'jio recharge', category: 'Recharge', subcategory: 'Mobile', on: 'brand' },
  { keyword: 'jio prepaid', category: 'Recharge', subcategory: 'Mobile', on: 'brand' },
  { keyword: 'jio infocomm', category: 'Recharge', subcategory: 'Mobile', on: 'brand' },
  { keyword: 'reliance jio', category: 'Recharge', subcategory: 'Mobile', on: 'brand' },
  { keyword: 'jiofiber', category: 'Recharge', subcategory: 'Wifi', on: 'brand' },
  { keyword: 'jio fiber', category: 'Recharge', subcategory: 'Wifi', on: 'brand' },
  { keyword: 'act fibernet', category: 'Recharge', subcategory: 'Wifi', on: 'brand' },
  { keyword: 'actcorp', category: 'Recharge', subcategory: 'Wifi', on: 'brand' },
  { keyword: 'hathway', category: 'Recharge', subcategory: 'Wifi', on: 'brand' },
  { keyword: 'excitel', category: 'Recharge', subcategory: 'Wifi', on: 'brand' },
  { keyword: 'spectra', category: 'Recharge', subcategory: 'Wifi', on: 'brand' },
  { keyword: 'you broadband', category: 'Recharge', subcategory: 'Wifi', on: 'brand' },
  { keyword: 'tikona', category: 'Recharge', subcategory: 'Wifi', on: 'brand' },
  { keyword: 'tata play', category: 'Recharge', subcategory: 'DTH', on: 'brand' },
  { keyword: 'tata sky', category: 'Recharge', subcategory: 'DTH', on: 'brand' },
  { keyword: 'dish tv', category: 'Recharge', subcategory: 'DTH', on: 'brand' },
  { keyword: 'd2h', category: 'Recharge', subcategory: 'DTH', on: 'brand' },
  { keyword: 'sun direct', category: 'Recharge', subcategory: 'DTH', on: 'brand' },

  // Commute
  { keyword: 'namma metro', category: 'Commute', subcategory: 'Metro', on: 'brand' },
  { keyword: 'hyderabad metro', category: 'Commute', subcategory: 'Metro', on: 'brand' },
  { keyword: 'chennai metro', category: 'Commute', subcategory: 'Metro', on: 'brand' },
  { keyword: 'metro', category: 'Commute', subcategory: 'Metro', on: 'brand' },
  { keyword: 'dmrc', category: 'Commute', subcategory: 'Metro', on: 'brand' },
  { keyword: 'bmrcl', category: 'Commute', subcategory: 'Metro', on: 'brand' },
  { keyword: 'cmrl', category: 'Commute', subcategory: 'Metro', on: 'brand' },
  { keyword: 'bmtc', category: 'Commute', subcategory: 'Bus', on: 'brand' },
  { keyword: 'ksrtc', category: 'Commute', subcategory: 'Bus', on: 'brand' },
  { keyword: 'apsrtc', category: 'Commute', subcategory: 'Bus', on: 'brand' },
  { keyword: 'tsrtc', category: 'Commute', subcategory: 'Bus', on: 'brand' },
  { keyword: 'msrtc', category: 'Commute', subcategory: 'Bus', on: 'brand' },
  { keyword: 'tnstc', category: 'Commute', subcategory: 'Bus', on: 'brand' },
  { keyword: 'irctc', category: 'Commute', subcategory: 'Train', on: 'brand' },
  { keyword: 'indian railway', category: 'Commute', subcategory: 'Train', on: 'brand' },
  { keyword: 'ola', category: 'Commute', subcategory: 'Auto', on: 'brand' },
  { keyword: 'uber', category: 'Commute', subcategory: 'Auto', on: 'brand' },
  { keyword: 'rapido', category: 'Commute', subcategory: 'Auto', on: 'brand' },
  { keyword: 'namma yatri', category: 'Commute', subcategory: 'Auto', on: 'brand' },
  { keyword: 'blusmart', category: 'Commute', subcategory: 'Auto', on: 'brand' },

  // Travel
  { keyword: 'makemytrip', category: 'Travel', on: 'brand' },
  { keyword: 'make my trip', category: 'Travel', on: 'brand' },
  { keyword: 'goibibo', category: 'Travel', on: 'brand' },
  { keyword: 'cleartrip', category: 'Travel', on: 'brand' },
  { keyword: 'ixigo', category: 'Travel', on: 'brand' },
  { keyword: 'easemytrip', category: 'Travel', on: 'brand' },
  { keyword: 'yatra', category: 'Travel', on: 'brand' },
  { keyword: 'indigo', category: 'Travel', subcategory: 'Flight', on: 'brand' },
  { keyword: 'air india', category: 'Travel', subcategory: 'Flight', on: 'brand' },
  { keyword: 'vistara', category: 'Travel', subcategory: 'Flight', on: 'brand' },
  { keyword: 'spicejet', category: 'Travel', subcategory: 'Flight', on: 'brand' },
  { keyword: 'akasa', category: 'Travel', subcategory: 'Flight', on: 'brand' },
  { keyword: 'goair', category: 'Travel', subcategory: 'Flight', on: 'brand' },
  { keyword: 'airasia', category: 'Travel', subcategory: 'Flight', on: 'brand' },
  { keyword: 'oyo', category: 'Travel', subcategory: 'Hotel', on: 'brand' },
  { keyword: 'treebo', category: 'Travel', subcategory: 'Hotel', on: 'brand' },
  { keyword: 'fabhotels', category: 'Travel', subcategory: 'Hotel', on: 'brand' },
  { keyword: 'lemon tree', category: 'Travel', subcategory: 'Hotel', on: 'brand' },
  { keyword: 'ginger hotel', category: 'Travel', subcategory: 'Hotel', on: 'brand' },
  { keyword: 'taj hotel', category: 'Travel', subcategory: 'Hotel', on: 'brand' },
  { keyword: 'marriott', category: 'Travel', subcategory: 'Hotel', on: 'brand' },
  { keyword: 'airbnb', category: 'Travel', subcategory: 'Hotel', on: 'brand' },
  { keyword: 'redbus', category: 'Travel', subcategory: 'Cab', on: 'brand' },
  { keyword: 'abhibus', category: 'Travel', subcategory: 'Cab', on: 'brand' },
  { keyword: 'zoomcar', category: 'Travel', subcategory: 'Cab', on: 'brand' },
  { keyword: 'revv', category: 'Travel', subcategory: 'Cab', on: 'brand' },

  // Shopping — Electronics/Fashion specifics before the generic Shopping brands.
  { keyword: 'boat lifestyle', category: 'Shopping', subcategory: 'Electronics', on: 'brand' },
  { keyword: 'croma', category: 'Shopping', subcategory: 'Electronics', on: 'brand' },
  { keyword: 'reliance digital', category: 'Shopping', subcategory: 'Electronics', on: 'brand' },
  { keyword: 'vijay sales', category: 'Shopping', subcategory: 'Electronics', on: 'brand' },
  { keyword: 'sangeetha mobiles', category: 'Shopping', subcategory: 'Electronics', on: 'brand' },
  { keyword: 'poorvika', category: 'Shopping', subcategory: 'Electronics', on: 'brand' },
  { keyword: 'lot mobiles', category: 'Shopping', subcategory: 'Electronics', on: 'brand' },
  { keyword: 'apple store', category: 'Shopping', subcategory: 'Electronics', on: 'brand' },
  { keyword: 'mi store', category: 'Shopping', subcategory: 'Electronics', on: 'brand' },
  { keyword: 'samsung', category: 'Shopping', subcategory: 'Electronics', on: 'brand' },
  { keyword: 'tanishq', category: 'Shopping', subcategory: 'Jewellery', on: 'brand' },
  { keyword: 'kalyan jewel', category: 'Shopping', subcategory: 'Jewellery', on: 'brand' },
  { keyword: 'malabar gold', category: 'Shopping', subcategory: 'Jewellery', on: 'brand' },
  { keyword: 'joyalukkas', category: 'Shopping', subcategory: 'Jewellery', on: 'brand' },
  { keyword: 'pc jeweller', category: 'Shopping', subcategory: 'Jewellery', on: 'brand' },
  { keyword: 'grt jewel', category: 'Shopping', subcategory: 'Jewellery', on: 'brand' },
  { keyword: 'senco gold', category: 'Shopping', subcategory: 'Jewellery', on: 'brand' },
  { keyword: 'bhima jewel', category: 'Shopping', subcategory: 'Jewellery', on: 'brand' },
  { keyword: 'caratlane', category: 'Shopping', subcategory: 'Jewellery', on: 'brand' },
  { keyword: 'tata cliq luxury', category: 'Shopping', subcategory: 'Fashion', on: 'brand' },
  { keyword: 'myntra', category: 'Shopping', subcategory: 'Fashion', on: 'brand' },
  { keyword: 'ajio', category: 'Shopping', subcategory: 'Fashion', on: 'brand' },
  { keyword: 'nykaa', category: 'Shopping', subcategory: 'Fashion', on: 'brand' },
  { keyword: 'westside', category: 'Shopping', subcategory: 'Fashion', on: 'brand' },
  { keyword: 'max fashion', category: 'Shopping', subcategory: 'Fashion', on: 'brand' },
  { keyword: 'pantaloons', category: 'Shopping', subcategory: 'Fashion', on: 'brand' },
  { keyword: 'shoppers stop', category: 'Shopping', subcategory: 'Fashion', on: 'brand' },
  { keyword: 'reliance trends', category: 'Shopping', subcategory: 'Fashion', on: 'brand' },
  { keyword: 'adidas', category: 'Shopping', subcategory: 'Fashion', on: 'brand' },
  { keyword: 'levis', category: 'Shopping', subcategory: 'Fashion', on: 'brand' },
  { keyword: 'bata', category: 'Shopping', subcategory: 'Fashion', on: 'brand' },
  { keyword: 'zudio', category: 'Shopping', subcategory: 'Clothes', on: 'brand' },
  { keyword: 'uniqlo', category: 'Shopping', subcategory: 'Clothes', on: 'brand' },
  { keyword: 'amazon prime', category: 'Entertainment', subcategory: 'Subscriptions', on: 'brand' },
  { keyword: 'prime video', category: 'Entertainment', subcategory: 'Subscriptions', on: 'brand' },
  { keyword: 'amazon', category: 'Shopping', on: 'brand' },
  { keyword: 'flipkart', category: 'Shopping', on: 'brand' },
  { keyword: 'meesho', category: 'Shopping', on: 'brand' },
  { keyword: 'snapdeal', category: 'Shopping', on: 'brand' },
  { keyword: 'tata cliq', category: 'Shopping', on: 'brand' },
  { keyword: 'shopsy', category: 'Shopping', on: 'brand' },

  // Entertainment
  { keyword: 'netflix', category: 'Entertainment', subcategory: 'Subscriptions', on: 'brand' },
  { keyword: 'hotstar', category: 'Entertainment', subcategory: 'Subscriptions', on: 'brand' },
  { keyword: 'disney', category: 'Entertainment', subcategory: 'Subscriptions', on: 'brand' },
  { keyword: 'sonyliv', category: 'Entertainment', subcategory: 'Subscriptions', on: 'brand' },
  { keyword: 'sony liv', category: 'Entertainment', subcategory: 'Subscriptions', on: 'brand' },
  { keyword: 'zee5', category: 'Entertainment', subcategory: 'Subscriptions', on: 'brand' },
  { keyword: 'jiocinema', category: 'Entertainment', subcategory: 'Subscriptions', on: 'brand' },
  { keyword: 'jio cinema', category: 'Entertainment', subcategory: 'Subscriptions', on: 'brand' },
  { keyword: 'spotify', category: 'Entertainment', subcategory: 'Subscriptions', on: 'brand' },
  { keyword: 'gaana', category: 'Entertainment', subcategory: 'Subscriptions', on: 'brand' },
  { keyword: 'wynk', category: 'Entertainment', subcategory: 'Subscriptions', on: 'brand' },
  { keyword: 'youtube premium', category: 'Entertainment', subcategory: 'Subscriptions', on: 'brand' },
  { keyword: 'apple music', category: 'Entertainment', subcategory: 'Subscriptions', on: 'brand' },
  { keyword: 'audible', category: 'Entertainment', subcategory: 'Subscriptions', on: 'brand' },
  { keyword: 'bookmyshow', category: 'Entertainment', subcategory: 'Movie', on: 'brand' },
  { keyword: 'book my show', category: 'Entertainment', subcategory: 'Movie', on: 'brand' },
  { keyword: 'pvr', category: 'Entertainment', subcategory: 'Movie', on: 'brand' },
  { keyword: 'inox', category: 'Entertainment', subcategory: 'Movie', on: 'brand' },
  { keyword: 'cinepolis', category: 'Entertainment', subcategory: 'Movie', on: 'brand' },
  { keyword: 'carnival cinema', category: 'Entertainment', subcategory: 'Movie', on: 'brand' },
  { keyword: 'steam', category: 'Entertainment', subcategory: 'Games', on: 'brand' },
  { keyword: 'playstation', category: 'Entertainment', subcategory: 'Games', on: 'brand' },
  { keyword: 'xbox', category: 'Entertainment', subcategory: 'Games', on: 'brand' },
  { keyword: 'nintendo', category: 'Entertainment', subcategory: 'Games', on: 'brand' },
  { keyword: 'dream11', category: 'Entertainment', subcategory: 'Games', on: 'brand' },

  // Investments — brokers → Stocks, MF platforms → Mutual funds, gold → Paytm gold.
  { keyword: 'zerodha', category: 'Investments & Mutual Funds', subcategory: 'Stocks', on: 'brand' },
  { keyword: 'groww', category: 'Investments & Mutual Funds', subcategory: 'Stocks', on: 'brand' },
  { keyword: 'upstox', category: 'Investments & Mutual Funds', subcategory: 'Stocks', on: 'brand' },
  { keyword: 'angel one', category: 'Investments & Mutual Funds', subcategory: 'Stocks', on: 'brand' },
  { keyword: 'angelone', category: 'Investments & Mutual Funds', subcategory: 'Stocks', on: 'brand' },
  { keyword: '5paisa', category: 'Investments & Mutual Funds', subcategory: 'Stocks', on: 'brand' },
  { keyword: 'dhan', category: 'Investments & Mutual Funds', subcategory: 'Stocks', on: 'brand' },
  { keyword: 'paytm gold', category: 'Investments & Mutual Funds', subcategory: 'Paytm gold', on: 'brand' },
  { keyword: 'augmont', category: 'Investments & Mutual Funds', subcategory: 'Paytm gold', on: 'brand' },
  { keyword: 'safegold', category: 'Investments & Mutual Funds', subcategory: 'Paytm gold', on: 'brand' },
  { keyword: 'mmtc pamp', category: 'Investments & Mutual Funds', subcategory: 'Paytm gold', on: 'brand' },
  { keyword: 'kuvera', category: 'Investments & Mutual Funds', subcategory: 'Mutual funds', on: 'brand' },
  { keyword: 'indmoney', category: 'Investments & Mutual Funds', subcategory: 'Mutual funds', on: 'brand' },
  { keyword: 'smallcase', category: 'Investments & Mutual Funds', subcategory: 'Mutual funds', on: 'brand' },
  { keyword: 'paytm money', category: 'Investments & Mutual Funds', subcategory: 'Mutual funds', on: 'brand' },
  { keyword: 'et money', category: 'Investments & Mutual Funds', subcategory: 'Mutual funds', on: 'brand' },
  { keyword: 'kfintech', category: 'Investments & Mutual Funds', subcategory: 'Mutual funds', on: 'brand' },
  { keyword: 'cams', category: 'Investments & Mutual Funds', subcategory: 'Mutual funds', on: 'brand' },
  { keyword: 'mf utilities', category: 'Investments & Mutual Funds', subcategory: 'Mutual funds', on: 'brand' },

  // Fuel — ambiguous between Bike and Car; guess Bike/Fuel but flag for review.
  { keyword: 'indian oil', category: 'Bike', subcategory: 'Fuel', on: 'brand', ambiguous: true },
  { keyword: 'iocl', category: 'Bike', subcategory: 'Fuel', on: 'brand', ambiguous: true },
  { keyword: 'bharat petroleum', category: 'Bike', subcategory: 'Fuel', on: 'brand', ambiguous: true },
  { keyword: 'bpcl', category: 'Bike', subcategory: 'Fuel', on: 'brand', ambiguous: true },
  { keyword: 'hindustan petroleum', category: 'Bike', subcategory: 'Fuel', on: 'brand', ambiguous: true },
  { keyword: 'hpcl', category: 'Bike', subcategory: 'Fuel', on: 'brand', ambiguous: true },
  { keyword: 'nayara', category: 'Bike', subcategory: 'Fuel', on: 'brand', ambiguous: true },
  { keyword: 'shell petrol', category: 'Bike', subcategory: 'Fuel', on: 'brand', ambiguous: true },
  { keyword: 'petroleum', category: 'Bike', subcategory: 'Fuel', on: 'brand', ambiguous: true },
  { keyword: 'petrol', category: 'Bike', subcategory: 'Fuel', on: 'brand', ambiguous: true },
  { keyword: 'filling station', category: 'Bike', subcategory: 'Fuel', on: 'brand', ambiguous: true },
  { keyword: 'fuels', category: 'Bike', subcategory: 'Fuel', on: 'brand', ambiguous: true },

  // Car
  { keyword: 'fastag', category: 'Car', subcategory: 'FASTag', on: 'brand' },
  { keyword: 'netc', category: 'Car', subcategory: 'FASTag', on: 'brand' },

  // Rent & Utilities — electricity boards / DISCOMs, LPG, water utilities.
  { keyword: 'adani electricity', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'tata power', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'torrent power', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'bescom', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'mescom', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'tneb', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'tangedco', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'apspdcl', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'apepdcl', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'tsspdcl', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'msedcl', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'mahadiscom', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'bses', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'cesc', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'uppcl', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'pspcl', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'discom', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'brand' },
  { keyword: 'indane', category: 'Rent & Utilities', subcategory: 'Gas', on: 'brand' },
  { keyword: 'bharat gas', category: 'Rent & Utilities', subcategory: 'Gas', on: 'brand' },
  { keyword: 'hp gas', category: 'Rent & Utilities', subcategory: 'Gas', on: 'brand' },
  { keyword: 'hpgas', category: 'Rent & Utilities', subcategory: 'Gas', on: 'brand' },
  { keyword: 'mahanagar gas', category: 'Rent & Utilities', subcategory: 'Gas', on: 'brand' },
  { keyword: 'indraprastha gas', category: 'Rent & Utilities', subcategory: 'Gas', on: 'brand' },
  { keyword: 'adani total gas', category: 'Rent & Utilities', subcategory: 'Gas', on: 'brand' },
  { keyword: 'adani gas', category: 'Rent & Utilities', subcategory: 'Gas', on: 'brand' },
  { keyword: 'sabarmati gas', category: 'Rent & Utilities', subcategory: 'Gas', on: 'brand' },
  { keyword: 'gail', category: 'Rent & Utilities', subcategory: 'Gas', on: 'brand' },
  { keyword: 'bwssb', category: 'Rent & Utilities', subcategory: 'Water', on: 'brand' },
  { keyword: 'hmwssb', category: 'Rent & Utilities', subcategory: 'Water', on: 'brand' },
  { keyword: 'cmwssb', category: 'Rent & Utilities', subcategory: 'Water', on: 'brand' },
  { keyword: 'jal board', category: 'Rent & Utilities', subcategory: 'Water', on: 'brand' },
  { keyword: 'water board', category: 'Rent & Utilities', subcategory: 'Water', on: 'brand' },

  // Personal Care — 'naturals ice' (Food) already handled above.
  { keyword: 'naturals salon', category: 'Personal Care', subcategory: 'Hair cut', on: 'brand' },
  { keyword: 'naturals', category: 'Personal Care', subcategory: 'Hair cut', on: 'brand' },
  { keyword: 'lakme salon', category: 'Personal Care', subcategory: 'Hair cut', on: 'brand' },
  { keyword: 'jawed habib', category: 'Personal Care', subcategory: 'Hair cut', on: 'brand' },
  { keyword: 'green trends', category: 'Personal Care', subcategory: 'Hair cut', on: 'brand' },
  { keyword: 'toni and guy', category: 'Personal Care', subcategory: 'Hair cut', on: 'brand' },
  { keyword: 'enrich salon', category: 'Personal Care', subcategory: 'Hair cut', on: 'brand' },
  { keyword: 'urban company', category: 'Personal Care', subcategory: 'Grooming', on: 'brand' },
  { keyword: 'urbanclap', category: 'Personal Care', subcategory: 'Grooming', on: 'brand' },
  { keyword: 'bombay shaving', category: 'Personal Care', subcategory: 'Grooming', on: 'brand' },
  { keyword: 'the man company', category: 'Personal Care', subcategory: 'Grooming', on: 'brand' },
  { keyword: 'beardo', category: 'Personal Care', subcategory: 'Grooming', on: 'brand' },

  // Fitness
  { keyword: 'cultfit', category: 'Fitness', subcategory: 'Gym', on: 'brand' },
  { keyword: 'cult fit', category: 'Fitness', subcategory: 'Gym', on: 'brand' },
  { keyword: 'cure fit', category: 'Fitness', subcategory: 'Gym', on: 'brand' },
  { keyword: 'curefit', category: 'Fitness', subcategory: 'Gym', on: 'brand' },
  { keyword: 'golds gym', category: 'Fitness', subcategory: 'Gym', on: 'brand' },
  { keyword: 'gold gym', category: 'Fitness', subcategory: 'Gym', on: 'brand' },
  { keyword: 'anytime fitness', category: 'Fitness', subcategory: 'Gym', on: 'brand' },
  { keyword: 'snap fitness', category: 'Fitness', subcategory: 'Gym', on: 'brand' },
  { keyword: 'talwalkars', category: 'Fitness', subcategory: 'Gym', on: 'brand' },

  // Credit Card Payment — no bare 'cred' (collides with "credited").
  { keyword: 'cred pay', category: 'Credit Card Payment', subcategory: 'Bill payment', on: 'brand' },
  { keyword: 'cred club', category: 'Credit Card Payment', subcategory: 'Bill payment', on: 'brand' },
  { keyword: 'dreamplug', category: 'Credit Card Payment', subcategory: 'Bill payment', on: 'brand' },
  { keyword: 'credit card payment', category: 'Credit Card Payment', subcategory: 'Bill payment', on: 'brand' },
  { keyword: 'card payment', category: 'Credit Card Payment', subcategory: 'Bill payment', on: 'brand' },

  // Services — insurance (no bare 'lic').
  { keyword: 'lic of india', category: 'Services', subcategory: 'Financial Services', on: 'brand' },
  { keyword: 'licindia', category: 'Services', subcategory: 'Financial Services', on: 'brand' },
  { keyword: 'hdfc life', category: 'Services', subcategory: 'Financial Services', on: 'brand' },
  { keyword: 'sbi life', category: 'Services', subcategory: 'Financial Services', on: 'brand' },
  { keyword: 'icici pru', category: 'Services', subcategory: 'Financial Services', on: 'brand' },
  { keyword: 'icici lombard', category: 'Services', subcategory: 'Financial Services', on: 'brand' },
  { keyword: 'max life', category: 'Services', subcategory: 'Financial Services', on: 'brand' },
  { keyword: 'bajaj allianz', category: 'Services', subcategory: 'Financial Services', on: 'brand' },
  { keyword: 'star health', category: 'Services', subcategory: 'Financial Services', on: 'brand' },
  { keyword: 'policybazaar', category: 'Services', subcategory: 'Financial Services', on: 'brand' },
  { keyword: 'digit insurance', category: 'Services', subcategory: 'Financial Services', on: 'brand' },
  { keyword: 'acko', category: 'Services', subcategory: 'Financial Services', on: 'brand' },
  { keyword: 'tata aig', category: 'Services', subcategory: 'Financial Services', on: 'brand' },
  { keyword: 'hdfc ergo', category: 'Services', subcategory: 'Financial Services', on: 'brand' },
  { keyword: 'new india assurance', category: 'Services', subcategory: 'Financial Services', on: 'brand' },

  // ── Note purpose-words (whole-word match on the user's NOTE only) ──────────────────────────
  // Food & Dining. 'egg …' dishes must precede Groceries' bare 'egg'/'eggs' below.
  { keyword: 'egg rice', category: FOOD, subcategory: 'Restaurant', on: 'note' },
  { keyword: 'egg curry', category: FOOD, subcategory: 'Restaurant', on: 'note' },
  { keyword: 'egg biryani', category: FOOD, subcategory: 'Biriyani', on: 'note' },
  { keyword: 'egg puff', category: FOOD, subcategory: 'Snacks', on: 'note' },
  { keyword: 'tea', category: FOOD, subcategory: 'Tea', on: 'note' },
  { keyword: 'chai', category: FOOD, subcategory: 'Tea', on: 'note' },
  { keyword: 'coffee', category: FOOD, subcategory: 'Tea', on: 'note' },
  { keyword: 'dosa', category: FOOD, subcategory: 'Dosa', on: 'note' },
  { keyword: 'idli', category: FOOD, subcategory: 'Dosa', on: 'note' },
  { keyword: 'idly', category: FOOD, subcategory: 'Dosa', on: 'note' },
  { keyword: 'biriyani', category: FOOD, subcategory: 'Biriyani', on: 'note' },
  { keyword: 'biryani', category: FOOD, subcategory: 'Biriyani', on: 'note' },
  { keyword: 'briyani', category: FOOD, subcategory: 'Biriyani', on: 'note' },
  { keyword: 'juice', category: FOOD, subcategory: 'Juice', on: 'note' },
  { keyword: 'lassi', category: FOOD, subcategory: 'Juice', on: 'note' },
  { keyword: 'shake', category: FOOD, subcategory: 'Juice', on: 'note' },
  { keyword: 'smoothie', category: FOOD, subcategory: 'Juice', on: 'note' },
  { keyword: 'cake', category: FOOD, subcategory: 'Cake', on: 'note' },
  { keyword: 'pastry', category: FOOD, subcategory: 'Cake', on: 'note' },
  { keyword: 'ice cream', category: FOOD, subcategory: 'Cake', on: 'note' },
  { keyword: 'icecream', category: FOOD, subcategory: 'Cake', on: 'note' },
  { keyword: 'dessert', category: FOOD, subcategory: 'Cake', on: 'note' },
  { keyword: 'brownie', category: FOOD, subcategory: 'Cake', on: 'note' },
  { keyword: 'snacks', category: FOOD, subcategory: 'Snacks', on: 'note' },
  { keyword: 'snack', category: FOOD, subcategory: 'Snacks', on: 'note' },
  { keyword: 'samosa', category: FOOD, subcategory: 'Snacks', on: 'note' },
  { keyword: 'vada', category: FOOD, subcategory: 'Snacks', on: 'note' },
  { keyword: 'bajji', category: FOOD, subcategory: 'Snacks', on: 'note' },
  { keyword: 'bonda', category: FOOD, subcategory: 'Snacks', on: 'note' },
  { keyword: 'pakoda', category: FOOD, subcategory: 'Snacks', on: 'note' },
  { keyword: 'chaat', category: FOOD, subcategory: 'Snacks', on: 'note' },
  { keyword: 'puff', category: FOOD, subcategory: 'Snacks', on: 'note' },
  { keyword: 'lunch', category: FOOD, subcategory: 'Restaurant', on: 'note' },
  { keyword: 'dinner', category: FOOD, subcategory: 'Restaurant', on: 'note' },
  { keyword: 'breakfast', category: FOOD, subcategory: 'Restaurant', on: 'note' },
  { keyword: 'brunch', category: FOOD, subcategory: 'Restaurant', on: 'note' },
  { keyword: 'meals', category: FOOD, subcategory: 'Restaurant', on: 'note' },
  { keyword: 'thali', category: FOOD, subcategory: 'Restaurant', on: 'note' },
  { keyword: 'pizza', category: FOOD, subcategory: 'Restaurant', on: 'note' },
  { keyword: 'burger', category: FOOD, subcategory: 'Restaurant', on: 'note' },
  { keyword: 'sandwich', category: FOOD, subcategory: 'Restaurant', on: 'note' },
  // Groceries
  { keyword: 'milk', category: GROC, subcategory: 'Milk', on: 'note' },
  { keyword: 'curd', category: GROC, subcategory: 'Curd', on: 'note' },
  { keyword: 'dahi', category: GROC, subcategory: 'Curd', on: 'note' },
  { keyword: 'yogurt', category: GROC, subcategory: 'Curd', on: 'note' },
  { keyword: 'paneer', category: GROC, subcategory: 'Paneer', on: 'note' },
  // Only the PLURAL "eggs" means a grocery run; singular "egg" is almost always a cooked dish
  // ("egg fry", "egg dosa") which stays Food via the tag, so it's intentionally not a rule here.
  { keyword: 'eggs', category: GROC, subcategory: 'Eggs', on: 'note' },
  { keyword: 'vegetables', category: GROC, subcategory: 'Vegetables', on: 'note' },
  { keyword: 'veggies', category: GROC, subcategory: 'Vegetables', on: 'note' },
  { keyword: 'sabji', category: GROC, subcategory: 'Vegetables', on: 'note' },
  { keyword: 'sabzi', category: GROC, subcategory: 'Vegetables', on: 'note' },
  { keyword: 'tomato', category: GROC, subcategory: 'Vegetables', on: 'note' },
  { keyword: 'onion', category: GROC, subcategory: 'Vegetables', on: 'note' },
  { keyword: 'potato', category: GROC, subcategory: 'Vegetables', on: 'note' },
  { keyword: 'fruits', category: GROC, subcategory: 'Fruits', on: 'note' },
  { keyword: 'fruit', category: GROC, subcategory: 'Fruits', on: 'note' },
  { keyword: 'banana', category: GROC, subcategory: 'Fruits', on: 'note' },
  { keyword: 'mango', category: GROC, subcategory: 'Fruits', on: 'note' },
  { keyword: 'grapes', category: GROC, subcategory: 'Fruits', on: 'note' },
  { keyword: 'groceries', category: GROC, on: 'note' },
  { keyword: 'grocery', category: GROC, on: 'note' },
  { keyword: 'provisions', category: GROC, on: 'note' },
  // Medicine & Health
  { keyword: 'tablet', category: MED, subcategory: 'Tablet', on: 'note' },
  { keyword: 'tablets', category: MED, subcategory: 'Tablet', on: 'note' },
  { keyword: 'medicine', category: MED, subcategory: 'Tablet', on: 'note' },
  { keyword: 'medicines', category: MED, subcategory: 'Tablet', on: 'note' },
  { keyword: 'pills', category: MED, subcategory: 'Tablet', on: 'note' },
  { keyword: 'syrup', category: MED, subcategory: 'Tablet', on: 'note' },
  { keyword: 'scan', category: MED, subcategory: 'Scan', on: 'note' },
  { keyword: 'xray', category: MED, subcategory: 'Scan', on: 'note' },
  { keyword: 'x ray', category: MED, subcategory: 'Scan', on: 'note' },
  { keyword: 'mri', category: MED, subcategory: 'Scan', on: 'note' },
  { keyword: 'ultrasound', category: MED, subcategory: 'Scan', on: 'note' },
  { keyword: 'appointment', category: MED, subcategory: 'Appointment', on: 'note' },
  { keyword: 'doctor', category: MED, subcategory: 'Appointment', on: 'note' },
  { keyword: 'consultation', category: MED, subcategory: 'Appointment', on: 'note' },
  { keyword: 'checkup', category: MED, subcategory: 'Appointment', on: 'note' },
  { keyword: 'blood test', category: MED, subcategory: 'Test', on: 'note' },
  { keyword: 'bloodtest', category: MED, subcategory: 'Test', on: 'note' },
  { keyword: 'lab test', category: MED, subcategory: 'Test', on: 'note' },
  { keyword: 'test', category: MED, subcategory: 'Test', on: 'note' },
  { keyword: 'health insurance', category: MED, subcategory: 'Health insurance', on: 'note' },
  { keyword: 'mediclaim', category: MED, subcategory: 'Health insurance', on: 'note' },
  // Vehicles — fuel ambiguous; specific bike/car chores.
  { keyword: 'petrol', category: 'Bike', subcategory: 'Fuel', on: 'note', ambiguous: true },
  { keyword: 'diesel', category: 'Bike', subcategory: 'Fuel', on: 'note', ambiguous: true },
  { keyword: 'fuel', category: 'Bike', subcategory: 'Fuel', on: 'note', ambiguous: true },
  { keyword: 'water wash', category: 'Bike', subcategory: 'Water wash', on: 'note' },
  { keyword: 'bike wash', category: 'Bike', subcategory: 'Water wash', on: 'note' },
  { keyword: 'bike service', category: 'Bike', subcategory: 'Service', on: 'note' },
  { keyword: 'bike cover', category: 'Bike', subcategory: 'Cover', on: 'note' },
  { keyword: 'car emi', category: 'Car', subcategory: 'Car EMI', on: 'note' },
  { keyword: 'car service', category: 'Car', subcategory: 'Service', on: 'note' },
  // Commute
  { keyword: 'metro', category: 'Commute', subcategory: 'Metro', on: 'note' },
  { keyword: 'bus', category: 'Commute', subcategory: 'Bus', on: 'note' },
  { keyword: 'train', category: 'Commute', subcategory: 'Train', on: 'note' },
  { keyword: 'auto', category: 'Commute', subcategory: 'Auto', on: 'note' },
  { keyword: 'rickshaw', category: 'Commute', subcategory: 'Auto', on: 'note' },
  { keyword: 'ola', category: 'Commute', subcategory: 'Auto', on: 'note' },
  { keyword: 'uber', category: 'Commute', subcategory: 'Auto', on: 'note' },
  // Recharge
  { keyword: 'mobile recharge', category: 'Recharge', subcategory: 'Mobile', on: 'note' },
  { keyword: 'recharge', category: 'Recharge', subcategory: 'Mobile', on: 'note' },
  { keyword: 'data pack', category: 'Recharge', subcategory: 'Data', on: 'note' },
  { keyword: 'datapack', category: 'Recharge', subcategory: 'Data', on: 'note' },
  { keyword: 'wifi', category: 'Recharge', subcategory: 'Wifi', on: 'note' },
  { keyword: 'broadband', category: 'Recharge', subcategory: 'Wifi', on: 'note' },
  { keyword: 'internet', category: 'Recharge', subcategory: 'Wifi', on: 'note' },
  { keyword: 'dth', category: 'Recharge', subcategory: 'DTH', on: 'note' },
  // Rent & Utilities
  { keyword: 'house rent', category: 'Rent & Utilities', subcategory: 'Rent', on: 'note' },
  { keyword: 'rent', category: 'Rent & Utilities', subcategory: 'Rent', on: 'note' },
  { keyword: 'current bill', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'note' },
  { keyword: 'eb bill', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'note' },
  { keyword: 'power bill', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'note' },
  { keyword: 'electricity', category: 'Rent & Utilities', subcategory: 'Electricity', on: 'note' },
  { keyword: 'water bill', category: 'Rent & Utilities', subcategory: 'Water', on: 'note' },
  { keyword: 'cylinder', category: 'Rent & Utilities', subcategory: 'Gas', on: 'note' },
  { keyword: 'lpg', category: 'Rent & Utilities', subcategory: 'Gas', on: 'note' },
  { keyword: 'gas', category: 'Rent & Utilities', subcategory: 'Gas', on: 'note' },
  // Shopping
  { keyword: 'clothes', category: 'Shopping', subcategory: 'Clothes', on: 'note' },
  { keyword: 'dress', category: 'Shopping', subcategory: 'Clothes', on: 'note' },
  { keyword: 'shirt', category: 'Shopping', subcategory: 'Clothes', on: 'note' },
  { keyword: 'tshirt', category: 'Shopping', subcategory: 'Clothes', on: 'note' },
  { keyword: 'jeans', category: 'Shopping', subcategory: 'Clothes', on: 'note' },
  { keyword: 'saree', category: 'Shopping', subcategory: 'Clothes', on: 'note' },
  { keyword: 'kurta', category: 'Shopping', subcategory: 'Clothes', on: 'note' },
  { keyword: 'footwear', category: 'Shopping', subcategory: 'Fashion', on: 'note' },
  { keyword: 'shoes', category: 'Shopping', subcategory: 'Fashion', on: 'note' },
  { keyword: 'sandals', category: 'Shopping', subcategory: 'Fashion', on: 'note' },
  { keyword: 'chappal', category: 'Shopping', subcategory: 'Fashion', on: 'note' },
  { keyword: 'jewellery', category: 'Shopping', subcategory: 'Jewellery', on: 'note' },
  { keyword: 'jewelry', category: 'Shopping', subcategory: 'Jewellery', on: 'note' },
  { keyword: 'electronics', category: 'Shopping', subcategory: 'Electronics', on: 'note' },
  { keyword: 'charger', category: 'Shopping', subcategory: 'Electronics', on: 'note' },
  { keyword: 'earphones', category: 'Shopping', subcategory: 'Electronics', on: 'note' },
  { keyword: 'headphones', category: 'Shopping', subcategory: 'Electronics', on: 'note' },
  // Entertainment
  { keyword: 'movie', category: 'Entertainment', subcategory: 'Movie', on: 'note' },
  { keyword: 'cinema', category: 'Entertainment', subcategory: 'Movie', on: 'note' },
  { keyword: 'games', category: 'Entertainment', subcategory: 'Games', on: 'note' },
  { keyword: 'game', category: 'Entertainment', subcategory: 'Games', on: 'note' },
  { keyword: 'gaming', category: 'Entertainment', subcategory: 'Games', on: 'note' },
  { keyword: 'subscription', category: 'Entertainment', subcategory: 'Subscriptions', on: 'note' },
  { keyword: 'subscriptions', category: 'Entertainment', subcategory: 'Subscriptions', on: 'note' },
  // Investments
  { keyword: 'mutual fund', category: 'Investments & Mutual Funds', subcategory: 'Mutual funds', on: 'note' },
  { keyword: 'mutual funds', category: 'Investments & Mutual Funds', subcategory: 'Mutual funds', on: 'note' },
  { keyword: 'sip', category: 'Investments & Mutual Funds', subcategory: 'Mutual funds', on: 'note' },
  { keyword: 'stocks', category: 'Investments & Mutual Funds', subcategory: 'Stocks', on: 'note' },
  { keyword: 'shares', category: 'Investments & Mutual Funds', subcategory: 'Stocks', on: 'note' },
  { keyword: 'equity', category: 'Investments & Mutual Funds', subcategory: 'Stocks', on: 'note' },
  { keyword: 'gold coin', category: 'Investments & Mutual Funds', subcategory: 'Paytm gold', on: 'note' },
  { keyword: 'digital gold', category: 'Investments & Mutual Funds', subcategory: 'Paytm gold', on: 'note' },
  // Fitness
  { keyword: 'gym', category: 'Fitness', subcategory: 'Gym', on: 'note' },
  { keyword: 'workout', category: 'Fitness', subcategory: 'Gym', on: 'note' },
  { keyword: 'fitness', category: 'Fitness', subcategory: 'Gym', on: 'note' },
  { keyword: 'badminton', category: 'Fitness', subcategory: 'Badminton', on: 'note' },
  { keyword: 'shuttle', category: 'Fitness', subcategory: 'Shuttle', on: 'note' },
  { keyword: 'shuttlecock', category: 'Fitness', subcategory: 'Shuttle', on: 'note' },
  // Personal Care
  { keyword: 'haircut', category: 'Personal Care', subcategory: 'Hair cut', on: 'note' },
  { keyword: 'hair cut', category: 'Personal Care', subcategory: 'Hair cut', on: 'note' },
  { keyword: 'salon', category: 'Personal Care', subcategory: 'Hair cut', on: 'note' },
  { keyword: 'saloon', category: 'Personal Care', subcategory: 'Hair cut', on: 'note' },
  { keyword: 'barber', category: 'Personal Care', subcategory: 'Hair cut', on: 'note' },
  { keyword: 'grooming', category: 'Personal Care', subcategory: 'Grooming', on: 'note' },
  { keyword: 'spa', category: 'Personal Care', subcategory: 'Grooming', on: 'note' },
  { keyword: 'facial', category: 'Personal Care', subcategory: 'Grooming', on: 'note' },
  { keyword: 'massage', category: 'Personal Care', subcategory: 'Grooming', on: 'note' },
  // Essentials
  { keyword: 'household', category: 'Essentials', subcategory: 'Household', on: 'note' },
  { keyword: 'detergent', category: 'Essentials', subcategory: 'Household', on: 'note' },
  { keyword: 'cleaning', category: 'Essentials', subcategory: 'Household', on: 'note' },
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
