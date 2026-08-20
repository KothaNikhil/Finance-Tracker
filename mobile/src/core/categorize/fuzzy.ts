/**
 * Conservative fuzzy string matching for hand-typed notes ("biriani" ≈ "biriyani").
 *
 * Notes carry typos, so an exact match misses obvious variants. But loose matching is dangerous
 * for short words ("tea" vs "sea" is one edit), so this is deliberately strict:
 *   - both strings must share the SAME first character, and
 *   - the allowed edit distance scales with length (0 for very short, 1 for short, 2 for long).
 *
 * Inputs are expected already normalized (lower-cased, alphanumeric-collapsed) by the caller.
 * Pure TypeScript — unit-testable in Node.
 */

/** Standard Levenshtein edit distance (insert/delete/substitute), iterative two-row form. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** How many edits we tolerate for a word of this length (the shorter of the two being compared). */
function allowedEdits(len: number): number {
  if (len < 4) return 0; // too short to fuzz safely — require exact
  if (len < 8) return 1;
  return 2;
}

/**
 * True when two normalized strings are the same word allowing for a small typo. Requires a shared
 * first character to keep short words from colliding (e.g. "tea"/"sea" never match).
 */
export function fuzzyEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a[0] !== b[0]) return false;
  const budget = allowedEdits(Math.min(a.length, b.length));
  if (budget === 0) return false;
  return levenshtein(a, b) <= budget;
}
