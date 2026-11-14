import { describe, expect, it } from 'vitest';
import { summarize } from '../../scripts/status-summary.mjs';

const spec = (title: string, ok: boolean) => ({
  title,
  ok,
  tests: [{ results: [{ error: { message: 'secret stack trace' } }] }],
});

describe('the public test summary', () => {
  const report = {
    unit: { numPassedTests: 18, numFailedTests: 1, testResults: [{ name: 'private' }] },
    infrastructure: { numPassedTests: 23, numFailedTests: 0 },
    browser: {
      suites: [
        { file: 'accessibility.spec.ts', specs: [spec('scan', true)] },
        {
          file: 'api.spec.ts',
          suites: [{ specs: [spec('rejects cross-origin writes', false), spec('b', true)] }],
        },
      ],
    },
  };

  it('counts results by suite', () => {
    expect(summarize(report)).toEqual({
      unit: { passed: 18, failed: 1 },
      infrastructure: { passed: 23, failed: 0 },
      browser: { passed: 1, failed: 1 },
      accessibility: { passed: 1, failed: 0 },
    });
  });

  it('never carries test names, errors, or file paths', () => {
    const published = JSON.stringify(summarize(report));
    for (const secret of ['cross-origin', 'stack trace', 'private', 'spec.ts'])
      expect(published).not.toContain(secret);
  });

  it('reports zero rather than crashing when a suite did not run', () => {
    expect(summarize({} as Parameters<typeof summarize>[0]).unit).toEqual({ passed: 0, failed: 0 });
  });
});
