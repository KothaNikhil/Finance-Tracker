import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import initSqlJs from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import { migrateSchema } from '@finance-tracker/core/db/migrations';
import { seedDatabase } from '@finance-tracker/core/db/seed-database';
import * as schema from '@finance-tracker/core/db/schema';

async function createDatabaseWithTransactions(count: number): Promise<Uint8Array> {
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
  const db = drizzle(raw, { schema });
  seedDatabase(db);

  const statement = raw.prepare(
    'INSERT INTO transactions (iso_date, paise, direction, kind, source, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  raw.run('BEGIN TRANSACTION');
  try {
    for (let index = 0; index < count; index += 1) {
      statement.bind([
        '2026-01-02',
        12500 + index,
        'out',
        'paid',
        'manual',
        `perf-${index}`,
        '2026-01-02T10:00:00.000Z',
      ]);
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
  const bytes = raw.export();
  raw.close();
  return bytes;
}

async function seedFakeSession(page: Page) {
  await page.addInitScript(() => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const session = JSON.stringify({
      access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjk5OTk5OTk5OTl9.signature',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'playwright-refresh-token',
      user: {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'smoke@example.invalid',
        email_confirmed_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
        app_metadata: { provider: 'google', providers: ['google'] },
        user_metadata: { email: 'smoke@example.invalid', email_verified: true, sub: userId },
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

async function mockDrive(page: Page, databaseBytes: Uint8Array) {
  await page.route('https://www.googleapis.com/**', async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q') ?? '';
    const liveFile = {
      id: 'playwright-live-db',
      name: 'finance-live.db',
      headRevisionId: 'revision-1',
      modifiedTime: '2026-01-02T10:00:00.000Z',
    };

    if (url.searchParams.get('alt') === 'media') {
      await route.fulfill({ body: Buffer.from(databaseBytes), contentType: 'application/octet-stream' });
    } else if (query.includes("name='Finance Tracker'")) {
      await route.fulfill({
        json: { files: [{ id: 'playwright-folder', name: 'Finance Tracker', mimeType: 'application/vnd.google-apps.folder' }] },
      });
    } else if (query.includes("name='finance-live.db'")) {
      await route.fulfill({ json: { files: [liveFile] } });
    } else if (url.pathname.endsWith('/playwright-live-db')) {
      await route.fulfill({ json: liveFile, headers: { etag: '"revision-1"' } });
    } else if (query.includes('name contains')) {
      await route.fulfill({ json: { files: [] } });
    } else {
      await route.fulfill({ status: 404, json: { error: 'Unexpected mocked Drive request' } });
    }
  });
}

test('shows the sign-in entry point to signed-out visitors', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your money, clearly.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue with Google/ })).toBeVisible();
});

test('loads and virtualizes 10,000 transactions with accessible navigation', async ({ page }) => {
  const databaseBytes = await createDatabaseWithTransactions(10_000);
  await seedFakeSession(page);
  await mockDrive(page, databaseBytes);

  const startedAt = Date.now();
  await page.goto('/transactions');
  await page.getByRole('button', { name: /Connect Google Drive/ }).click();
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('10,000 of 10,000 transactions')).toBeVisible();
  expect(Date.now() - startedAt).toBeLessThan(15_000);

  const renderedRows = await page.locator('.txn-virtual-row').count();
  expect(renderedRows).toBeGreaterThan(0);
  expect(renderedRows).toBeLessThan(80);

  await page.keyboard.press('/');
  await expect(page.getByRole('textbox', { name: 'Search transactions' })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Activity' })).toBeVisible();
});
