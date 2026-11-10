// Fails when the Drupal release this site runs needs replacing: drupal.org has
// marked it insecure, a newer security release exists on its branch, or its
// branch is no longer supported. A scheduled workflow runs this daily, so a
// failure reaches the repository owner by email.
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pinned = /DRUPAL_VERSION = '([^']+)'/.exec(read('scripts/runtime.mjs'))?.[1];
const image = /^FROM drupal:(\d+\.\d+\.\d+)-/m.exec(read('docker/Dockerfile'))?.[1];
if (!pinned || pinned !== image) {
  console.error(`The image (${image}) and the tests (${pinned}) must use the same Drupal release.`);
  process.exit(1);
}

const response = await fetch('https://updates.drupal.org/release-history/drupal/current');
if (!response.ok) throw new Error(`updates.drupal.org answered ${response.status}`);
const xml = await response.text();
const releases = [...xml.matchAll(/<release>([\s\S]*?)<\/release>/g)].map(([, body]) => ({
  version: /<version>([^<]+)<\/version>/.exec(body)?.[1] ?? '',
  types: [...body.matchAll(/<term><name>Release type<\/name><value>([^<]+)<\/value><\/term>/g)].map((m) => m[1]),
}));

const branch = pinned.split('.').slice(0, 2).join('.') + '.';
const patch = (version) => Number(version.slice(branch.length));
const current = releases.find((release) => release.version === pinned);
const supported = /<supported_branches>([^<]*)<\/supported_branches>/.exec(xml)?.[1].split(',') ?? [];
const newer = releases.filter((r) => r.version.startsWith(branch) && /^\d+$/.test(r.version.slice(branch.length)) && patch(r.version) > patch(pinned));
const problems = [
  !current && `Drupal ${pinned} is not in drupal.org's release history.`,
  current?.types.includes('Insecure') && `Drupal ${pinned} is marked insecure.`,
  ...newer.filter((r) => r.types.includes('Security update')).map((r) => `Drupal ${r.version} is a security release.`),
  !supported.includes(branch) && `The ${branch}x branch is no longer supported.`,
].filter(Boolean);

console.log(`Running Drupal ${pinned}. Newer on this branch: ${newer.map((r) => `${r.version} (${r.types.join(', ')})`).join('; ') || 'none'}.`);
if (problems.length) {
  console.error(problems.join('\n'));
  console.error('Update docker/Dockerfile and scripts/runtime.mjs, run npm run verify, then deploy.');
  process.exit(1);
}
console.log('No security release is waiting.');
