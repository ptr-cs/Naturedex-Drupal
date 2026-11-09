import { expect, test, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';

const species = JSON.parse(
  readFileSync(
    new URL(
      '../../data/species.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as Array<{
  id: string; name: string;
}>;

test.use({ reducedMotion: 'no-preference' });

async function expectMotion(page: Page, enabled: boolean) {
  await expect.poll(async () => page.locator('img[data-sprite]').evaluateAll((images, animate) =>
    images.length > 0 && images.every(image =>
      image.getAttribute('data-animated') === String(animate) &&
      new URL(image.getAttribute('src')!, location.href).pathname.endsWith(`/assets/sprites/${animate ? 'animated/' : ''}${image.getAttribute('data-sprite')}.svg`),
    ), enabled), { message: `Every animal image should use ${enabled ? 'animated' : 'static'} local artwork` }).toBe(true);
}

async function scan(page: Page, testInfo: TestInfo) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  await testInfo.attach('motion-state-axe-results', {
    body: JSON.stringify(results, null, 2), contentType: 'application/json',
  });
  expect(results.violations).toEqual([]);
}

test('sprites animate by default and a global pause persists across all display contexts', async ({ page }, testInfo) => {
  await page.goto('/');
  const pause = page.getByRole('button', { name: 'Pause sprites', exact: true });
  await expect(pause).toHaveAttribute('aria-pressed', 'true');
  await expectMotion(page, true);
  const rendered = await page.locator('img[data-sprite]').evaluateAll(images => images.map(image => image.getAttribute('data-sprite')));
  expect(species.every(entry => rendered.includes(entry.id))).toBe(true);

  await pause.click();
  const resume = page.getByRole('button', { name: 'Animate sprites', exact: true });
  await expect(resume).toHaveAttribute('aria-pressed', 'false');
  await expectMotion(page, false);
  expect(await page.evaluate(() => localStorage.getItem('naturedex.motion.v1'))).toBe('paused');
  await scan(page, testInfo);

  await page.getByRole('button', { name: `View ${species[0].name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: species[0].name, exact: true });
  await expect(dialog.locator(`img[data-sprite="${species[0].id}"]`)).toHaveAttribute('data-animated', 'false');
  await page.getByRole('button', { name: 'Close entry', exact: true }).click();

  await page.goto('/journal');
  await expect(page.getByRole('button', { name: 'Animate sprites', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('img[data-sprite]').first()).toBeVisible();
  await expectMotion(page, false);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Animate sprites', exact: true })).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: 'Animate sprites', exact: true }).click();
  await expectMotion(page, true);
  expect(await page.evaluate(() => localStorage.getItem('naturedex.motion.v1'))).toBe('on');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Pause sprites', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectMotion(page, true);
  await page.getByRole('button', { name: `View ${species[0].name}`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: species[0].name, exact: true }).locator(`img[data-sprite="${species[0].id}"]`))
    .toHaveAttribute('data-animated', 'true');
});

test('operating-system reduced motion overrides saved animation and reacts to live changes', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('naturedex.motion.v1', 'on'));
  await page.goto('/');
  const reduced = page.getByRole('button', { name: 'Reduced motion', exact: true });
  await expect(reduced).toBeDisabled();
  await expect(reduced).toHaveAttribute('aria-pressed', 'false');
  await expectMotion(page, false);
  await scan(page, testInfo);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.getByRole('button', { name: 'Pause sprites', exact: true })).toBeEnabled();
  await expectMotion(page, true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Reduced motion', exact: true })).toBeDisabled();
  await expectMotion(page, false);
});

test('a deliberate pause survives operating-system preference changes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Pause sprites', exact: true }).click();
  await expectMotion(page, false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Reduced motion', exact: true })).toBeDisabled();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.getByRole('button', { name: 'Animate sprites', exact: true })).toBeEnabled();
  await expectMotion(page, false);
  expect(await page.evaluate(() => localStorage.getItem('naturedex.motion.v1'))).toBe('paused');
});

test('every sprite actually cycles through its poses and honors its own reduced-motion fallback', async ({ page }) => {
  test.setTimeout(60_000);
  for (const entry of species) {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`/modules/custom/naturedex_core/assets/sprites/animated/${entry.id}.svg`);
    const cycle = await page.evaluate(() => {
      const frames = [...document.querySelectorAll('g[data-frame]')];
      const animations = document.getAnimations();
      const duration = Math.max(0, ...animations.map(animation => Number(animation.effect?.getTiming().duration) || 0));
      for (const animation of animations) animation.pause();
      const samples: string[][] = [];
      for (let step = 0; step < 96; step++) {
        for (const animation of animations) animation.currentTime = duration * step / 96;
        samples.push(frames.filter(frame => Number(getComputedStyle(frame).opacity) > 0.5)
          .map(frame => frame.getAttribute('data-frame')!));
      }
      return { animationCount: animations.length, duration, samples };
    });
    expect(cycle.animationCount, `${entry.id}: CSS animation is running`).toBeGreaterThan(0);
    expect(cycle.duration, `${entry.id}: positive cycle duration`).toBeGreaterThan(0);
    expect(cycle.samples.every(sample => sample.length === 1), `${entry.id}: exactly one visible pose per sampled instant`).toBe(true);
    expect([...new Set(cycle.samples.flat())].sort(), `${entry.id}: every pose appears in the cycle`).toEqual(['0', '1', '2']);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(async () => page.locator('g[data-frame]').evaluateAll(frames =>
      frames.filter(frame => Number(getComputedStyle(frame).opacity) > 0.5).map(frame => frame.getAttribute('data-frame'))),
    { message: `${entry.id}: asset-level reduced motion shows only its original pose` }).toEqual(['0']);
  }
});
