<?php

/**
 * @file
 * Production settings. Everything comes from the environment, which ECS fills
 * from Secrets Manager, so this file holds no secrets.
 */

declare(strict_types=1);

$env = static fn (string $name): string => (string) getenv($name);

$databases['default']['default'] = [
  'driver' => 'mysql',
  'namespace' => 'Drupal\\mysql\\Driver\\Database\\mysql',
  'autoload' => 'core/modules/mysql/src/Driver/Database/mysql/',
  'database' => $env('NATUREDEX_DB_NAME'),
  'username' => $env('NATUREDEX_DB_USER'),
  'password' => $env('NATUREDEX_DB_PASSWORD'),
  'host' => $env('NATUREDEX_DB_HOST'),
  'port' => '3306',
  'prefix' => '',
  'collation' => 'utf8mb4_general_ci',
  // Drupal's recommendation for MySQL; fewer deadlocks than REPEATABLE READ.
  'isolation_level' => 'READ COMMITTED',
  // The database requires TLS, and the RDS bundle lets PHP check who answers.
  // Only the smoke test's self-signed MySQL turns verification off.
  'pdo' => [
    Pdo\Mysql::ATTR_SSL_CA => '/etc/ssl/certs/rds-global-bundle.pem',
    Pdo\Mysql::ATTR_SSL_VERIFY_SERVER_CERT => $env('NATUREDEX_DB_VERIFY_CERT') !== 'false',
  ],
];

$settings['hash_salt'] = $env('NATUREDEX_HASH_SALT');
$settings['trusted_host_patterns'] = array_map(
  static fn (string $host) => '^' . preg_quote(trim($host)) . '$',
  array_filter(explode(',', $env('NATUREDEX_HOSTS'))),
);
$settings['config_sync_directory'] = '/opt/naturedex/config-sync';
$settings['update_free_access'] = FALSE;
// Code is read-only in the image; Drupal need not check file permissions.
$settings['skip_permissions_hardening'] = TRUE;
$settings['file_scan_ignore_directories'] = ['node_modules', 'bower_components'];

$config['system.logging']['error_level'] = 'hide';
// CloudFront keeps anonymous pages this long; see SharedCacheSubscriber.
$config['system.performance']['cache']['page']['max_age'] = 300;
$config['system.performance']['css']['preprocess'] = TRUE;
$config['system.performance']['js']['preprocess'] = TRUE;

// Restores the visitor's scheme and address from CloudFront's headers; see
// naturedex_core's StackMiddleware\CloudFrontMiddleware.
$settings['naturedex_cloudfront'] = TRUE;
