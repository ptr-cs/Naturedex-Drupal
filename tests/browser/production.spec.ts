import { expect, test } from '@playwright/test';
import { contentSecurityPolicy } from '../../infra/lib/csp';

const anonymous = { cookies: [], origins: [] };

test.describe('under the production Content-Security-Policy', () => {
  test.use({ storageState: anonymous });

  test('public pages work and report no violations', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
    });
    await page.route('**/*', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': contentSecurityPolicy },
      });
    });
    for (const path of ['/map', '/journal', '/journal/read-the-water', '/about', '/species/red-fox', '/user/login']) {
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible();
    }
    await page.goto('/');
    await page.getByRole('button', { name: 'View Red Fox', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Red Fox' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Pause sprites' }).click();
    expect(violations).toEqual([]);
  });
});

test.describe('the caching contract with CloudFront', () => {
  test('anonymous pages are cached at the edge only, and never for signed-in editors', async ({ browser }) => {
    const guest = await browser.newContext({ storageState: anonymous });
    for (const path of ['/', '/journal', '/species/red-fox']) {
      const response = await guest.request.get(path);
      expect(response.headers()['cache-control'], path).toBe('max-age=0, public, s-maxage=300');
    }
    const missing = await guest.request.get('/no-such-trail');
    expect(missing.headers()['cache-control']).toBe('max-age=0, public, s-maxage=60');
    // Drupal page-caches the anonymous sign-in form itself, so it is cacheable
    // here; CloudFront never caches /user* (asserted in infra/test).
    for (const path of ['/editor', '/api/naturedex/posts']) {
      const response = await guest.request.get(path, { maxRedirects: 0 });
      expect(response.headers()['cache-control'], path).not.toContain('s-maxage');
    }
    await guest.close();

    const editor = await browser.newContext({ storageState: 'tests/.auth/editor.json' });
    expect((await editor.storageState()).cookies.map((cookie) => cookie.name)).toContain('SESSnaturedex');
    for (const path of ['/', '/editor']) {
      const response = await editor.request.get(path);
      expect(response.headers()['cache-control'], path).toMatch(/private|no-cache/);
    }
    await editor.close();
  });
});
