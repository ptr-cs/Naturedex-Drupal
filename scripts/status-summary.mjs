import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const readJson = (path) =>
  existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;

function vitestCounts(report) {
  return { passed: report?.numPassedTests ?? 0, failed: report?.numFailedTests ?? 0 };
}

function specsIn(suite) {
  return [
    ...(suite.specs ?? []).map((spec) => ({ ...spec, file: suite.file })),
    ...(suite.suites ?? []).flatMap((child) =>
      specsIn({ ...child, file: child.file ?? suite.file }),
    ),
  ];
}

/**
 * Reduces test reports to counts. Names and errors never leave this function,
 * because the result is published on a public page.
 */
export function summarize({ unit, infrastructure, browser }) {
  const suites = {
    unit: vitestCounts(unit),
    infrastructure: vitestCounts(infrastructure),
    browser: { passed: 0, failed: 0 },
    accessibility: { passed: 0, failed: 0 },
  };
  for (const spec of (browser?.suites ?? []).flatMap(specsIn)) {
    const group = spec.file?.includes('accessibility')
      ? suites.accessibility
      : suites.browser;
    group[spec.ok ? 'passed' : 'failed'] += 1;
  }
  return suites;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const directory = process.argv[2] ?? 'reports';
  const read = (name) => readJson(join(directory, `${name}.json`));
  console.log(
    JSON.stringify(
      summarize({
        unit: read('unit'),
        infrastructure: read('infrastructure'),
        browser: read('browser'),
      }),
    ),
  );
}
