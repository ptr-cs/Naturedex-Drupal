// Builds the frontend, prepares Drupal if needed, and serves the site.
import { spawnSync } from 'node:child_process';
import { relative } from 'node:path';
import { drupalTask, isInstalled, passwordFile, root, serveDrupal, waitForSite } from './runtime.mjs';
import { setup } from './setup.mjs';

const port = Number(process.env.PORT || 4321);
const url = `http://127.0.0.1:${port}`;

const build = spawnSync(process.execPath, ['scripts/build-frontend.mjs'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

if (isInstalled()) drupalTask(['rebuild']);
else setup();

const site = serveDrupal(port);
site.once('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => site.kill(signal));

await waitForSite(url);
console.log(`
Naturedex is ready at ${url}
Writing desk: ${url}/editor (username admin; password in ${relative(root, passwordFile)})
Drupal admin: ${url}/admin/content
After changing frontend/, run: npm run build:frontend
Press Ctrl+C to stop.
`);
