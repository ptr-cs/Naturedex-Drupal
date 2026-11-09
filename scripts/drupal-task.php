<?php

/**
 * @file
 * Runs a Naturedex task inside Drupal. Run it from the Drupal web root, with
 * php (production) or `frankenphp php-cli` (local).
 *
 *   install                Install Drupal into the database settings.php names,
 *                          if it is not installed yet. The admin password comes
 *                          from NATUREDEX_ADMIN_PASSWORD.
 *   setup                  Enable the module and themes, then add missing seeds.
 *   rebuild                Clear every cache.
 *   cron                   Run Drupal's scheduled work.
 *   test-users <file>      Create the browser-test accounts; write sign-in links.
 */

declare(strict_types=1);

use Drupal\Core\DrupalKernel;
use Drupal\Core\Installer\Exception\AlreadyInstalledException;
use Drupal\user\Entity\User;
use Symfony\Component\HttpFoundation\Request;

// FrankenPHP's php-cli puts its own executable before the script name.
$args = array_values(array_filter(array_slice($argv, 1), static fn ($arg) => $arg !== __FILE__ && !str_ends_with($arg, 'drupal-task.php')));
$task = $args[0] ?? '';
$project = dirname(__DIR__);
$root = getcwd();

$autoloader = require $root . '/autoload.php';

if ($task === 'install') {
  // What core's quick-start installer and Drush do internally, but using the
  // database settings.php already defines (SQLite locally, MySQL on AWS).
  require_once $root . '/core/includes/install.core.inc';
  $password = (string) getenv('NATUREDEX_ADMIN_PASSWORD');
  if (strlen($password) < 12) {
    fwrite(STDERR, "Set NATUREDEX_ADMIN_PASSWORD to at least 12 characters.\n");
    exit(1);
  }
  try {
    install_drupal($autoloader, [
      'interactive' => FALSE,
      'site_path' => 'sites/default',
      'parameters' => ['profile' => 'minimal', 'langcode' => 'en'],
      'forms' => [
        'install_configure_form' => [
          'site_name' => 'Naturedex',
          'site_mail' => getenv('NATUREDEX_SITE_MAIL') ?: 'naturedex@example.com',
          'account' => [
            'name' => getenv('NATUREDEX_ADMIN_USER') ?: 'admin',
            'mail' => getenv('NATUREDEX_SITE_MAIL') ?: 'naturedex@example.com',
            'pass' => ['pass1' => $password, 'pass2' => $password],
          ],
          // Programmatic submissions need NULL, not FALSE, to leave these off.
          'enable_update_status_module' => NULL,
          'enable_update_status_emails' => NULL,
        ],
      ],
    ]);
    echo "Drupal installed.\n";
  }
  catch (AlreadyInstalledException) {
    echo "Drupal is already installed.\n";
  }
  exit(0);
}

$request = Request::create('http://127.0.0.1/');
$kernel = DrupalKernel::createFromRequest($request, $autoloader, 'prod');
$kernel->boot();
$kernel->preHandle($request);
$container = $kernel->getContainer();

switch ($task) {
  case 'setup':
    $modules = ['dblog', 'toolbar', 'views', 'naturedex_core'];
    $container->get('module_installer')->install($modules);
    // A new container after installing modules.
    $container = \Drupal::getContainer();
    $container->get('theme_installer')->install(['naturedex', 'claro']);
    $container->get('config.factory')->getEditable('system.theme')->set('default', 'naturedex')->set('admin', 'claro')->save();
    // Generic listings this site does not use.
    foreach (['frontpage', 'taxonomy_term', 'glossary', 'archive'] as $view) {
      $container->get('entity_type.manager')->getStorage('view')->load($view)?->disable()->save();
    }
    $counts = $container->get(\Drupal\naturedex_core\Seeder::class)->seed($project . '/data');
    drupal_flush_all_caches();
    $added = array_filter($counts);
    echo $added
      ? 'Imported ' . implode(', ', array_map(static fn ($kind, $n) => "$n $kind", array_keys($added), $added)) . ".\n"
      : "Seed data already present; nothing imported.\n";
    break;

  case 'rebuild':
    drupal_flush_all_caches();
    break;

  case 'cron':
    $container->get('cron')->run();
    echo "Cron ran.\n";
    break;

  case 'test-users':
    $links = [];
    foreach (['editor', 'contributor', 'reader'] as $name) {
      $user = user_load_by_name("test-$name") ?: User::create(['name' => "test-$name", 'mail' => "$name@example.test", 'status' => 1]);
      if ($name !== 'reader') {
        $user->addRole($name);
      }
      $user->setPassword('test-password');
      $user->save();
      // A one-time sign-in link, as drush user:login would print.
      $links[$name] = parse_url(user_pass_reset_url($user) . '/login', PHP_URL_PATH);
    }
    file_put_contents($args[1], json_encode($links, JSON_PRETTY_PRINT));
    break;

  default:
    fwrite(STDERR, "Unknown task: $task\n");
    exit(1);
}
