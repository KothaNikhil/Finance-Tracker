/**
 * Integration test: run auto-categorization over the REAL Paytm sample files, using the exact
 * seed category list a fresh install ships with. Like the importer integration test, this
 * auto-skips when the (git-ignored) sample files are absent, and runs locally where they exist.
 *
 * It proves the whole path — read → normalize → categorize — on real tags/merchants, and pins
 * down the expected review rate so a rule change that suddenly flags everything gets caught.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

import { SEED_CATEGORIES } from '../../db/seed';
import { paytmAdapter } from '../../import/adapters/paytm';
import { runImport } from '../../import/pipeline';
import { workbookToSheets } from '../../import/xlsx';
import { buildCategoryIndex, categorize, normalizeTag, normalizeText } from '../categorize';
import type { CategoryIndex } from '../types';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const DATA_DIR = path.join(REPO_ROOT, 'Refernce sample data');
const MAY_FILE = path.join(DATA_DIR, "Paytm_UPI_Statement_01_May'26_-_31_May'26.xlsx");
const APR_JUL_FILE = path.join(DATA_DIR, "Paytm_UPI_Statement_30_Apr'26_-_30_Jul'26.xlsx");

const haveFiles = fs.existsSync(MAY_FILE) && fs.existsSync(APR_JUL_FILE);
const suite = haveFiles ? describe : describe.skip;

/** Build the index from the real seed list with database-like ids. */
function seedIndex(): CategoryIndex {
  const cats: { id: number; name: string; emoji: string | null }[] = [];
  const subs: { id: number; categoryId: number; name: string }[] = [];
  let subId = 1;
  SEED_CATEGORIES.forEach((c, i) => {
    cats.push({ id: i + 1, name: c.name, emoji: c.emoji });
    c.subcategories.forEach((name) => subs.push({ id: subId++, categoryId: i + 1, name }));
  });
  return buildCategoryIndex(cats, subs);
}

function importAll() {
  const may = runImport(workbookToSheets(XLSX.readFile(MAY_FILE)), [paytmAdapter]);
  const keys = new Set(may.newTxns.map((t) => t.dedupeKey));
  const aprJul = runImport(workbookToSheets(XLSX.readFile(APR_JUL_FILE)), [paytmAdapter], keys);
  return [...may.newTxns, ...aprJul.newTxns]; // deduped union across both files
}

suite('auto-categorization on real Paytm data', () => {
  const index = seedIndex();
  const txns = haveFiles ? importAll() : [];
  const results = txns.map((t) => ({ t, s: categorize(t, index, []) }));

  it('categorizes the large majority; only a small share needs review', () => {
    const total = results.length;
    const needReview = results.filter((r) => r.s.needsReview).length;
    // Nearly every real row is tagged, so review should be the exception, not the rule.
    expect(needReview / total).toBeLessThan(0.15);
  });

  it('maps every "#🥘 Food" row to Food & Dining with no review', () => {
    const food = index.byName.get(normalizeText('Food & Dining'))!;
    const foodRows = results.filter((r) => normalizeTag(r.t.rawTag) === 'food');
    expect(foodRows.length).toBeGreaterThan(0);
    for (const r of foodRows) {
      expect(r.s.categoryId).toBe(food.id);
      expect(r.s.needsReview).toBe(false);
    }
  });

  it('flags the ambiguous Fuel tag for review', () => {
    const fuelRows = results.filter((r) => normalizeTag(r.t.rawTag) === 'fuel');
    expect(fuelRows.length).toBeGreaterThan(0);
    for (const r of fuelRows) expect(r.s.needsReview).toBe(true);
  });

  it('leaves self-transfers and plain money-received uncategorized without review', () => {
    const transferRows = results.filter((r) =>
      ['self transfer', 'money received', 'money transfer'].includes(normalizeTag(r.t.rawTag)),
    );
    expect(transferRows.length).toBeGreaterThan(0);
    for (const r of transferRows) {
      expect(r.s.categoryId).toBeNull();
      expect(r.s.needsReview).toBe(false);
    }
  });

  it('never throws and always returns a decision for every row', () => {
    expect(results.every((r) => typeof r.s.needsReview === 'boolean')).toBe(true);
  });
});
