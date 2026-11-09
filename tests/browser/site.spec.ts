import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const species = JSON.parse(readFileSync(new URL('../../data/species.json', import.meta.url), 'utf8')) as Array<{
  id: string;
  name: string;
  group: string;
  regionIds: string[];
}>;

test('the guide filters, opens a sourced entry, and remembers a seen animal', async ({
  page,
}) => {
  const entry = species[0];
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Meet your wild neighbors.' }),
  ).toBeVisible();
  await page.getByLabel('Search the field guide').fill(entry.name);
  await expect(
    page.getByRole('button', { name: `View ${entry.name}`, exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: `View ${entry.name}`, exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: entry.name, exact: true });
  await expect(dialog).toBeVisible();
  await expect(
    dialog
      .getByRole('link', { name: /source|virginia|dwr|national park/i })
      .first(),
  ).toBeVisible();
  await dialog
    .getByRole('button', { name: `Mark as seen: ${entry.name}`, exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Close entry', exact: true })
    .click();
  await page.reload();
  await page.getByLabel('Search the field guide').fill(entry.name);
  await page
    .getByRole('button', { name: `View ${entry.name}`, exact: true })
    .click();
  await expect(
    page
      .getByRole('dialog', { name: entry.name })
      .getByRole('button', { name: /seen/i }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('group filtering and an empty search stay recoverable', async ({
  page,
}) => {
  const bird = species.find((entry) => entry.group === 'Birds')!;
  const mammal = species.find((entry) => entry.group === 'Mammals')!;
  await page.goto('/');
  await page.getByLabel('Animal group').selectOption('Birds');
  await expect(
    page.getByRole('button', { name: `View ${bird.name}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `View ${mammal.name}`, exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel('Search the field guide')
    .fill('nonexistent-animal-test-xyz');
  await expect(page.getByRole('button', { name: /^View / })).toHaveCount(0);
  await expect(
    page.getByRole('heading', {
      name: 'No creatures in this patch.',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel('Search the field guide').fill('');
  await expect(
    page.getByRole('button', { name: `View ${bird.name}`, exact: true }),
  ).toBeVisible();
});

test('the region map correlates a selected region with its guide entries', async ({
  page,
}) => {
  const local = species.find((entry) => entry.regionIds.includes('valley'))!;
  const elsewhere = species.find(
    (entry) => !entry.regionIds.includes('valley'),
  );
  await page.goto('/map');
  await page
    .getByRole('button', { name: /Shenandoah Valley/i })
    .first()
    .click();
  await expect(
    page.getByRole('button', { name: `View ${local.name}`, exact: true }),
  ).toBeVisible();
  if (elsewhere)
    await expect(
      page.getByRole('button', { name: `View ${elsewhere.name}`, exact: true }),
    ).toHaveCount(0);
  await expect(page.getByText(/illustrative/i).first()).toBeVisible();
});

test('the writing desk creates, edits, publishes and deletes a field note', async ({
  page,
}) => {
  const title = `Browser field note ${Date.now()}`;
  const updatedTitle = `${title} updated`;
  await page.goto('/editor');
  await expect(
    page.getByRole('heading', { name: 'Your writing desk.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New post', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByRole('textbox', { name: /^Slug/ }).fill(`browser-field-note-${Date.now()}`);
  await page
    .getByLabel('Excerpt', { exact: true })
    .fill('A repeatable editor test using its own isolated Drupal site.');
  await page
    .getByLabel('Body', { exact: true })
    .fill(
      '## Field observation\n\nAn original note created during an automated user journey.',
    );
  await page.getByLabel('Category', { exact: true }).fill('Field Notes');
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('draft');
  await page.getByRole('button', { name: 'Save post', exact: true }).click();
  await page
    .getByRole('button', { name: `Edit ${title}`, exact: true })
    .click();
  await expect(page.getByLabel('Body', { exact: true })).toHaveValue(
    /original note/,
  );
  await page.getByLabel('Title', { exact: true }).fill(updatedTitle);
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('published');
  await page.getByRole('button', { name: 'Save post', exact: true }).click();
  await expect(page.getByText('Field note published.')).toBeVisible();
  await page.goto('/journal');
  await expect(
    page.getByRole('link', { name: new RegExp(updatedTitle) }).first(),
  ).toBeVisible();
  await page
    .getByRole('link', { name: new RegExp(updatedTitle) })
    .first()
    .click();
  await expect(
    page.getByText(
      'An original note created during an automated user journey.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.goto('/editor');
  await page
    .getByRole('button', { name: `Delete ${updatedTitle}`, exact: true })
    .click();
  const confirmation = page.getByRole('dialog', {
    name: 'Delete field note',
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole('button', { name: 'Delete post', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: `Edit ${updatedTitle}`, exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('button', { name: `Edit ${updatedTitle}`, exact: true }),
  ).toHaveCount(0);
});

test('mobile layouts keep the primary controls within the viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const route of ['/', '/map', '/journal', '/editor']) {
    await page.goto(route);
    await expect(page.getByRole('main')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow, `Horizontal overflow on ${route}`).toBe(false);
    await testInfo.attach(
      `mobile-preview-${route.replaceAll('/', '-') || 'guide'}`,
      {
        body: await page.screenshot(),
        contentType: 'image/png',
      },
    );
  }
  await page.setViewportSize({ width: 320, height: 812 });
  for (const route of ['/', '/map', '/journal', '/editor']) {
    await page.goto(route);
    await expect(page.getByRole('main')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1),
      `Horizontal overflow at 320 CSS pixels on ${route}`).toBe(false);
  }
});

test('without JavaScript, the guide, a species page, and an article stay readable', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Meet your wild neighbors.' })).toBeVisible();
  await expect(page.getByLabel('Search the field guide')).toBeHidden();
  await page.getByRole('link', { name: `View ${species[0].name}`, exact: true }).click();
  await expect(page).toHaveURL(`/species/${species[0].id}`);
  await expect(page.getByRole('heading', { name: species[0].name, level: 2 })).toBeVisible();
  await page.goto('/journal');
  await page.getByRole('link', { name: 'Read the water, then the wildlife' }).first().click();
  await expect(page.getByRole('heading', { name: 'Let the habitat lead', level: 2 })).toBeVisible();
  await context.close();
});
