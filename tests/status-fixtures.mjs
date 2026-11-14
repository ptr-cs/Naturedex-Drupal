// Stand-ins for GitHub on the browser tests' /status page, including hostile
// values the site must discard. Status.php reads <name>.json, or
// tests-failing.json when a test asks for ?naturedex_test_status=failing.

const tests = (failed) => ({
  at: '2026-11-06T18:00:00Z',
  commit: 'abcdef1',
  image: 'passed',
  suites: {
    unit: { passed: 18, failed, name: '<script>window.pwned=1</script>' },
    browser: { passed: 35, failed: 0 },
    accessibility: { passed: 7, failed: 0 },
    infrastructure: { passed: 28, failed: 0 },
    'secret-suite': { passed: 1, failed: 0 },
  },
  history: [{ at: '2026-11-06T18:00:00Z', ok: true }],
  error: 'arn:aws:iam::123456789012:role/leaked in us-east-1',
});

export const statusFixtures = {
  tests: tests(0),
  'tests-failing': tests(2),
  deploys: {
    workflow_runs: [
      {
        conclusion: 'success',
        run_started_at: '2026-11-06T17:00:00Z',
        updated_at: '2026-11-06T17:05:00Z',
        head_sha: 'abcdef1234567890',
        actor: { login: 'leaked-login' },
        html_url: 'https://example.test/leaked-url',
      },
      {
        conclusion: 'failure',
        run_started_at: '2026-11-06T16:00:00Z',
        updated_at: '2026-11-06T16:02:00Z',
        head_sha: '<img src=x onerror=alert(1)>',
      },
    ],
  },
  security: {
    workflow_runs: [{ conclusion: 'success', name: 'CVE-2026-0000 secret-suite' }],
  },
};
