<?php

declare(strict_types=1);

namespace Drupal\naturedex_core;

use Drupal\Component\Datetime\TimeInterface;
use Drupal\Component\Serialization\Json;
use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\Database\Connection;
use Drupal\Core\Site\Settings;
use Drupal\Core\State\StateInterface;
use GuzzleHttp\ClientInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Public system health report for the /status page.
 *
 * Everything from outside Drupal is treated as untrusted. Only the fields named
 * here are kept, labels come from this file, and nothing that would help an
 * attacker is ever read: no test names, errors, logs, versions, or
 * infrastructure details. A failing test shows up only as a number.
 */
final class Status {

  private const TESTS_URL = 'https://raw.githubusercontent.com/ptr-cs/Naturedex-Drupal/status/status.json';
  private const DEPLOYS_URL = 'https://api.github.com/repos/ptr-cs/Naturedex-Drupal/actions/workflows/deploy.yml/runs?branch=main&per_page=10';
  private const SECURITY_URL = 'https://api.github.com/repos/ptr-cs/Naturedex-Drupal/actions/workflows/drupal-security.yml/runs?branch=main&status=completed&per_page=1';

  private const CACHE_ID = 'naturedex_core:status';
  private const LAST_GOOD_KEY = 'naturedex_core.status_last_good';
  private const TEST_MODE_KEY = 'naturedex_core.status_test_mode';
  public const FRESH_SECONDS = 300;
  private const RETRY_SECONDS = 60;

  /** Cron runs hourly (an EventBridge rule), so two hours late means it's stuck. */
  private const CRON_LATE_SECONDS = 7200;

  private const SUITES = [
    'unit' => 'Unit tests',
    'browser' => 'Browser and API tests',
    'accessibility' => 'Accessibility scans',
    'infrastructure' => 'Infrastructure tests',
  ];

  public function __construct(
    private readonly ClientInterface $httpClient,
    #[Autowire(service: 'cache.default')]
    private readonly CacheBackendInterface $cache,
    private readonly StateInterface $state,
    private readonly Connection $database,
    private readonly TimeInterface $time,
    private readonly RequestStack $requestStack,
  ) {}

  /**
   * @return array{overall: string, checks: array, tests: ?array, deployments: array, stale: bool, checkedAt: int}
   */
  public function report(): array {
    $external = $this->external();
    $checks = $this->siteChecks($external['security']);
    $tests = $external['tests'];
    $deploys = $external['deployments'];

    $healthy = !in_array(FALSE, array_column($checks, 'ok'), TRUE)
      && $tests !== NULL
      && $tests['ok']
      && (!$deploys || $deploys[0]['result'] !== 'failed');

    return [
      'overall' => $healthy ? 'operational' : 'attention',
      'checks' => $checks,
      'tests' => $tests,
      'deployments' => $deploys,
      'stale' => $external['stale'],
      'checkedAt' => $this->time->getCurrentTime(),
    ];
  }

  /**
   * How long the rendered page may be reused. The browser tests switch the
   * fake GitHub between requests, so nothing is reused while they run.
   */
  public function maxAge(): int {
    return $this->fixtureDirectory() === NULL ? self::FRESH_SECONDS : 0;
  }

  /**
   * Fetching is limited by the cache, not by traffic, so visitors can't use this
   * page to send requests to GitHub. A failure falls back to the last good data.
   */
  private function external(): array {
    $testing = $this->fixtureDirectory() !== NULL;
    $cached = $testing ? FALSE : $this->cache->get(self::CACHE_ID);
    if ($cached) {
      return $cached->data;
    }
    $now = $this->time->getCurrentTime();
    $tests = $this->normalizeTests($this->fetchJson(self::TESTS_URL, 'tests'));
    $deploys = $this->normalizeDeployments($this->fetchJson(self::DEPLOYS_URL, 'deploys'));
    $security = $this->normalizeSecurity($this->fetchJson(self::SECURITY_URL, 'security'));
    if ($tests !== NULL && $deploys !== NULL) {
      $fresh = ['tests' => $tests, 'deployments' => $deploys, 'security' => $security, 'stale' => FALSE];
      $this->cache->set(self::CACHE_ID, $fresh, $now + self::FRESH_SECONDS);
      $this->state->set(self::LAST_GOOD_KEY, $fresh);
      return $fresh;
    }
    $last = $this->state->get(self::LAST_GOOD_KEY);
    $data = [
      'tests' => $tests ?? (is_array($last) ? $last['tests'] : NULL),
      'deployments' => $deploys ?? (is_array($last) ? $last['deployments'] : []),
      'security' => $security ?? (is_array($last) ? $last['security'] : NULL),
      'stale' => TRUE,
    ];
    if (!$testing) {
      $this->cache->set(self::CACHE_ID, $data, $now + self::RETRY_SECONDS);
    }
    return $data;
  }

  private function fetchJson(string $url, string $fixture): ?array {
    $directory = $this->fixtureDirectory();
    if ($directory !== NULL) {
      return $this->readFixture($directory, $fixture);
    }
    try {
      $response = $this->httpClient->request('GET', $url, [
        'timeout' => 3,
        'allow_redirects' => FALSE,
        'http_errors' => FALSE,
        'headers' => ['User-Agent' => 'Naturedex status page', 'Accept' => 'application/json'],
      ]);
    }
    catch (\Throwable) {
      return NULL;
    }
    if ($response->getStatusCode() !== 200) {
      return NULL;
    }
    $data = json_decode((string) $response->getBody(), TRUE);
    return is_array($data) ? $data : NULL;
  }

  /**
   * Stand-ins for GitHub, used only by the browser tests' local site. The
   * query string picks a scenario: ok, failing, or down (GitHub unreachable).
   */
  private function readFixture(string $directory, string $name): ?array {
    $mode = $this->requestStack->getMainRequest()?->query->get('naturedex_test_status');
    if (is_string($mode) && in_array($mode, ['ok', 'failing', 'down'], TRUE)) {
      $this->state->set(self::TEST_MODE_KEY, $mode);
    }
    $mode = $this->state->get(self::TEST_MODE_KEY, 'ok');
    if ($mode === 'down') {
      return NULL;
    }
    $file = "$directory/$name" . ($name === 'tests' && $mode === 'failing' ? '-failing' : '') . '.json';
    $data = is_file($file) ? Json::decode((string) file_get_contents($file)) : NULL;
    return is_array($data) ? $data : NULL;
  }

  private function fixtureDirectory(): ?string {
    $directory = Settings::get('naturedex_status_fixtures');
    return is_string($directory) && $directory !== '' ? $directory : NULL;
  }

  /**
   * @param array<string, mixed>|null $data
   *   The published test summary.
   */
  private function normalizeTests(?array $data): ?array {
    if ($data === NULL || !is_array($data['suites'] ?? NULL)) {
      return NULL;
    }
    $suites = [];
    foreach (self::SUITES as $key => $label) {
      $suite = is_array($data['suites'][$key] ?? NULL) ? $data['suites'][$key] : [];
      $suites[] = [
        'label' => $label,
        'passed' => self::count($suite['passed'] ?? 0),
        'failed' => self::count($suite['failed'] ?? 0),
      ];
    }
    $image = ($data['image'] ?? NULL) === 'passed';
    $failed = array_sum(array_column($suites, 'failed'));
    $complete = !in_array(0, array_map(static fn (array $suite) => $suite['passed'] + $suite['failed'], $suites), TRUE);
    $recent = $this->normalizeHistory($data['history'] ?? NULL);

    return [
      'suites' => $suites,
      'image' => $image,
      'ok' => $failed === 0 && $complete && $image,
      'commit' => self::commit($data['commit'] ?? ''),
      'at' => self::time($data['at'] ?? ''),
      // Oldest first, the order the trend reads in.
      'recent' => array_reverse($recent),
      'recentPassed' => count(array_filter(array_column($recent, 'ok'))),
    ];
  }

  /**
   * @return array<int, array{ok: bool, at: int}>
   */
  private function normalizeHistory(mixed $history): array {
    if (!is_array($history)) {
      return [];
    }
    $runs = [];
    foreach (array_slice($history, 0, 20) as $run) {
      if (is_array($run)) {
        $runs[] = ['ok' => ($run['ok'] ?? NULL) === TRUE, 'at' => self::time($run['at'] ?? '')];
      }
    }
    return $runs;
  }

  /**
   * @param array<string, mixed>|null $data
   *   GitHub's list of workflow runs.
   *
   * @return array<int, array<string, mixed>>|null
   */
  private function normalizeDeployments(?array $data): ?array {
    if ($data === NULL || !is_array($data['workflow_runs'] ?? NULL)) {
      return NULL;
    }
    $deployments = [];
    foreach (array_slice($data['workflow_runs'], 0, 10) as $run) {
      if (!is_array($run)) {
        continue;
      }
      $started = self::time($run['run_started_at'] ?? '');
      $finished = self::time($run['updated_at'] ?? '');
      $result = [
        'success' => 'succeeded',
        'failure' => 'failed',
        'cancelled' => 'cancelled',
        'timed_out' => 'failed',
      ][is_string($run['conclusion'] ?? NULL) ? $run['conclusion'] : ''] ?? 'running';

      $deployments[] = [
        'result' => $result,
        'at' => $started,
        'minutes' => $result === 'running' ? 0 : max(1, (int) round(($finished - $started) / 60)),
        'commit' => self::commit($run['head_sha'] ?? ''),
      ];
    }
    return $deployments;
  }

  /**
   * The daily check for a newer Drupal security release than the one pinned.
   *
   * @return bool|null
   *   TRUE if the latest check passed, FALSE if it failed, NULL if unknown.
   */
  private function normalizeSecurity(?array $data): ?bool {
    $run = $data['workflow_runs'][0] ?? NULL;
    if (!is_array($run) || !is_string($run['conclusion'] ?? NULL)) {
      return NULL;
    }
    return match ($run['conclusion']) {
      'success' => TRUE,
      'failure' => FALSE,
      default => NULL,
    };
  }

  /**
   * Yes-or-no checks of this running site, with no detail beyond the answer.
   * Drupal keeps all of its state in the database, so there is no file storage
   * to check.
   */
  private function siteChecks(?bool $security): array {
    try {
      $database = (int) $this->database->query('SELECT 1')->fetchField() === 1;
    }
    catch (\Throwable) {
      $database = FALSE;
    }
    $cron = (int) $this->state->get('system.cron_last', 0) > $this->time->getCurrentTime() - self::CRON_LATE_SECONDS;

    return [
      ['label' => 'Website', 'ok' => TRUE, 'text' => '✓ Working'],
      ['label' => 'Database', 'ok' => $database, 'text' => $database ? '✓ Working' : '! Problem'],
      ['label' => 'Scheduled jobs', 'ok' => $cron, 'text' => $cron ? '✓ Working' : '! Problem'],
      // Unknown is not a failure: GitHub may simply be unreachable.
      [
        'label' => 'Security releases',
        'ok' => $security !== FALSE,
        'text' => match ($security) {
          TRUE => '✓ Up to date',
          FALSE => '! Update needed',
          NULL => '– Unknown',
        },
      ],
    ];
  }

  private static function count(mixed $value): int {
    return is_int($value) ? max(0, min($value, 100000)) : 0;
  }

  private static function commit(mixed $value): string {
    return is_string($value) && preg_match('/^[0-9a-f]{7,40}$/D', $value) ? substr($value, 0, 7) : '';
  }

  private static function time(mixed $value): int {
    $time = is_string($value) ? strtotime($value) : FALSE;
    return $time === FALSE ? 0 : $time;
  }

}
