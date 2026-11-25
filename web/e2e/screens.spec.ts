import { test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSampleDatabase, mockDrive, seedFakeSession } from './fixtures';

/*
 * Visual comparison helper (not part of the regular suite). Captures each approved mock next to the
 * matching app page so they can be compared side by side:
 *
 *   SCREENS=home,activity npx playwright test screens
 *
 * Entries are `mockPage[?mockQuery][@appPath]`, e.g. `activity?state=review@/transactions?review=1`.
 * Images go to web/.screens/<entry>-<width>-{mock,app}.png (outside test-results, which Playwright wipes on every run).
 */

const DEFAULT_APP_PATHS: Record<string, string> = {
  signin: '/',
  home: '/',
  activity: '/transactions',
  import: '/import',
  lending: '/lending',
  settings: '/settings',
};
const WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'phone', width: 390, height: 844 },
];
const requested = (process.env.SCREENS ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
const outputDir = resolve(process.cwd(), '.screens');

function parse(entry: string) {
  const [mockPart, appPath] = entry.split('@');
  const [mockPage, mockQuery = ''] = mockPart.split('?');
  return { mockPage, mockQuery, appPath: appPath ?? DEFAULT_APP_PATHS[mockPage] ?? '/' };
}

function fileSafe(entry: string) {
  return entry.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

test.describe('mock vs app screens', () => {
  test.skip(!requested.length, 'Set SCREENS to capture comparison screenshots.');
  test.setTimeout(180_000);

  for (const entry of requested) {
    test(entry, async ({ browser }) => {
      const { mockPage, mockQuery, appPath } = parse(entry);
      const bytes = await createSampleDatabase();
      for (const size of WIDTHS) {
        const mockContext = await browser.newContext({ viewport: { width: size.width, height: size.height } });
        const mock = await mockContext.newPage();
        const mockUrl = pathToFileURL(resolve(process.cwd(), '..', 'ui-mocks', 'web', `${mockPage}.html`)).href + (mockQuery ? `?${mockQuery}` : '');
        await mock.goto(mockUrl);
        await mock.addStyleTag({ content: '.mock-float { display: none !important; }' });
        await settle(mock);
        await mock.screenshot({ path: resolve(outputDir, `${fileSafe(entry)}-${size.name}-mock.png`), fullPage: true });
        await mockContext.close();

        const appContext = await browser.newContext({ viewport: { width: size.width, height: size.height } });
        const app = await appContext.newPage();
        if (mockPage !== 'signin' || mockQuery.includes('loading')) {
          await seedFakeSession(app);
          await mockDrive(app, bytes);
        }
        await app.goto(appPath);
        await app.locator('.w-app, .si').first().waitFor({ timeout: 20_000 });
        await settle(app);
        await app.screenshot({ path: resolve(outputDir, `${fileSafe(entry)}-${size.name}-app.png`), fullPage: true });
        await appContext.close();
      }
    });
  }
});
