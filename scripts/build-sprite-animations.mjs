import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = (name) => resolve(root, name);
const sprites = 'drupal/modules/naturedex_core/assets/sprites';
const species = JSON.parse(readFileSync(source('data/species.json'), 'utf8'));
const plans = [
  ...JSON.parse(
    readFileSync(source('data/sprite-motion-vertebrates.json'), 'utf8'),
  ),
  ...JSON.parse(readFileSync(source('data/sprite-motion-small.json'), 'utf8')),
];
const ids = new Set();
mkdirSync(source(`${sprites}/animated`), { recursive: true });

function pixels(svg) {
  const grid = Array.from({ length: 48 }, () => Array(48).fill(null));
  for (const match of svg.matchAll(/<rect\b([^>]+)\/?\s*>/g)) {
    const attrs = Object.fromEntries(
      [...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
    for (const key of ['x', 'y', 'width', 'height'])
      if (!Number.isInteger(Number(attrs[key])))
        throw new Error('Sprite coordinates must be integer pixels.');
    if (!/^#[a-f\d]{6}$/i.test(attrs.fill))
      throw new Error('Sprite fills must use solid hex colors.');
    for (let y = +attrs.y; y < +attrs.y + +attrs.height; y++)
      for (let x = +attrs.x; x < +attrs.x + +attrs.width; x++) {
        if (x < 0 || x >= 48 || y < 0 || y >= 48)
          throw new Error('Source sprite exceeds its 48-pixel grid.');
        grid[y][x] = attrs.fill;
      }
  }
  return grid;
}
function apply(grid, op) {
  const [x1, y1, x2, y2] = op.bounds;
  if (
    ![x1, y1, x2, y2].every(Number.isInteger) ||
    x1 < 0 ||
    y1 < 0 ||
    x2 > 47 ||
    y2 > 47 ||
    x2 < x1 ||
    y2 < y1
  )
    throw new Error('Invalid animation bounds.');
  if (op.type === 'paint' || op.type === 'blink') {
    if (!/^#[a-f\d]{6}$/i.test(op.color))
      throw new Error('Invalid paint color.');
    for (let y = y1; y <= y2; y++)
      for (let x = x1; x <= x2; x++) grid[y][x] = op.color;
    return;
  }
  if (op.type !== 'move' && op.type !== 'foldX')
    throw new Error(`Unknown motion ${op.type}`);
  if (
    op.type === 'move' &&
    (!Number.isInteger(op.dx) || !Number.isInteger(op.dy))
  )
    throw new Error('Motion must stay on the pixel grid.');
  if (
    op.type === 'foldX' &&
    (!(op.factor > 0 && op.factor <= 1) || !Number.isFinite(op.anchorX))
  )
    throw new Error('Invalid wing-fold transform.');
  const selected = [];
  for (let y = y1; y <= y2; y++)
    for (let x = x1; x <= x2; x++)
      if (grid[y][x] && (!op.colors || op.colors.includes(grid[y][x]))) {
        selected.push({ x, y, color: grid[y][x] });
        grid[y][x] = null;
      }
  for (const p of selected) {
    const x =
      op.type === 'move'
        ? p.x + op.dx
        : Math.round(op.anchorX + (p.x - op.anchorX) * op.factor);
    const y = p.y + (op.type === 'move' ? op.dy : 0);
    if (x >= 0 && x < 48 && y >= 0 && y < 48) grid[y][x] = p.color;
  }
}
function encode(grid) {
  let markup = '';
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 48;) {
      const color = grid[y][x];
      if (!color) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < 48 && grid[y][end] === color) end++;
      markup += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${color}"/>`;
      x = end;
    }
  return markup;
}
function keyframes(sequence, frame) {
  const stops = sequence.map(
    (value, index) =>
      `${((index / sequence.length) * 100).toFixed(4)}%{opacity:${value === frame ? 1 : 0}}`,
  );
  stops.push(`100%{opacity:${sequence[0] === frame ? 1 : 0}}`);
  return `@keyframes frame-${frame}{${stops.join('')}}`;
}
for (const plan of plans) {
  const entry = species.find((s) => s.id === plan.id);
  if (!entry || ids.has(plan.id))
    throw new Error(`Unknown or duplicate species ${plan.id}`);
  if (
    plan.frames.length !== 3 ||
    !plan.sequence.length ||
    plan.sequence.some(
      (n) => !Number.isInteger(n) || n < 0 || n >= plan.frames.length,
    )
  )
    throw new Error(`Invalid frames for ${plan.id}`);
  if (!(plan.duration >= 1 && plan.duration <= 12) || plan.frames[0].length)
    throw new Error(`Invalid timing or resting frame for ${plan.id}`);
  ids.add(plan.id);
  const original = readFileSync(source(`${sprites}/${entry.sprite}.svg`), 'utf8');
  const base = pixels(original);
  const frames = plan.frames.map((ops) => {
    const frame = base.map((row) => [...row]);
    for (const op of ops) apply(frame, op);
    return encode(frame);
  });
  if (new Set(frames).size !== 3)
    throw new Error(`All three poses must be distinct for ${plan.id}`);
  const seed = [...plan.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const delay = -(seed % Math.round(plan.duration * 1000)) / 1000;
  const css =
    frames
      .map(
        (_, i) =>
          `.frame-${i}{opacity:${i === 0 ? 1 : 0};animation:frame-${i} ${plan.duration}s steps(1,end) ${delay}s infinite}`,
      )
      .join('') +
    frames.map((_, i) => keyframes(plan.sequence, i)).join('') +
    '@media(prefers-reduced-motion:reduce){.sprite-frame{animation:none!important;opacity:0!important}.frame-0{opacity:1!important}}';
  const title = `Original animated pixel illustration of ${entry.name.replaceAll('&', '&amp;')}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-labelledby="title" shape-rendering="crispEdges" data-species="${plan.id}" data-sprite-frames="3"><title id="title">${title}</title><style>${css}</style>${frames.map((markup, i) => `<g class="sprite-frame frame-${i}" data-frame="${i}">${markup}</g>`).join('')}</svg>\n`;
  writeFileSync(source(`${sprites}/animated/${plan.id}.svg`), svg);
}
if (ids.size !== species.length)
  throw new Error('Every species must have an animation plan.');
console.log(`Built ${ids.size} original pixel animations (3 poses each).`);
