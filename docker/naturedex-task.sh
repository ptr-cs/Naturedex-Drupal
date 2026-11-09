#!/bin/sh
# Runs scripts/drupal-task.php from the Drupal web root, as the web server user
# so any files it writes stay usable by Apache.
set -eu
cd /opt/drupal/web
exec setpriv --reuid=www-data --regid=www-data --init-groups php /opt/naturedex/scripts/drupal-task.php "$@"
