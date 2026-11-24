import { expect, test } from '@playwright/test';
import { createDatabaseWithTransactions, mockDrive, seedFakeSession } from './fixtures';

test('shows the sign-in entry point to signed-out visitors', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue with Google/ })).toBeVisible();
});

test('loads and virtualizes 10,000 transactions with accessible navigation', async ({ page }) => {
  const databaseBytes = await createDatabaseWithTransactions(10_000);
  await seedFakeSession(page);
  await mockDrive(page, databaseBytes);

  const startedAt = Date.now();
  await page.goto('/transactions');
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.tbl tbody tr.t-row').first()).toBeVisible({ timeout: 15_000 });
  expect(Date.now() - startedAt).toBeLessThan(15_000);

  const renderedRows = await page.locator('.tbl tbody tr.t-row').count();
  expect(renderedRows).toBeGreaterThan(0);
  expect(renderedRows).toBeLessThan(120);

  await page.keyboard.press('/');
  await expect(page.getByRole('textbox', { name: 'Search payee, note, amount' })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.w-tabs').getByRole('link', { name: 'Activity' })).toBeVisible();
});
