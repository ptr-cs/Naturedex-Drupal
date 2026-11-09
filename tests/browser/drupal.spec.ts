import { expect, test, type Browser, type Page } from '@playwright/test';

/** A visitor with no session, so pages come from Drupal's page cache. */
async function visitor(browser: Browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return { context, page: await context.newPage() };
}

async function editSpecies(page: Page, id: string, change: (page: Page) => Promise<void>) {
  await page.goto(`/species/${id}`);
  await page.getByRole('link', { name: 'Edit in Drupal' }).click();
  await change(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-drupal-messages], .messages')).toContainText(/has been updated/);
}

test('correcting a species once in Drupal updates its card, page, and dialog for visitors', async ({ page, browser }) => {
  let guest = await visitor(browser);
  // Warm the page cache first, so the test proves the cache is cleared.
  await guest.page.goto('/');
  await expect(guest.page.getByRole('button', { name: 'View Red Fox', exact: true })).toBeVisible();

  const corrected = 'Red Fox (corrected)';
  try {
    await editSpecies(page, 'red-fox', (form) => form.getByLabel('Common name', { exact: true }).fill(corrected));
    // A newly arriving visitor; see the ETag note in the next test.
    await guest.context.close();
    guest = await visitor(browser);
    await guest.page.goto('/');
    await guest.page.getByRole('button', { name: `View ${corrected}`, exact: true }).click();
    await expect(guest.page.getByRole('dialog', { name: corrected })).toBeVisible();
    await guest.page.goto('/species/red-fox');
    await expect(guest.page.getByRole('heading', { name: corrected, level: 1 })).toBeVisible();
    await guest.page.goto('/journal/the-art-of-noticing');
    await expect(guest.page.getByRole('button', { name: `View ${corrected}`, exact: true })).toBeVisible();
  } finally {
    await editSpecies(page, 'red-fox', (form) => form.getByLabel('Common name', { exact: true }).fill('Red Fox'));
    await guest.context.close();
  }
});

test('an unpublished species leaves public pages and returns intact when republished', async ({ page, browser }) => {
  const guest = await visitor(browser);
  const published = page.getByRole('checkbox', { name: 'Published' });
  try {
    await editSpecies(page, 'monarch', () => published.uncheck());
    await guest.page.goto('/');
    await expect(guest.page.getByText('23 entries')).toBeVisible();
    await expect(guest.page.getByRole('button', { name: 'View Monarch Butterfly', exact: true })).toHaveCount(0);
    expect((await guest.page.goto('/species/monarch'))?.status()).toBe(403);
    // The field note that mentions it keeps its other animals.
    await guest.page.goto('/journal/beyond-the-bright-wings');
    await expect(guest.page.getByRole('button', { name: 'View Monarch Butterfly', exact: true })).toHaveCount(0);
    await expect(guest.page.getByRole('button', { name: /^View Eastern Tiger Swallowtail/ })).toBeVisible();
  } finally {
    await editSpecies(page, 'monarch', () => published.check());
    await guest.context.close();
  }
  // A newly arriving visitor. The same browser could keep its old copy:
  // Drupal's page cache uses the second a page was cached as its ETag, so a
  // page cached again within that second revalidates as unchanged.
  const next = await visitor(browser);
  await next.page.goto('/journal/beyond-the-bright-wings');
  await expect(next.page.getByRole('button', { name: 'View Monarch Butterfly', exact: true })).toBeVisible();
  await next.context.close();
});

test('a note written in Drupal’s own form opens unchanged in the Writing desk', async ({ page, request }) => {
  const title = `Drupal form note ${Date.now()}`;
  const slug = `drupal-form-note-${Date.now()}`;
  const body = '## Written in Drupal\n\nThe same plain text format as the desk.';
  await page.goto('/node/add/field_note');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Slug', { exact: true }).fill(slug);
  await page.getByLabel('Category', { exact: true }).fill('Field Notes');
  await page.getByLabel('Excerpt', { exact: true }).fill('Created with the node form.');
  await page.getByLabel('Body', { exact: true }).fill(body);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/journal/${slug}$`));
  await expect(page.getByText('This field note is a draft.')).toBeVisible();

  await page.goto('/editor');
  await page.getByRole('button', { name: `Edit ${title}`, exact: true }).click();
  await expect(page.getByLabel('Body', { exact: true })).toHaveValue(body);
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('draft');

  const token = (await (await request.get('/session/token')).text()).trim();
  expect((await request.delete(`/api/naturedex/posts/${slug}`, { headers: { 'X-CSRF-Token': token } })).status()).toBe(204);
});

test('the Writing desk sends visitors to sign in and tells contributors who publishes', async ({ browser }) => {
  const guest = await visitor(browser);
  await guest.page.goto('/editor');
  await expect(guest.page).toHaveURL(/\/user\/login\?destination=\/editor/);
  await guest.context.close();

  const contributor = await browser.newContext({ storageState: 'tests/.auth/contributor.json' });
  const page = await contributor.newPage();
  await page.goto('/editor');
  await page.getByRole('button', { name: 'New post', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Published' })).toBeDisabled();
  await expect(page.getByText('Your account saves drafts. An editor publishes them.')).toBeVisible();
  await contributor.close();

  const reader = await browser.newContext({ storageState: 'tests/.auth/reader.json' });
  const readerPage = await reader.newPage();
  expect((await readerPage.goto('/editor'))?.status()).toBe(403);
  await expect(readerPage.getByRole('heading', { name: 'Your account does not have access to the writing desk.' })).toBeVisible();
  await reader.close();
});

test('generic Drupal listings and term pages are closed to visitors', async ({ browser }) => {
  const guest = await visitor(browser);
  for (const path of ['/node', '/taxonomy/term/1', '/user/1', '/admin/content'])
    expect((await guest.page.goto(path))?.status(), path).toBeGreaterThanOrEqual(403);
  await guest.context.close();
});
