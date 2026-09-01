/**
 * Display-text fallbacks.
 *
 * Three columns are `NOT NULL DEFAULT ''` (`transactions.raw_details`, `loans.name`,
 * `imports.source_label`), so a `??` chain over them stops at the empty string and renders nothing.
 * Anything picking the first usable label out of such fields must go through {@link firstText}.
 */

/** First value that has visible text, treating `''` (the `raw_details` default) as absent. */
export function firstText(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}
