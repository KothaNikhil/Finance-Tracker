import { categories, paymentModes, people, subcategories } from './schema';
import type { FinanceDatabase } from './runtime';
import { SEED_CATEGORIES, SEED_PAYMENT_MODES, SEED_PEOPLE } from './seed';

export function seedDatabase(db: FinanceDatabase): void {
  const already = db.select({ id: categories.id }).from(categories).limit(1).all();
  if (already.length > 0) return;

  SEED_CATEGORIES.forEach((category, categoryIndex) => {
    const inserted = db
      .insert(categories)
      .values({ name: category.name, emoji: category.emoji, sortOrder: categoryIndex })
      .returning({ id: categories.id })
      .all();
    const categoryId = inserted[0].id;

    category.subcategories.forEach((name, subcategoryIndex) => {
      db.insert(subcategories).values({ categoryId, name, sortOrder: subcategoryIndex }).run();
    });
  });

  SEED_PAYMENT_MODES.forEach((name, index) => {
    db.insert(paymentModes).values({ name, sortOrder: index }).run();
  });
  SEED_PEOPLE.forEach((name, index) => {
    db.insert(people).values({ name, sortOrder: index }).run();
  });
}
