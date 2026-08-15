import { SEED_CATEGORIES, SEED_PAYMENT_MODES, SEED_PEOPLE } from '../seed';

describe('seed data', () => {
  it('has categories, each with an emoji and at least one sub-category', () => {
    expect(SEED_CATEGORIES.length).toBeGreaterThan(0);
    for (const cat of SEED_CATEGORIES) {
      expect(cat.name.trim()).not.toBe('');
      expect(cat.emoji.trim()).not.toBe('');
      expect(cat.subcategories.length).toBeGreaterThan(0);
    }
  });

  it('has unique category names', () => {
    const names = SEED_CATEGORIES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has unique sub-category names within each category', () => {
    for (const cat of SEED_CATEGORIES) {
      expect(new Set(cat.subcategories).size).toBe(cat.subcategories.length);
    }
  });

  it('has unique, non-empty payment modes and people', () => {
    expect(new Set(SEED_PAYMENT_MODES).size).toBe(SEED_PAYMENT_MODES.length);
    expect(new Set(SEED_PEOPLE).size).toBe(SEED_PEOPLE.length);
    expect(SEED_PAYMENT_MODES.every((m) => m.trim() !== '')).toBe(true);
    expect(SEED_PEOPLE.every((p) => p.trim() !== '')).toBe(true);
  });
});
