import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBody } from '../../frontend/lib/domain';
import { drupalDir, php } from '../../scripts/runtime.mjs';

const bodies = [
  '## Choose one small place\n\nA useful walk.\nStill the same paragraph.',
  '# A one-hash heading\n\n\n\nAfter extra blank lines.',
  '##No space is a paragraph\n\n## A heading\nthat wraps',
  '<script>alert(1)</script>\n\nA & B < C',
  '\r\n## Windows line endings\r\n\r\nParagraph\r\n',
  '',
];

const runtime = existsSync(php) && existsSync(`${drupalDir}/autoload.php`);

describe.skipIf(!runtime)('the field note format', () => {
  const result = spawnSync(php, ['php-cli', '../../tests/php/format.php'], {
    cwd: drupalDir,
    input: JSON.stringify(bodies),
    encoding: 'utf8',
  });
  const fromPhp = runtime ? (JSON.parse(result.stdout) as Array<{ blocks: unknown; html: string }>) : [];

  it.each(bodies.map((body, index) => [index, body]))(
    'the Writing desk preview matches the Drupal filter for body %i',
    (index, body) => {
      expect(parseBody(body as string)).toEqual(fromPhp[index as number].blocks);
    },
  );

  it('escapes HTML instead of running it', () => {
    expect(fromPhp[3].html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>\n<p>A &amp; B &lt; C</p>');
  });
});
