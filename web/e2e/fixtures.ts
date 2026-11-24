import type { Page } from '@playwright/test';
import { resolve } from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import { migrateSchema } from '@finance-tracker/core/db/migrations';
import { seedDatabase } from '@finance-tracker/core/db/seed-database';
import * as schema from '@finance-tracker/core/db/schema';

async function createEmptyDatabase(): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile: (file) => resolve(process.cwd(), '..', 'node_modules', 'sql.js', 'dist', file),
    useOldExtensionFunctions: false,
  });
  const raw = new SQL.Database();
  migrateSchema({
    execute: (sql) => raw.run(sql),
    all: <T>(sql: string) => {
      const [result] = raw.exec(sql);
      if (!result) return [];
      return result.values.map((values) => Object.fromEntries(
        result.columns.map((column, index) => [column, values[index]]),
      )) as T[];
    },
  });
  seedDatabase(drizzle(raw, { schema }));
  return raw;
}

function finish(raw: Database): Uint8Array {
  const bytes = raw.export();
  raw.close();
  return bytes;
}

export async function createDatabaseWithTransactions(count: number): Promise<Uint8Array> {
  const raw = await createEmptyDatabase();
  const statement = raw.prepare(
    'INSERT INTO transactions (iso_date, paise, direction, kind, source, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  raw.run('BEGIN TRANSACTION');
  try {
    for (let index = 0; index < count; index += 1) {
      statement.bind(['2026-01-02', 12500 + index, 'out', 'paid', 'manual', `perf-${index}`, '2026-01-02T10:00:00.000Z']);
      statement.step();
      statement.reset();
    }
    raw.run('COMMIT');
  } catch (error) {
    raw.run('ROLLBACK');
    throw error;
  } finally {
    statement.free();
  }
  return finish(raw);
}

function scalar(raw: Database, sql: string, params: (string | number | null)[] = []): number | null {
  const statement = raw.prepare(sql);
  try {
    statement.bind(params);
    return statement.step() ? Number(statement.get()[0]) : null;
  } finally {
    statement.free();
  }
}

/**
 * A year of realistic data shaped like the approved website mocks (ui-mocks/web/assets/web.js),
 * so app screenshots can be compared with the mock screenshots.
 */
export async function createSampleDatabase(): Promise<Uint8Array> {
  const raw = await createEmptyDatabase();
  const categoryId = (name: string) => scalar(raw, 'SELECT id FROM categories WHERE name = ?', [name]);
  const subcategoryId = (category: string, name: string) => scalar(
    raw,
    'SELECT s.id FROM subcategories s JOIN categories c ON c.id = s.category_id WHERE c.name = ? AND s.name = ?',
    [category, name],
  );
  const personId = (name: string) => {
    const existing = scalar(raw, 'SELECT id FROM people WHERE name = ?', [name]);
    if (existing) return existing;
    raw.run('INSERT INTO people (name, sort_order) VALUES (?, 99)', [name]);
    return scalar(raw, 'SELECT last_insert_rowid()');
  };
  const modeId = (name: string) => {
    const existing = scalar(raw, 'SELECT id FROM payment_modes WHERE name = ?', [name]);
    if (existing) return existing;
    raw.run('INSERT INTO payment_modes (name, sort_order) VALUES (?, 99)', [name]);
    return scalar(raw, 'SELECT last_insert_rowid()');
  };

  let key = 0;
  const insert = (row: {
    date: string; time?: string; payee: string; rupees: number; category?: string; sub?: string;
    account: string; person?: string; mode?: string; review?: boolean; refund?: boolean; self?: boolean; note?: string;
  }) => {
    const direction = row.self ? 'self' : row.rupees > 0 ? 'in' : 'out';
    const kind = row.self ? 'self' : row.refund ? 'refund' : row.rupees > 0 ? 'received' : 'paid';
    raw.run(
      `INSERT INTO transactions (iso_date, time, paise, direction, kind, category_id, subcategory_id, payment_mode_id, person_id,
        counterparty_name, account_name, raw_details, note, is_refund, source, dedupe_key, auto_categorized, needs_review, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.date, row.time ? `${row.time}:00` : null, Math.round(Math.abs(row.rupees) * 100), direction, kind,
        row.category ? categoryId(row.category) : null,
        row.category && row.sub ? subcategoryId(row.category, row.sub) : null,
        row.mode ? modeId(row.mode) : null,
        row.person ? personId(row.person) : null,
        row.payee, row.account, `UPI/${row.payee}`, row.note ?? null, row.refund ? 1 : 0, 'paytm', `sample-${key += 1}`,
        row.review ? 0 : 1, row.review ? 1 : 0, `${row.date}T${row.time ?? '10:00'}:00.000Z`,
      ],
    );
  };

  const HDFC = 'HDFC Bank - 09';
  const AXIS = 'Axis Credit Card';
  const SBI = 'SBI Savings';
  // Recurring monthly history Jan–Oct 2026.
  for (let month = 1; month <= 10; month += 1) {
    const mm = String(month).padStart(2, '0');
    const wobble = (month * 37) % 11;
    insert({ date: `2026-${mm}-01`, time: '09:30', payee: 'Tektron Pvt Ltd', rupees: 182500, category: 'Others', sub: 'Others', account: HDFC, person: 'Self', mode: 'Bank transfer' });
    insert({ date: `2026-${mm}-05`, time: '08:00', payee: 'Landlord · S. Iyer', rupees: -32000, category: 'Rent & Utilities', sub: 'Rent', account: HDFC, person: 'Family', mode: 'UPI' });
    insert({ date: `2026-${mm}-12`, time: '07:58', payee: 'Kotak Prime · Car EMI', rupees: -27000, category: 'Car', sub: 'Car EMI', account: HDFC, person: 'Self', mode: 'Auto-debit' });
    insert({ date: `2026-${mm}-15`, time: '09:00', payee: 'Zerodha', rupees: -10000, category: 'Investments & Mutual Funds', sub: 'Mutual funds', account: HDFC, person: 'Self', mode: 'Auto-debit' });
    insert({ date: `2026-${mm}-08`, time: '13:02', payee: 'BigBasket', rupees: -(1800 + wobble * 90), category: 'Groceries', sub: 'Vegetables', account: HDFC, person: 'Family', mode: 'UPI' });
    insert({ date: `2026-${mm}-18`, time: '20:14', payee: 'Zomato', rupees: -(420 + wobble * 35), category: 'Food & Dining', sub: 'Restaurant', account: HDFC, person: 'Self', mode: 'UPI' });
    insert({ date: `2026-${mm}-20`, time: '11:05', payee: 'Tata Power', rupees: -(2400 + wobble * 70), category: 'Rent & Utilities', sub: 'Electricity', account: HDFC, person: 'Family', mode: 'UPI' });
    insert({ date: `2026-${mm}-22`, time: '19:12', payee: 'Amazon Pay', rupees: -(900 + wobble * 310), category: 'Shopping', sub: 'Electronics', account: AXIS, person: 'Self', mode: 'Credit card' });
    insert({ date: `2026-${mm}-24`, time: '12:45', payee: 'Indian Oil', rupees: -2000, category: 'Car', sub: 'Fuel', account: AXIS, person: 'Self', mode: 'Credit card' });
    insert({ date: `2026-${mm}-26`, time: '15:55', payee: 'IRCTC', rupees: -(700 + wobble * 60), category: 'Travel', sub: 'Cab', account: SBI, person: 'Family', mode: 'Debit card' });
  }

  // The rows shown in the mocks (Oct 25 – Nov 22 2026).
  insert({ date: '2026-11-22', time: '20:14', payee: 'Zomato', rupees: -452, category: 'Food & Dining', sub: 'Restaurant', account: HDFC, person: 'Self', mode: 'UPI', note: 'Team dinner, split later' });
  insert({ date: '2026-11-22', time: '13:02', payee: 'BigBasket', rupees: -2318.5, category: 'Groceries', sub: 'Vegetables', account: HDFC, person: 'Family', mode: 'UPI' });
  insert({ date: '2026-11-21', time: '19:40', payee: 'Rahul Verma', rupees: -1200, account: HDFC, mode: 'UPI', review: true });
  insert({ date: '2026-11-21', time: '09:15', payee: 'Uber India', rupees: -218.4, category: 'Commute', sub: 'Auto', account: AXIS, person: 'Self', mode: 'Credit card' });
  insert({ date: '2026-11-20', time: '18:22', payee: 'Flipkart Payments', rupees: 1299, category: 'CashBack', sub: 'Refund', account: HDFC, person: 'Self', mode: 'UPI', refund: true });
  insert({ date: '2026-11-20', time: '11:05', payee: 'Tata Power', rupees: -3140, category: 'Rent & Utilities', sub: 'Electricity', account: HDFC, person: 'Family', mode: 'UPI' });
  insert({ date: '2026-11-19', time: '21:48', payee: 'BookMyShow', rupees: -640, category: 'Entertainment', sub: 'Movie', account: AXIS, person: 'Self', mode: 'Credit card' });
  insert({ date: '2026-11-19', time: '08:31', payee: 'MedPlus Pharmacy', rupees: -386, category: 'Medicine & Health', sub: 'Tablet', account: HDFC, person: 'Family', mode: 'UPI' });
  insert({ date: '2026-11-18', time: '16:10', payee: 'Self · HDFC → SBI', rupees: -25000, account: HDFC, mode: 'Bank transfer', self: true });
  insert({ date: '2026-11-18', time: '10:00', payee: 'Swiggy Instamart', rupees: -764, account: HDFC, mode: 'UPI', review: true });
  insert({ date: '2026-11-17', time: '19:12', payee: 'Amazon Pay', rupees: -4499, category: 'Shopping', sub: 'Electronics', account: AXIS, person: 'Self', mode: 'Credit card' });
  insert({ date: '2026-11-16', time: '12:45', payee: 'Indian Oil', rupees: -2000, category: 'Car', sub: 'Fuel', account: AXIS, person: 'Self', mode: 'Credit card' });
  insert({ date: '2026-11-15', time: '09:00', payee: 'Zerodha', rupees: -10000, category: 'Investments & Mutual Funds', sub: 'Mutual funds', account: HDFC, person: 'Self', mode: 'Auto-debit' });
  insert({ date: '2026-11-12', time: '07:58', payee: 'Kotak Prime · Car EMI', rupees: -27000, category: 'Car', sub: 'Car EMI', account: HDFC, person: 'Self', mode: 'Auto-debit' });
  insert({ date: '2026-11-05', time: '08:00', payee: 'Landlord · S. Iyer', rupees: -32000, category: 'Rent & Utilities', sub: 'Rent', account: HDFC, person: 'Family', mode: 'UPI' });
  insert({ date: '2026-11-01', time: '09:30', payee: 'Tektron Pvt Ltd', rupees: 182500, category: 'Others', sub: 'Others', account: HDFC, person: 'Self', mode: 'Bank transfer' });
  insert({ date: '2026-10-31', time: '20:14', payee: 'Dominos', rupees: -689, category: 'Food & Dining', sub: 'Dominos', account: HDFC, person: 'Self', mode: 'UPI' });
  insert({ date: '2026-10-30', time: '18:40', payee: 'Airtel', rupees: -599, category: 'Recharge', sub: 'Mobile', account: AXIS, person: 'Self', mode: 'Credit card' });
  insert({ date: '2026-10-28', time: '17:05', payee: 'Axis Bank · Card bill', rupees: -18420, category: 'Credit Card Payment', sub: 'Bill payment', account: HDFC, mode: 'Bank transfer' });
  insert({ date: '2026-10-27', time: '10:11', payee: 'Cult.fit', rupees: -1999, category: 'Fitness', sub: 'Gym', account: AXIS, person: 'Self', mode: 'Credit card' });
  insert({ date: '2026-10-26', time: '21:30', payee: 'Unknown UPI · 98xxxx2210', rupees: -350, account: HDFC, mode: 'UPI', review: true });
  for (let index = 0; index < 9; index += 1) {
    insert({ date: `2026-11-${String(2 + index).padStart(2, '0')}`, time: '18:00', payee: `New payee ${index + 1}`, rupees: -(150 + index * 45), account: HDFC, mode: 'UPI', review: true });
  }

  // Lending: money lent to Arjun with a part repayment, and a loan borrowed from Meera.
  const now = '2026-11-10T22:05:00.000Z';
  const arjun = personId('Arjun Mehta');
  raw.run('INSERT INTO loans (name, person_id, kind, closed, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)', ['Bike down payment', arjun, 'lent', now, now]);
  const arjunLoan = scalar(raw, 'SELECT last_insert_rowid()');
  insert({ date: '2026-09-10', time: '22:05', payee: 'Arjun Mehta', rupees: -20000, account: HDFC, person: 'Arjun Mehta', mode: 'UPI' });
  const lentTxn = scalar(raw, 'SELECT last_insert_rowid()');
  insert({ date: '2026-11-10', time: '22:05', payee: 'Arjun Mehta', rupees: 8000, account: HDFC, person: 'Arjun Mehta', mode: 'UPI' });
  const repayTxn = scalar(raw, 'SELECT last_insert_rowid()');
  raw.run('UPDATE transactions SET loan_id = ? WHERE id IN (?, ?)', [arjunLoan, lentTxn, repayTxn]);
  raw.run('INSERT INTO loan_allocations (txn_id, loan_id, part, paise, created_at) VALUES (?, ?, ?, ?, ?)', [lentTxn, arjunLoan, 'principal', 2000000, now]);
  raw.run('INSERT INTO loan_allocations (txn_id, loan_id, part, paise, created_at) VALUES (?, ?, ?, ?, ?)', [repayTxn, arjunLoan, 'repayment', 800000, now]);

  const meera = personId('Meera Nair');
  raw.run('INSERT INTO loans (name, person_id, kind, closed, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)', ['Laptop', meera, 'borrowed', now, now]);
  const meeraLoan = scalar(raw, 'SELECT last_insert_rowid()');
  insert({ date: '2026-08-03', time: '11:00', payee: 'Meera Nair', rupees: 45000, account: HDFC, person: 'Meera Nair', mode: 'UPI' });
  const borrowedTxn = scalar(raw, 'SELECT last_insert_rowid()');
  raw.run('UPDATE transactions SET loan_id = ? WHERE id = ?', [meeraLoan, borrowedTxn]);
  raw.run('INSERT INTO loan_allocations (txn_id, loan_id, part, paise, created_at) VALUES (?, ?, ?, ?, ?)', [borrowedTxn, meeraLoan, 'principal', 4500000, now]);

  return finish(raw);
}

export async function seedFakeSession(page: Page) {
  await page.addInitScript(() => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const session = JSON.stringify({
      access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjk5OTk5OTk5OTl9.signature',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'playwright-refresh-token',
      provider_token: 'playwright-drive-token',
      user: {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'priya.sharma@example.invalid',
        email_confirmed_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
        app_metadata: { provider: 'google', providers: ['google'] },
        user_metadata: { email: 'priya.sharma@example.invalid', full_name: 'Priya Sharma', email_verified: true, sub: userId },
        identities: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_anonymous: false,
      },
    });
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) return session;
      return originalGetItem.call(this, key);
    };
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: ({ callback }) => ({
            requestAccessToken: () => callback({ access_token: 'playwright-drive-token' }),
          }),
          revoke: (_token, callback) => callback(),
        },
      },
    };
  });
}

export async function mockDrive(page: Page, databaseBytes: Uint8Array | null) {
  await page.route('https://www.googleapis.com/**', async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q') ?? '';
    const liveFile = {
      id: 'playwright-live-db',
      name: 'finance-live.db',
      headRevisionId: 'revision-412',
      modifiedTime: new Date(Date.now() - 2 * 60_000).toISOString(),
      size: String(databaseBytes?.byteLength ?? 0),
    };

    if (url.searchParams.get('alt') === 'media' && databaseBytes) {
      await route.fulfill({ body: Buffer.from(databaseBytes), contentType: 'application/octet-stream' });
    } else if (query.includes("name='Finance Tracker'")) {
      await route.fulfill({
        json: { files: [{ id: 'playwright-folder', name: 'Finance Tracker', mimeType: 'application/vnd.google-apps.folder' }] },
      });
    } else if (query.includes("name='finance-live.db'")) {
      await route.fulfill({ json: { files: databaseBytes ? [liveFile] : [] } });
    } else if (url.pathname.endsWith('/playwright-live-db')) {
      await route.fulfill({ json: liveFile, headers: { etag: '"revision-412"' } });
    } else if (query.includes('name contains')) {
      await route.fulfill({ json: { files: [] } });
    } else {
      await route.fulfill({ status: 404, json: { error: 'Unexpected mocked Drive request' } });
    }
  });
}
