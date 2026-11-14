// Serves a disposable copy of the working site for the browser tests, so tests
// never edit the real database. Run `npm run setup` (or `npm run dev`) first.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { statusFixtures } from './status-fixtures.mjs';
import { defaultDatabase, drupalTask, isInstalled, runtimeDir, serveDrupal, waitForSite } from '../scripts/runtime.mjs';

const port = Number(process.env.PORT || 4322);
const testDir = join(runtimeDir, 'test');
const database = join(testDir, 'naturedex-test.sqlite');

if (!isInstalled()) {
  console.error('Drupal is not set up yet. Run `npm run setup` first.');
  process.exit(1);
}
mkdirSync(testDir, { recursive: true });
for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(`${database}${suffix}`, { force: true });
// sqlite3's backup is consistent even while the dev server is writing.
const backup = spawnSync('sqlite3', [defaultDatabase, `.backup '${database}'`]);
if (backup.status !== 0 || !existsSync(database)) copyFileSync(defaultDatabase, database);

process.env.NATUREDEX_DB = database;
// Production's page max-age, so the shared-cache headers are under test.
process.env.NATUREDEX_PAGE_MAX_AGE = '300';
process.env.NATUREDEX_CLOUDFRONT = '1';
// /status reads these instead of GitHub; see tests/status-fixtures.mjs.
const fixtures = join(testDir, 'status-fixtures');
mkdirSync(fixtures, { recursive: true });
for (const [name, body] of Object.entries(statusFixtures)) writeFileSync(join(fixtures, `${name}.json`), JSON.stringify(body));
process.env.NATUREDEX_STATUS_FIXTURES = fixtures;
drupalTask(['test-users', join(testDir, 'sign-in-links.json')], { quiet: true });
drupalTask(['rebuild'], { quiet: true });
// Production runs cron hourly; the status page checks that it has run lately.
drupalTask(['cron'], { quiet: true });

const site = serveDrupal(port);
site.once('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => site.kill(signal));
await waitForSite(`http://127.0.0.1:${port}/`);
console.log('Naturedex test site is ready.');
