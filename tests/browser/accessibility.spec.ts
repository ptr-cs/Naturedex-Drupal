import { expect, test, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

const species = JSON.parse(readFileSync(new URL('../../data/species.json', import.meta.url), 'utf8')) as Array<{ name: string }>;

async function scan(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  await testInfo.attach('axe-results', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  expect(results.violations).toEqual([]);
}

for (const route of ['/', '/map', '/journal', '/editor']) {
  test(`accessibility: ${route} has no detected WCAG violations`, async ({
    page,
  }, testInfo) => {
    await page.goto(route);
    await expect(page.getByRole('main')).toBeVisible();
    await scan(page, testInfo);
    await testInfo.attach('page-preview', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}

test('accessibility: a selected animal exposes an accessible dialog and restores focus', async ({
  page,
}, testInfo) => {
  const name = species[0].name;
  await page.goto('/');
  const trigger = page.getByRole('button', {
    name: `View ${name}`,
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name, exact: true });
  await expect(dialog).toBeVisible();
  await scan(page, testInfo);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('accessibility: the new-post editing state has labeled controls', async ({
  page,
}, testInfo) => {
  await page.goto('/editor');
  await page.getByRole('button', { name: 'New post', exact: true }).click();
  for (const label of ['Title', 'Excerpt', 'Body', 'Category']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('textbox', { name: /^Slug/ })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toBeVisible();
  await scan(page, testInfo);
  await page.getByLabel('Title', { exact: true }).fill('A keyboard-friendly field note');
  await page.getByLabel('Body', { exact: true }).fill('## A closer look\n\nObserve the woodland edge.');
  await page.getByRole('button', { name: 'Preview article', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Article preview', exact: true })).toBeVisible();
  await scan(page, testInfo);
});

test('accessibility: a published article retains its reading structure', async ({ page, request }, testInfo) => {
  const posts = await (await request.get('/api/naturedex/posts')).json();
  expect(posts.length).toBeGreaterThan(0);
  await page.goto(`/journal/${posts[0].slug}`);
  await expect(page.getByRole('heading', { name: posts[0].title, exact: true })).toBeVisible();
  await scan(page, testInfo);
});

test('accessibility: the sign-in page and the not-found page have no detected WCAG violations', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/editor');
  await expect(page).toHaveURL(/\/user\/login\?destination=/);
  await expect(page.getByRole('heading', { name: 'Sign in to write.' })).toBeVisible();
  await scan(page, testInfo);
  const missing = await page.goto('/journal/no-such-note');
  expect(missing?.status()).toBe(404);
  await expect(page.getByText('This field note is unavailable or has not been published.')).toBeVisible();
  await scan(page, testInfo);
  await context.close();
});
