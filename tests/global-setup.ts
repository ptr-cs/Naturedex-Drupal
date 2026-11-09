import { request } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

export const baseURL = 'http://127.0.0.1:4322';

/**
 * Signs in each test account with the one-time login link the test server
 * generated (what `drush user:login` prints) and saves its session.
 */
export default async function globalSetup() {
  const links = JSON.parse(readFileSync('.runtime/test/sign-in-links.json', 'utf8')) as Record<string, string>;
  mkdirSync('tests/.auth', { recursive: true });
  for (const [name, path] of Object.entries(links)) {
    const context = await request.newContext({ baseURL });
    const response = await context.get(path);
    if (!response.ok()) throw new Error(`Could not sign in as test-${name}: ${response.status()}`);
    await context.storageState({ path: `tests/.auth/${name}.json` });
    await context.dispose();
  }
}
