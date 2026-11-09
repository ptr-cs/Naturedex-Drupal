#!/bin/sh
# Installs and seeds the site. Safe to run again: it skips what already exists.
set -eu
naturedex-task install
naturedex-task setup
