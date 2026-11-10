#!/bin/sh
# Boots the production image against real MySQL with TLS required, then checks
# what the local SQLite tests can't: the image, settings.php, Apache, MySQL, and
# the CloudFront header handling.
set -eu
image="$1"
network=naturedex-smoke
password=smoke-test-only
app_password=smoke-test-only-app
base=http://127.0.0.1:8080

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    docker logs naturedex-web 2>&1 | tail -40 || true
  fi
  docker rm -f naturedex-web naturedex-db >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT
fail_early() {
  echo "FAIL $*"
  exit 1
}

docker network create "$network" >/dev/null
docker run -d --name naturedex-db --network "$network" \
  -e MYSQL_ROOT_PASSWORD="$password" -e MYSQL_DATABASE=drupal \
  mysql:8.4 --require-secure-transport=ON >/dev/null

echo 'Waiting for MySQL'
for _ in $(seq 1 60); do
  # Over TCP: the image's first start also runs a socket-only server, which
  # would otherwise look ready too early.
  docker exec naturedex-db mysql -h127.0.0.1 -uroot -p"$password" -e 'SELECT 1' drupal >/dev/null 2>&1 && break
  sleep 2
done

# The smoke-test MySQL has a self-signed certificate. TLS is still required by
# the server; only verification is off, here and nowhere else.
set -- --network "$network" \
  -e NATUREDEX_DB_NAME=drupal -e NATUREDEX_DB_HOST=naturedex-db \
  -e NATUREDEX_DB_USER=naturedex_app -e NATUREDEX_DB_PASSWORD="$app_password" \
  -e NATUREDEX_DB_VERIFY_CERT=false \
  -e NATUREDEX_HASH_SALT=smoke-test-only-salt-smoke-test-only-salt \
  -e NATUREDEX_HOSTS=127.0.0.1,localhost

# Like RDS: only the bootstrap task gets the master login, which it uses to
# create the account everything else connects as.
master='-e NATUREDEX_DB_ADMIN_USER=root -e NATUREDEX_DB_ADMIN_PASSWORD='"$password"
echo 'Running the bootstrap task'
# shellcheck disable=SC2086
docker run --rm "$@" $master -e NATUREDEX_ADMIN_USER=naturedex-admin -e NATUREDEX_ADMIN_PASSWORD="$password-admin" "$image" naturedex-bootstrap
echo 'Running it again, which must change nothing'
# shellcheck disable=SC2086
docker run --rm "$@" $master -e NATUREDEX_ADMIN_PASSWORD="$password-admin" "$image" naturedex-bootstrap | tee /tmp/naturedex-second-run
grep -q 'Drupal is already installed.' /tmp/naturedex-second-run
grep -q 'Seed data already present; nothing imported.' /tmp/naturedex-second-run
grants=$(docker exec naturedex-db mysql -h127.0.0.1 -uroot -p"$password" -N -e "SHOW GRANTS FOR 'naturedex_app'@'%'" 2>/dev/null)
echo "$grants" | grep -q 'ON `drupal`\.\*' || fail_early "the app account should have rights on drupal.*: $grants"
echo "$grants" | grep -q 'ON \*\.\*.*\(SELECT\|ALL\)' && fail_early "the app account must not have global rights: $grants"
echo 'ok   Drupal connects with an account limited to its own database'

echo 'Running the scheduled task command'
docker run --rm "$@" "$image" naturedex-task cron | grep -q 'Cron ran.'

echo 'Creating a test editor (in this throwaway database only)'
login=$(docker run --rm "$@" "$image" sh -c 'naturedex-task test-users /tmp/links.json >/dev/null && cat /tmp/links.json' | sed -n 's/.*"editor": "\(.*\)".*/\1/p' | sed 's#\\/#/#g')

docker run -d --name naturedex-web -p 8080:80 "$@" "$image" >/dev/null
for _ in $(seq 1 30); do
  curl -sf "$base/healthz.html" >/dev/null && break
  sleep 1
done

fail() {
  echo "FAIL $*"
  exit 1
}
expect() {
  actual=$(curl -s -o /dev/null -w '%{http_code}' "$base$1")
  [ "$actual" = "$2" ] || fail "$1: expected $2, got $actual"
  echo "ok   $1 -> $actual"
}
contains() {
  curl -s "$base$1" | grep -q "$2" || fail "$1: missing \"$2\""
  echo "ok   $1 contains \"$2\""
}

expect /healthz.html 200
expect / 200
expect /map 200
expect /journal 200
expect /journal/read-the-water 200
expect /about 200
expect /species/red-fox 200
expect /no-such-trail 404
expect /editor 302
expect /user/login 200
expect /user/register 403
expect /taxonomy/term/1 403
expect /node 404
expect /core/install.php 403
expect /update.php 403
expect /core/rebuild.php 403
expect /core/CHANGELOG.txt 403
expect /core/INSTALL.txt 403
expect /README.md 403
expect /robots.txt 200
expect /user/1 404
expect /user/99999 404
contains / 'Meet your wild neighbors'
contains /api/naturedex/regions 'Blue Ridge'
count=$(curl -s "$base/api/naturedex/species" | grep -o '"dexNumber"' | wc -l)
[ "$count" -eq 24 ] || fail "expected 24 species, got $count"
echo 'ok   24 species'

curl -sI "$base/" | grep -qi 's-maxage=300' || fail 'public pages must be cacheable by CloudFront'
curl -sI "$base/" | grep -qi 'max-age=0' || fail 'browsers must revalidate public pages'
echo 'ok   public pages are cacheable at the edge only'
server=$(curl -sI "$base/" | tr -d '\r' | awk 'tolower($1)=="server:"{print $2}')
[ "$server" = Apache ] || fail "server header reveals a version: $server"
echo 'ok   server header hides the version'
curl -sI "$base/" | grep -qi '^x-generator' && fail 'responses must not send X-Generator'
echo 'ok   no X-Generator header'
css=$(curl -s "$base/" | sed -n 's/.*<link rel="stylesheet" media="all" href="\([^"]*\)".*/\1/p' | head -1 | sed 's/&amp;/\&/g')
[ -n "$css" ] || fail 'no stylesheet link'
expect "$css" 200

# What CloudFront sends: the viewer's host without a port, the scheme, and the
# visitor's address. Links and cookies must use https, and the visitor's
# address must replace the load balancer's.
cf='-H Host:127.0.0.1 -H CloudFront-Forwarded-Proto:https -H CloudFront-Viewer-Address:198.51.100.7:51234'
# shellcheck disable=SC2086
curl -s $cf "$base/species/red-fox" | grep -q 'rel="canonical" href="https://127.0.0.1/species/red-fox"' \
  || fail 'canonical link must use https behind CloudFront'
echo 'ok   links use https behind CloudFront'
# shellcheck disable=SC2086
cookie=$(curl -s -o /dev/null -D - $cf "$base$login" | tr -d '\r' | grep -i '^set-cookie: SSESSnaturedex=' || true)
[ -n "$cookie" ] || fail 'expected the fixed SSESSnaturedex session cookie'
echo "$cookie" | grep -qi 'secure' || fail 'session cookie must be Secure'
echo "$cookie" | grep -qi 'httponly' || fail 'session cookie must be HttpOnly'
echo "$cookie" | grep -qi 'expires=' && fail 'the session cookie should end with the browser'
echo 'ok   signed in with a Secure, HttpOnly SSESSnaturedex cookie that ends with the browser'
# curl won't send a Secure cookie over plain HTTP from a jar, so pass it directly.
session="Cookie: $(echo "$cookie" | sed 's/^[Ss]et-[Cc]ookie: \([^;]*\);.*/\1/')"
# shellcheck disable=SC2086
status=$(curl -s -o /dev/null -w '%{http_code}' -H "$session" $cf "$base/editor")
[ "$status" = 200 ] || fail "/editor with a session: expected 200, got $status"
echo 'ok   the Writing desk opens with a session'
# shellcheck disable=SC2086
token=$(curl -s -H "$session" $cf "$base/session/token")
# shellcheck disable=SC2086
created=$(curl -s -o /dev/null -w '%{http_code}' -H "$session" $cf -X POST \
  -H "X-CSRF-Token: $token" -H 'Content-Type: application/json' \
  -d '{"title":"Smoke note","slug":"smoke-note","excerpt":"e","body":"b","category":"Smoke"}' \
  "$base/api/naturedex/posts")
[ "$created" = 201 ] || fail "creating a draft through the API: expected 201, got $created"
echo 'ok   a draft saves to MySQL through the API'
docker exec naturedex-db mysql -h127.0.0.1 -uroot -p"$password" drupal -N \
  -e "SELECT hostname FROM sessions ORDER BY timestamp DESC LIMIT 1" 2>/dev/null | grep -q '^198.51.100.7$' \
  || fail 'the session should record the visitor address from CloudFront'
echo 'ok   the visitor address comes from CloudFront'
echo 'Production image passed.'
