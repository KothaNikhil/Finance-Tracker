import { expect, test } from '@playwright/test';
import * as XLSX from 'xlsx';
import { createSampleDatabase, mockDrive, seedFakeSession } from './fixtures';

function paytmStatement(): Buffer {
  const header = ['Date', 'Time', 'Transaction Details', 'Other Transaction Details (UPI ID or A/c No)', 'Your Account', 'Amount', 'UPI Ref No.', 'Order ID', 'Remarks', 'Tags', 'Comment'];
  const rows = [
    ['23/11/2026', '19:05:11', 'Paid to Kiran Rao', 'kiran.rao@okaxis on Paytm', 'HDFC Bank - 09', '-5,000.00', '700000000001', '', 'Loan to Kiran', '', ''],
    ['23/11/2026', '12:40:00', 'Paid to Zomato', 'zomato@paytm', 'HDFC Bank - 09', '-389.00', '700000000002', 'ORD-91', '', '#🍽️ Food', ''],
    ['22/11/2026', '09:15:00', 'Received from Anil', 'anil@okicici', 'HDFC Bank - 09', '+1,200.00', '700000000003', '', '', '', ''],
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([header, ...rows]), 'Passbook Payment History');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test.setTimeout(120_000);

test('money lent can create a loan from a transaction', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedFakeSession(page);
  await mockDrive(page, await createSampleDatabase());
  await page.goto('/transactions');
  await page.locator('.tbl tbody tr.t-row', { hasText: 'Rahul Verma' }).first().click();
  await page.getByRole('button', { name: 'Money lent' }).click();
  await page.getByRole('radio', { name: 'New loan' }).click();
  await page.getByRole('textbox', { name: 'New person name' }).fill('Rahul Verma');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('textbox', { name: 'Loan name (optional)' }).fill('Rent help');
  await page.getByRole('button', { name: 'Create loan and add' }).click();
  await expect(page.locator('.w-panel').getByText('Attached to')).toBeVisible();
  await expect(page.locator('.w-panel b', { hasText: 'Rahul Verma · Rent help · lent' })).toBeVisible();
  const panel = page.locator('.w-panel');
  const attached = panel.getByRole('button', { name: 'Attached loan', exact: true });
  await expect(attached).toHaveAttribute('aria-expanded', 'false');
  await expect(panel.getByRole('radio', { name: 'Existing loan' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Remove from transaction' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(attached).toBeVisible();
  await attached.focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('button', { name: 'Remove from transaction' })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await panel.getByRole('button', { name: 'Edit loan attachment' }).click();
  const loanSelect = panel.getByRole('combobox', { name: 'Loan', exact: true }).first();
  await expect(loanSelect.locator('option:checked')).toHaveText('Rahul Verma · Rent help · lent');
  await loanSelect.selectOption({ label: 'Meera Nair · Laptop · borrowed' });
  await panel.getByRole('combobox', { name: 'Loan part', exact: true }).selectOption('repayment');
  await panel.getByRole('button', { name: 'Save loan attachment' }).click();
  await expect(attached).toContainText('Meera Nair · Laptop · borrowed · Repaid by me');
  await expect(attached).toHaveAttribute('aria-expanded', 'false');
  await attached.click();
  await panel.getByRole('button', { name: 'Edit loan attachment' }).click();
  await expect(panel.getByRole('combobox', { name: 'Loan part', exact: true })).toHaveValue('repayment');
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(attached).toHaveAttribute('aria-expanded', 'false');

  // Splits use the same compact item and reopen with their saved slices.
  await attached.click();
  await panel.getByRole('button', { name: 'Edit loan attachment' }).click();
  await panel.getByRole('combobox', { name: 'Loan', exact: true }).nth(1).selectOption({ label: 'Rahul Verma · Rent help · lent' });
  await panel.getByRole('textbox', { name: 'Split amount in rupees' }).fill('700');
  await panel.getByRole('button', { name: 'Add slice' }).click();
  await panel.getByRole('combobox', { name: 'Loan', exact: true }).nth(2).selectOption({ label: 'Arjun Mehta · Bike down payment · lent' });
  await panel.getByRole('textbox', { name: 'Split amount in rupees' }).nth(1).fill('500');
  await panel.getByRole('button', { name: 'Save split', exact: true }).click();
  await expect(attached).toContainText('Split across loans');
  await expect(attached).toHaveAttribute('aria-expanded', 'false');
  await attached.click();
  await panel.getByRole('button', { name: 'Edit loan attachment' }).click();
  await expect(panel.getByRole('textbox', { name: 'Split amount in rupees' }).first()).toHaveValue('700');
  await expect(panel.getByRole('textbox', { name: 'Split amount in rupees' }).nth(1)).toHaveValue('500');
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await attached.click();
  await panel.getByRole('button', { name: 'Remove from transaction' }).click();
  await expect(attached).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Money lent', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await panel.getByRole('button', { name: 'Money lent', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: 'Loan', exact: true }).first().getByRole('option', { name: 'Rahul Verma · Rent help · lent' })).toHaveCount(1);

  // A part that moves money the wrong way is blocked for imported rows.
  await page.locator('.tbl tbody tr.t-row', { hasText: 'Swiggy Instamart' }).first().getByText('Swiggy Instamart').click();
  await page.getByRole('button', { name: 'Money lent', exact: true }).click();
  await page.getByRole('radio', { name: 'New loan' }).click();
  await page.getByRole('radio', { name: 'I borrowed' }).click();
  await expect(page.getByText(/moves money in, but the imported transaction is money out/)).toBeVisible();

  await page.keyboard.press('Escape');
  await page.locator('.w-side').getByRole('link', { name: 'Lending' }).click();
  await expect(page.getByText('Rahul Verma').first()).toBeVisible();
});

test('import rows open transaction details', async ({ page }) => {
  for (const size of [{ n: 'desktop', w: 1440, h: 900 }, { n: 'phone', w: 390, h: 844 }]) {
    await page.setViewportSize({ width: size.w, height: size.h });
    if (size.n === 'desktop') {
      await seedFakeSession(page);
      await mockDrive(page, await createSampleDatabase());
    }
    await page.goto('/import');
    await page.locator('input[type=file]').setInputFiles({ name: 'paytm-nov.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: paytmStatement() });
    const row = size.n === 'desktop'
      ? page.locator('.tbl tbody tr.t-row', { hasText: 'Zomato' })
      : page.locator('.mlist .mrow', { hasText: 'Zomato' });
    await row.first().getByText('Zomato', { exact: true }).click();
    const panel = page.locator('.w-panel.is-open');
    await expect(panel.getByText('NOT SAVED YET')).toBeVisible();
    await expect(panel.getByText('ORD-91')).toBeVisible();
    if (size.n === 'phone') break;

    // Escape in the category picker closes only the picker.
    await panel.getByRole('button', { name: 'Change' }).click();
    await expect(page.getByRole('dialog', { name: /Category for Zomato/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /Category for Zomato/ })).toHaveCount(0);
    await expect(panel.getByText('NOT SAVED YET')).toBeVisible();

    await panel.getByRole('button', { name: 'Will be saved' }).click();
    await expect(panel.getByRole('button', { name: 'Skipped' })).toBeVisible();
    await panel.getByRole('button', { name: 'Skipped' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.w-panel.is-open')).toHaveCount(0);

    await page.getByRole('button', { name: /Save \d+ transactions?/ }).click();
    await page.locator('.tbl tbody tr.t-row', { hasText: 'Kiran Rao' }).first().getByText('Kiran Rao', { exact: true }).click();
    const saved = page.locator('.w-panel.is-open');
    await expect(saved.getByText('TRANSACTION', { exact: true })).toBeVisible();
    await expect(saved.getByRole('tab', { name: 'Overview' })).toBeVisible();
    await saved.getByRole('button', { name: 'Money lent' }).click();
    await saved.getByRole('radio', { name: 'New loan' }).click();
    await saved.getByRole('textbox', { name: 'New person name' }).fill('Kiran Rao');
    await saved.getByRole('button', { name: 'Add', exact: true }).click();
    await saved.getByRole('button', { name: 'Create loan and add' }).click();
    await expect(saved.locator('b', { hasText: 'Kiran Rao · lent' })).toBeVisible();
    await expect(saved.getByRole('radio', { name: 'Existing loan' })).toHaveCount(0);
    await saved.getByRole('button', { name: 'Attached loan', exact: true }).click();
    await expect(saved.getByRole('button', { name: 'Edit loan attachment' })).toBeVisible();
    await saved.getByRole('button', { name: 'Remove from transaction' }).click();
    await expect(saved.getByRole('button', { name: 'Attached loan', exact: true })).toHaveCount(0);

    // Category edits in the panel show up in the review table.
    await saved.getByRole('button', { name: 'Pick' }).click();
    await saved.getByRole('option', { name: /Food & Dining/ }).first().click();
    await saved.getByRole('button', { name: 'Save', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.tbl tbody tr.t-row', { hasText: 'Kiran Rao' }).getByText('Food & Dining')).toBeVisible();

    // Duplicates open the stored transaction.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Import more files/ }).click();
    await page.locator('input[type=file]').setInputFiles({ name: 'paytm-nov.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: paytmStatement() });
    await page.getByRole('tab', { name: /Duplicates/ }).click();
    await page.locator('.tbl tbody tr.t-row', { hasText: 'Anil' }).first().getByText('Anil', { exact: true }).click();
    await expect(page.locator('.w-panel.is-open').getByRole('tab', { name: 'Details' })).toBeVisible();
  }
});
