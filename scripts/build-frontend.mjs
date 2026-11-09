import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outdir = `${root}drupal/themes/naturedex/assets/dist`;
const shared = { bundle: true, minify: true, logLevel: 'info', absWorkingDir: root };

await build({
  ...shared,
  entryPoints: ['frontend/main.ts'],
  outfile: `${outdir}/app.js`,
  format: 'iife',
  target: 'es2022',
  sourcemap: true,
});
await build({
  ...shared,
  entryPoints: ['frontend/styles/global.css'],
  outfile: `${outdir}/app.css`,
  // The font ships with the theme, beside the built stylesheet.
  external: ['../fonts/*'],
});
