import { fuzzyEqual, levenshtein } from '../fuzzy';

describe('levenshtein', () => {
  it('is 0 for identical strings and length for empty comparisons', () => {
    expect(levenshtein('dosa', 'dosa')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('counts single edits', () => {
    expect(levenshtein('biriyani', 'biriani')).toBe(1); // one deletion
    expect(levenshtein('tea', 'sea')).toBe(1); // one substitution
  });
});

describe('fuzzyEqual (conservative)', () => {
  it('requires an exact match for very short words', () => {
    expect(fuzzyEqual('tea', 'sea')).toBe(false); // different first char anyway
    expect(fuzzyEqual('cat', 'cot')).toBe(false); // <4 chars → 0 edits allowed
    expect(fuzzyEqual('tea', 'tea')).toBe(true);
  });

  it('allows one edit for short words that share a first character', () => {
    expect(fuzzyEqual('biriyani', 'biriani')).toBe(true);
    expect(fuzzyEqual('paneer', 'panner')).toBe(true);
  });

  it('never matches across different first characters', () => {
    expect(fuzzyEqual('dosa', 'rosa')).toBe(false);
  });

  it('handles empty input safely', () => {
    expect(fuzzyEqual('', 'dosa')).toBe(false);
    expect(fuzzyEqual('dosa', '')).toBe(false);
  });
});
