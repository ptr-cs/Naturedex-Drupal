// Paths and helpers shared by setup, the dev server, and the test server.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DRUPAL_VERSION = '11.4.11';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const runtimeDir = join(root, '.runtime');
export const drupalDir = join(runtimeDir, `drupal-${DRUPAL_VERSION}`);
export const php = join(runtimeDir, 'frankenphp');
export const passwordFile = join(runtimeDir, 'admin-password');
export const defaultDatabase = join(runtimeDir, 'data', 'naturedex.sqlite');
export const task = join(root, 'scripts', 'drupal-task.php');

export function databasePath() {
  return process.env.NATUREDEX_DB ? resolve(process.env.NATUREDEX_DB) : defaultDatabase;
}

export function isInstalled() {
  return existsSync(php) && existsSync(join(drupalDir, 'autoload.php')) && existsSync(databasePath());
}

function phpEnv(extra = {}) {
  return {
    ...process.env,
    NATUREDEX_DB: databasePath(),
    // FrankenPHP's embedded Caddy otherwise writes into the user's home folder.
    XDG_CONFIG_HOME: join(runtimeDir, 'caddy', 'config'),
    XDG_DATA_HOME: join(runtimeDir, 'caddy', 'data'),
    ...extra,
  };
}

/** Runs scripts/drupal-task.php with a fully booted Drupal. */
export function drupalTask(args, { quiet = false, env = {} } = {}) {
  const result = spawnSync(php, ['php-cli', task, ...args], {
    cwd: drupalDir,
    env: phpEnv(env),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Drupal task "${args[0]}" failed:\n${result.error?.message ?? ''}${result.stderr}${result.stdout}`);
  }
  if (!quiet && result.stdout.trim()) console.log(result.stdout.trim());
  return result.stdout;
}

/** Serves Drupal on loopback only. FrankenPHP routes unknown paths to index.php. */
export function serveDrupal(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('The port must be an integer from 1024 to 65535.');
  return spawn(php, ['php-server', '--root', drupalDir, '--listen', `127.0.0.1:${port}`], {
    cwd: runtimeDir,
    env: phpEnv(),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

export async function waitForSite(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status < 500) return;
    } catch {
      /* Not listening yet. */
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Drupal did not respond at ${url}`);
}
