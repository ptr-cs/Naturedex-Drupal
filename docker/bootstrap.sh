#!/bin/sh
# Creates Drupal's database account, then installs and seeds the site. Safe to
# run again: it skips what already exists.
set -eu
php /opt/naturedex/scripts/db-user.php
naturedex-task install
naturedex-task setup
