/**
 * Integration test against the REAL Axis + KVB sample statements in `Refernce sample data/`.
 * Those files hold personal data (git-ignored), so this suite auto-skips when they're absent.
 *
 * The core check is a RUNNING-BALANCE reconciliation: for every consecutive pair of rows,
 *   balance[i] - balance[i-1]  ==  (credit[i] - debit[i])
 * using the amount + side our adapter parsed. If that holds across the whole file, every amount
 * and every debit/credit decision was parsed correctly — the "no missed / no mis-read entry" proof.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

import { parseBankAmount } from '../../domain/money';
import { axisAdapter } from '../adapters/axis';
import { field } from '../adapters/bank-common';
import { kvbAdapter } from '../adapters/kvb';
import { sbiAdapter } from '../adapters/sbi';
import { runImport } from '../pipeline';
import type { SourceAdapter } from '../types';
import { workbookToSheets } from '../xlsx';

const DATA_DIR = path.resolve(__dirname, '../../../../..', 'Refernce sample data');
const AXIS = path.join(DATA_DIR, 'AcctStatement_XXX0815_19082026.xls');
const KVB = path.join(DATA_DIR, '4879XXXXXX0050_19082026200156.xlsx');
const SBI = path.join(DATA_DIR, 'AccountStatement_20082026_16426.xlsx');

const readSheets = (f: string) => workbookToSheets(XLSX.readFile(f));

/** Verify the running-balance column steps by exactly the parsed signed amount, row over row. */
function reconcileRunningBalance(file: string, adapter: SourceAdapter, balHeader: string) {
  const sheets = readSheets(file);
  const preview = runImport(sheets, [adapter]);
  expect(preview.source).toBe('bank');
  expect(preview.errors).toHaveLength(0); // nothing dropped as a non-transaction
  expect(preview.parsed).toHaveLength(preview.totalRows); // parsed[i] aligns with the data rows

  const dataRows = adapter.rows!(adapter.selectSheet(sheets));
  const balances = dataRows.map((r) => parseBankAmount(field(r.cells, balHeader)));

  let mismatches = 0;
  for (let i = 1; i < preview.parsed.length; i++) {
    const t = preview.parsed[i];
    const signed = t.ledgerSide === 'credit' ? t.paise : -t.paise;
    if (balances[i] - balances[i - 1] !== signed) mismatches++;
  }
  return { preview, mismatches, rows: preview.parsed.length };
}

const suite = fs.existsSync(AXIS) && fs.existsSync(KVB) ? describe : describe.skip;

suite('bank real-file import', () => {
  it('Axis: running balance reconciles for every row', () => {
    const { preview, mismatches } = reconcileRunningBalance(AXIS, axisAdapter, 'bal');
    expect(mismatches).toBe(0);
    // A real statement has both spends and credits, and RRNs pulled from the narration.
    expect(preview.totalDebitPaise).toBeGreaterThan(0);
    expect(preview.totalCreditPaise).toBeGreaterThan(0);
    expect(preview.parsed.some((t) => t.sourceRef && /^\d{6,20}$/.test(t.sourceRef))).toBe(true);
    // Self-transfers to the account holder are detected (IMPS to own name).
    expect(preview.parsed.some((t) => t.direction === 'self')).toBe(true);
  });

  it('KVB: running balance reconciles for every row', () => {
    const { preview, mismatches } = reconcileRunningBalance(KVB, kvbAdapter, 'running balance');
    expect(mismatches).toBe(0);
    expect(preview.totalDebitPaise + preview.totalCreditPaise).toBeGreaterThan(0);
  });

  it('cross-source dedupe: a shared UPI ref collapses Axis + KVB (no double count)', () => {
    const axis = runImport(readSheets(AXIS), [axisAdapter]);
    const keys = new Set(axis.newTxns.map((t) => t.dedupeKey));
    const kvb = runImport(readSheets(KVB), [kvbAdapter], keys);
    // The Axis↔KVB self-transfer (IMPS 606038652798) appears in both → recognised as a duplicate.
    expect(kvb.duplicates.length).toBeGreaterThan(0);
    expect(kvb.newTxns.length + kvb.duplicates.length).toBe(kvb.parsed.length);
  });
});

const sbiSuite = fs.existsSync(SBI) && fs.existsSync(AXIS) ? describe : describe.skip;

sbiSuite('SBI real-file import', () => {
  it('running balance reconciles for every row', () => {
    const { preview, mismatches } = reconcileRunningBalance(SBI, sbiAdapter, 'balance');
    expect(mismatches).toBe(0);
    expect(preview.totalDebitPaise).toBeGreaterThan(0);
    expect(preview.totalCreditPaise).toBeGreaterThan(0);
  });

  it('guard: a DIRECT DR naming the holder is a real debit, not a self-transfer', () => {
    const preview = runImport(readSheets(SBI), [sbiAdapter]);
    const directDr = preview.parsed.find((t) => t.rawDetails.toUpperCase().includes('DIRECT DR'));
    expect(directDr).toBeDefined();
    expect(directDr!.direction).toBe('out');
    expect(directDr!.counterpartyName).toBeNull();
  });

  it('cross-source dedupe: the shared UPI ref collapses the Axis + SBI legs of one transfer', () => {
    const axis = runImport(readSheets(AXIS), [axisAdapter]);
    const keys = new Set(axis.newTxns.map((t) => t.dedupeKey));
    const sbi = runImport(readSheets(SBI), [sbiAdapter], keys);
    // RRN 618411469877 (Axis→SBI "Car" transfer) is in both files → the SBI leg is a duplicate,
    // and both legs are self-transfers, so the ₹27,000 never counts as spend or income.
    expect(sbi.duplicates.some((t) => t.sourceRef === '618411469877')).toBe(true);
    expect(sbi.parsed.find((t) => t.sourceRef === '618411469877')!.direction).toBe('self');
    expect(axis.newTxns.find((t) => t.sourceRef === '618411469877')!.direction).toBe('self');
  });
});
