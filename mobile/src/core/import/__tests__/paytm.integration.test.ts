/**
 * Integration test against the REAL Paytm sample files in `Refernce sample data/`.
 *
 * Those files hold personal data, so they are git-ignored and not committed. This test
 * therefore auto-skips when the files are absent (e.g. in CI), and runs locally where they
 * exist — proving the whole read → normalize → dedupe path on real data, including the
 * May-vs-April–July overlap (the exact "don't double-count" scenario).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

import { paytmAdapter } from '../adapters/paytm';
import { runImport } from '../pipeline';
import { workbookToSheets } from '../xlsx';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const DATA_DIR = path.join(REPO_ROOT, 'Refernce sample data');
const MAY_FILE = path.join(DATA_DIR, "Paytm_UPI_Statement_01_May'26_-_31_May'26.xlsx");
const APR_JUL_FILE = path.join(DATA_DIR, "Paytm_UPI_Statement_30_Apr'26_-_30_Jul'26.xlsx");

const haveFiles = fs.existsSync(MAY_FILE) && fs.existsSync(APR_JUL_FILE);
const suite = haveFiles ? describe : describe.skip;

function readSheets(file: string) {
  return workbookToSheets(XLSX.readFile(file));
}

suite('Paytm real-file import', () => {
  it('parses the May statement with no row errors', () => {
    const preview = runImport(readSheets(MAY_FILE), [paytmAdapter]);
    expect(preview.source).toBe('paytm');
    expect(preview.totalRows).toBeGreaterThan(0);
    expect(preview.errors).toHaveLength(0);
    expect(preview.parsed).toHaveLength(preview.totalRows);
    // On a first import, everything is new.
    expect(preview.newTxns.length).toBe(preview.parsed.length);
  });

  it('finds a mix of money out, money in, and self-transfers', () => {
    const { parsed } = runImport(readSheets(MAY_FILE), [paytmAdapter]);
    const dirs = new Set(parsed.map((t) => t.direction));
    expect(dirs.has('out')).toBe(true);
    expect(dirs.has('in')).toBe(true);
    expect(dirs.has('self')).toBe(true);
    // Emoji tags survive the round-trip.
    expect(parsed.some((t) => (t.rawTag ?? '').startsWith('#'))).toBe(true);
  });

  it('captures the user’s Remarks column into remarks', () => {
    const { parsed } = runImport(readSheets(MAY_FILE), [paytmAdapter]);
    const withRemarks = parsed.filter((t) => (t.remarks ?? '').trim() !== '');
    // The May file has many rows with a user note in "Remarks".
    expect(withRemarks.length).toBeGreaterThan(0);
    // A known row: "Paid to Sri Babu Raju Ram Fuel" carries the note "Fuel".
    expect(parsed.some((t) => t.remarks === 'Fuel')).toBe(true);
  });

  it('does NOT double-count: May rows re-appear as duplicates inside the Apr–Jul file', () => {
    const may = runImport(readSheets(MAY_FILE), [paytmAdapter]);
    const existingKeys = new Set(may.newTxns.map((t) => t.dedupeKey));

    const aprJul = runImport(readSheets(APR_JUL_FILE), [paytmAdapter], existingKeys);

    // Every May transaction shows up again in the wider file → all counted as duplicates.
    expect(aprJul.duplicates.length).toBeGreaterThanOrEqual(may.newTxns.length);
    // But the wider file also has genuinely new (April/June/July) transactions.
    expect(aprJul.newTxns.length).toBeGreaterThan(0);
    // Accounting adds up: every parsed row is either new or a duplicate.
    expect(aprJul.newTxns.length + aprJul.duplicates.length).toBe(aprJul.parsed.length);
  });

  it('is idempotent: importing the same file twice adds nothing the second time', () => {
    const first = runImport(readSheets(MAY_FILE), [paytmAdapter]);
    const keys = new Set(first.newTxns.map((t) => t.dedupeKey));
    const second = runImport(readSheets(MAY_FILE), [paytmAdapter], keys);
    expect(second.newTxns).toHaveLength(0);
  });
});
