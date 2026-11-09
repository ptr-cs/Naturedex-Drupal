# Build from the repository root: docker build -f docker/Dockerfile .
# The Drupal version must match DRUPAL_VERSION in scripts/runtime.mjs, which is
# what the automated tests run against.

FROM node:24-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY scripts/build-frontend.mjs scripts/
COPY frontend frontend
RUN node scripts/build-frontend.mjs

FROM drupal:11.4.11-php8.5-apache-trixie
# The base image only gets OS fixes when it's republished, so apply them here.
# Rebuilding picks up new ones.
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

# Lets PHP verify the database's TLS certificate. A new bundle from AWS fails the
# build here until this checksum is updated.
ADD --chmod=644 --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem

# Code ships only in the image, so nothing can change it on a running site.
WORKDIR /opt/drupal/web
COPY drupal/modules/naturedex_core modules/custom/naturedex_core
COPY drupal/themes/naturedex themes/custom/naturedex
COPY --from=frontend /build/drupal/themes/naturedex/assets/dist themes/custom/naturedex/assets/dist
COPY docker/settings.php sites/default/settings.php
COPY data /opt/naturedex/data
COPY scripts/drupal-task.php /opt/naturedex/scripts/drupal-task.php
# Generated CSS/JS aggregates and compiled templates. Drupal recreates them on
# demand, so each task keeps its own and nothing needs shared storage.
RUN mkdir -p sites/default/files /opt/naturedex/config-sync \
 && chown -R www-data:www-data sites/default/files \
 && printf 'ok\n' > healthz.html

COPY docker/php.ini /usr/local/etc/php/conf.d/naturedex.ini
# Loads after the image's security.conf, which would otherwise override it.
COPY docker/apache.conf /etc/apache2/conf-enabled/zz-naturedex.conf
COPY --chmod=755 docker/naturedex-task.sh /usr/local/bin/naturedex-task
COPY --chmod=755 docker/bootstrap.sh /usr/local/bin/naturedex-bootstrap
RUN a2enmod expires headers rewrite

CMD ["apache2-foreground"]
