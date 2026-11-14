import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// GitHub is replaced by tests/status-fixtures.mjs; the query picks a scenario.
test.use({ storageState: { cookies: [], origins: [] } });

const setMode = (mode: string) => `/status?naturedex_test_status=${mode}`;

test.afterEach(async ({ request }) => {
  await request.get(setMode('ok'));
});

test('shows overall health, test counts, and deployments', async ({ page }) => {
  await page.goto(setMode('ok'));
  await expect(page.getByRole('heading', { level: 1, name: 'System status.' })).toBeVisible();
  await expect(page).toHaveTitle('System status · Naturedex');
  await expect(page.getByText('All systems healthy')).toBeVisible();
  for (const check of ['Website', 'Database', 'Scheduled jobs'])
    await expect(page.locator('.status-list li', { hasText: check })).toContainText('Working');
  await expect(page.locator('.status-list li', { hasText: 'Security releases' })).toContainText('Up to date');
  await expect(page.getByRole('row', { name: /Unit tests 18 0/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Accessibility scans 7 0/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Infrastructure tests 28 0/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Succeeded' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Failed', exact: false }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '5 min' })).toBeVisible();
  await expect(page.getByText('abcdef1').first()).toBeVisible();
  await expect(page.getByText('1 of the last 1 test runs passed.')).toBeAttached();
});

test('exposes nothing useful to an attacker, even if its sources are hostile', async ({
  page,
  request,
}) => {
  const response = await request.get(setMode('ok'));
  const html = await response.text();
  for (const forbidden of [
    'arn:aws',
    'us-east-1',
    '123456789012',
    'leaked',
    'secret-suite',
    'onerror',
    'window.pwned',
    'Apache',
    'MySQL',
    'Fargate',
    'CVE-',
  ])
    expect(html, forbidden).not.toContain(forbidden);
  await page.goto('/status');
  expect(await page.evaluate(() => 'pwned' in window)).toBe(false);
});

test('reports a failure as a count, without saying what failed', async ({ page }) => {
  await page.goto(setMode('failing'));
  await expect(page.getByText('Something needs attention')).toBeVisible();
  await expect(page.getByRole('row', { name: /Unit tests 18 2/ })).toBeVisible();
});

test('keeps working when GitHub is unavailable', async ({ page }) => {
  await page.goto(setMode('ok'));
  const response = await page.goto(setMode('down'));
  expect(response?.status()).toBe(200);
  await expect(page.getByText('latest saved results')).toBeVisible();
  await expect(page.getByRole('row', { name: /Unit tests 18/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Live site' })).toBeVisible();
});

test('is never kept by Drupal’s own page cache', async ({ request }) => {
  await request.get(setMode('ok'));
  await request.get(setMode('failing'));
  const html = await (await request.get('/status')).text();
  expect(html).toContain('Something needs attention');
});

test('stays out of search results and is reachable from every page', async ({ page }) => {
  await page.goto('/status');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await page.goto('/journal');
  await page.locator('.page-footer').getByRole('link', { name: 'System status' }).click();
  await expect(page).toHaveURL(/\/status$/);
  await page.goto('/');
  await page.locator('.sidebar-bottom').getByRole('link', { name: 'System status' }).click();
  await expect(page).toHaveURL(/\/status$/);
});

test('accessibility: the status page has no detected WCAG violations', async ({ page }) => {
  await page.goto(setMode('ok'));
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/status');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
  ).toBe(false);
});
