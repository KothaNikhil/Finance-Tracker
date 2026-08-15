/**
 * Money helpers. All money in the app is stored as INTEGER PAISE (1 rupee = 100 paise)
 * so totals never drift from floating-point rounding. Convert to rupees only for display.
 *
 * This file is pure TypeScript (no React Native imports) so it can be unit-tested in Node
 * and reused by a future web app.
 */

/** Which way the money moved. `self` = a transfer between the user's own accounts. */
export type Direction = 'in' | 'out' | 'self';

export interface ParsedAmount {
  /** Positive magnitude in paise (never negative). */
  paise: number;
  direction: Direction;
}

// Anything that is not a digit, sign, or decimal point (₹, commas, spaces, letters).
const NON_AMOUNT_CHARS = /[^0-9+\-.]/g;

/**
 * Parse a Paytm "Amount" cell, which is a text string such as:
 *   "-3,000.00"  → money out
 *   "+5,000.00"  → money in
 *   "27,000.00"  → NO sign = a self-transfer (Paytm leaves these unsigned)
 * The returned `paise` is always the positive magnitude; use `direction` for the sign meaning.
 */
export function parsePaytmAmount(raw: string): ParsedAmount {
  if (raw == null) throw new Error('Amount is empty');
  const trimmed = String(raw).trim();
  if (trimmed === '') throw new Error('Amount is empty');

  let direction: Direction;
  if (trimmed.startsWith('-')) direction = 'out';
  else if (trimmed.startsWith('+')) direction = 'in';
  else direction = 'self';

  const cleaned = trimmed.replace(NON_AMOUNT_CHARS, '').replace(/[+\-]/g, '');
  return { paise: decimalStringToPaise(cleaned), direction };
}

/**
 * Convert a plain decimal string (no sign, no commas) like "63.03" to paise (6303),
 * parsing digit-by-digit to avoid any floating-point error.
 */
export function decimalStringToPaise(value: string): number {
  if (value === '' || value === '.' || !/^\d*(\.\d*)?$/.test(value)) {
    throw new Error(`Invalid amount: "${value}"`);
  }
  const [intPart, fracRaw = ''] = value.split('.');
  const frac = (fracRaw + '00').slice(0, 2);
  const intPaise = (intPart === '' ? 0 : parseInt(intPart, 10)) * 100;
  return intPaise + parseInt(frac, 10);
}

/** Convert a rupee number (e.g. from manual entry) to paise, rounding safely. */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/** Convert paise back to a rupee number. */
export function paiseToRupees(paise: number): number {
  return paise / 100;
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format paise as an Indian-rupee string, e.g. 300000 → "₹3,000.00", 10000000 → "₹1,00,000.00". */
export function formatINR(paise: number): string {
  return inrFormatter.format(paise / 100);
}
