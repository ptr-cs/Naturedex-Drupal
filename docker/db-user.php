<?php

/**
 * @file
 * Creates or updates the database account Drupal connects as, with rights to
 * its own database only. Only the bootstrap task holds the RDS master login it
 * needs; the containers that serve visitors never do. Safe to run again.
 */

declare(strict_types=1);

$env = static fn (string $name): string => (string) getenv($name);
$admin = $env('NATUREDEX_DB_ADMIN_USER');
if ($admin === '') {
  echo "No database admin login given; leaving database accounts alone.\n";
  exit(0);
}
$user = $env('NATUREDEX_DB_USER');
$database = $env('NATUREDEX_DB_NAME');
$password = $env('NATUREDEX_DB_PASSWORD');
// Identifiers can't be bound as parameters, so allow only plain names.
foreach ([$user, $database] as $name) {
  if (!preg_match('/^[A-Za-z0-9_]{1,32}$/', $name)) {
    fwrite(STDERR, "Unexpected database or user name.\n");
    exit(1);
  }
}
if ($user === $admin || strlen($password) < 16) {
  fwrite(STDERR, "NATUREDEX_DB_USER must be a separate account with a password of at least 16 characters.\n");
  exit(1);
}

$pdo = new Pdo\Mysql(
  'mysql:host=' . $env('NATUREDEX_DB_HOST') . ';port=3306',
  $admin,
  $env('NATUREDEX_DB_ADMIN_PASSWORD'),
  [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    Pdo\Mysql::ATTR_SSL_CA => '/etc/ssl/certs/rds-global-bundle.pem',
    Pdo\Mysql::ATTR_SSL_VERIFY_SERVER_CERT => $env('NATUREDEX_DB_VERIFY_CERT') !== 'false',
  ],
);
$account = $pdo->quote($user) . "@'%'";
$secret = $pdo->quote($password);
$pdo->exec("CREATE USER IF NOT EXISTS $account IDENTIFIED BY $secret REQUIRE SSL");
// Picks up a rotated password.
$pdo->exec("ALTER USER $account IDENTIFIED BY $secret REQUIRE SSL");
// What Drupal documents for MySQL, on its own database only.
$pdo->exec("GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, CREATE TEMPORARY TABLES, LOCK TABLES ON `$database`.* TO $account");
echo "Database account $user is ready.\n";
