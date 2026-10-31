#!/usr/bin/env bash
# Self-host smoke test: a real `docker compose` install, following apps/docs/src/content/docs/self-hosting/install.md,
# in a throwaway compose project. It touches only containers, volumes and the image it creates.
#
#   e2e/self-host.sh                 # build the image, run everything, clean up
#   SKIP_BUILD=1 CROWHR_IMAGE=crowhr:x e2e/self-host.sh
#   KEEP_IMAGE=1 e2e/self-host.sh    # keep the built image afterwards
#
# Steps: install with only PUBLIC_URL set → healthy → setup wizard in a real browser → backup →
# wipe everything → fresh install → restore → data, files, key and sign-in back → lost data volume
# refused and recovered with --secrets-only → behind Caddy with and without TRUSTED_PROXIES.
set -euo pipefail

PROJECT="${PROJECT:-crowhr-selfhost-test}"
IMAGE="${CROWHR_IMAGE:-crowhr:selfhost-test}"
HTTP_PORT="${HTTP_PORT:-18080}"
CADDY_PORT="${CADDY_PORT:-18443}"
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2-alpine}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/crowhr-selfhost.XXXXXX")"
PUBLIC_URL="http://127.0.0.1:${HTTP_PORT}"
CADDY="${PROJECT}-caddy"
OWNER_EMAIL="aisyah@kampongkopi.example"
OWNER_PASSWORD="kopi-o kosong peng, siew dai"

export CROWHR_IMAGE="$IMAGE"
compose() { docker compose -p "$PROJECT" --project-directory "$WORK" -f "$WORK/docker-compose.yml" "$@"; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() {
  printf '\033[31mFAIL: %s\033[0m\n' "$*" >&2
  compose ps -a >&2 || true
  compose logs --no-color --tail=80 app >&2 || true
  exit 1
}

cleanup() {
  step "Cleaning up (only ${PROJECT} resources)"
  docker rm -f "$CADDY" >/dev/null 2>&1 || true
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  if [ -z "${KEEP_IMAGE:-}" ] && [ -z "${SKIP_BUILD:-}" ]; then docker image rm "$IMAGE" >/dev/null 2>&1 || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

wait_healthy() {
  local deadline=$((SECONDS + ${1:-120}))
  until curl -fsS "$PUBLIC_URL/api/health" >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$deadline" ] || fail "app not healthy within ${1:-120}s"
    sleep 2
  done
  # Docker's own health status must agree.
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q app)")" = "healthy" ]; do
    [ "$SECONDS" -lt "$deadline" ] || fail "container health is not 'healthy'"
    sleep 2
  done
}

setup_code() { compose logs --no-color app | grep -A2 'CROW HR SETUP CODE' | grep -oE '[A-Z0-9]{4}(-[A-Z0-9]{4}){3}' | tail -1; }

if [ -z "${SKIP_BUILD:-}" ]; then
  step "Building ${IMAGE}"
  docker build -t "$IMAGE" "$ROOT"
fi
size=$(docker image inspect -f '{{.Size}}' "$IMAGE")
echo "image size: $((size / 1000 / 1000)) MB"
[ "$size" -lt 250000000 ] || fail "image is larger than 250 MB"

step "Install: copy .env.example to .env, set PUBLIC_URL, docker compose up -d"
cp "$ROOT/docker-compose.yml" "$ROOT/.env.example" "$WORK/"
cp "$WORK/.env.example" "$WORK/.env"
sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=${PUBLIC_URL}|; s|^HTTP_PORT=.*|HTTP_PORT=${HTTP_PORT}|; s|^BIND_ADDRESS=.*|BIND_ADDRESS=127.0.0.1|" "$WORK/.env"
start=$SECONDS
compose up -d --no-build
wait_healthy 120
echo "healthy after $((SECONDS - start)) s"

step "Fresh install checks"
health=$(curl -fsS "$PUBLIC_URL/api/health")
echo "$health" | grep -q '"status":"ok"' || fail "health: $health"
[ "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$PUBLIC_URL/")" = "302 ${PUBLIC_URL}/setup" ] || fail "/ does not redirect to /setup"
curl -fsS "$PUBLIC_URL/setup" | grep -q '<div id="root">' || fail "/setup is not the web app"
compose logs --no-color app | grep -q "Open ${PUBLIC_URL}/setup" || fail "setup URL not in logs"
CODE=$(setup_code)
[ -n "$CODE" ] || fail "no setup code in logs"
echo "setup code from logs: $CODE"
[ -z "$(docker port "$(compose ps -q db)")" ] || fail "postgres publishes a host port"
[ "$(compose exec -T app stat -c '%a %u' /data/secrets/crowhr.key)" = "600 10001" ] || fail "key file mode/owner"
[ "$(compose exec -T app id -u)" = "10001" ] || fail "app does not run as uid 10001"
[ "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$(compose ps -q app)")" = "true" ] || fail "root filesystem is writable"
compose logs --no-color app | grep -q "Generated a new encryption key at /data/secrets/crowhr.key" || fail "no key generation log line"

step "Setup wizard in a real browser (Playwright)"
(cd "$ROOT" && SELFHOST_URL="$PUBLIC_URL" SELFHOST_SETUP_CODE="$CODE" bunx playwright test -c e2e/selfhost.config.ts)
[ "$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/api/v1/setup")" = "404" ] || fail "/api/v1/setup not 404 after setup"

step "Seed an uploaded file, then crowhr doctor and crowhr backup"
compose exec -T app sh -c 'mkdir -p /data/files/blobs/receipts && printf "%%PDF receipt r-001" > /data/files/blobs/receipts/r-001.pdf'
KEY_SUM=$(compose exec -T app sha256sum /data/secrets/crowhr.key | cut -d' ' -f1)
compose exec -T app crowhr doctor || fail "crowhr doctor reported problems"
backup_out=$(compose exec -T app crowhr backup 2>&1) || fail "crowhr backup: $backup_out"
echo "$backup_out"
echo "$backup_out" | grep -q "contains your encryption key" || fail "no unencrypted-key warning"
ARCHIVE=$(echo "$backup_out" | grep -oE '/backups/crowhr-backup-[0-9TZ]+\.tar\.gz' | head -1)
[ -n "$ARCHIVE" ] || fail "no archive path"
compose exec -T app cat "$ARCHIVE" > "$WORK/backup.tar.gz"
tar -tzf "$WORK/backup.tar.gz" | sort | tr '\n' ' '
echo
tar -tzf "$WORK/backup.tar.gz" | grep -q '^files/blobs/receipts/r-001.pdf$' || fail "file missing from archive"
encrypted_out=$(compose exec -T app crowhr backup --passphrase "correct horse battery staple" 2>&1) || fail "encrypted backup: $encrypted_out"
echo "$encrypted_out" | grep -q 'tar.gz.age' || fail "encrypted backup not .age"

step "Disaster: delete everything (docker compose down -v), install fresh, restore"
compose down -v
compose up -d --no-build
wait_healthy 120
[ "$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/api/v1/setup")" = "200" ] || fail "fresh install not in setup mode"
NEW_KEY_SUM=$(compose exec -T app sha256sum /data/secrets/crowhr.key | cut -d' ' -f1)
[ "$NEW_KEY_SUM" != "$KEY_SUM" ] || fail "fresh install reused the old key"
compose exec -T app sh -c 'cat > /backups/restore-me.tar.gz' < "$WORK/backup.tar.gz"
restore_out=$(compose exec -T app crowhr restore /backups/restore-me.tar.gz 2>&1) || fail "crowhr restore: $restore_out"
echo "$restore_out"
echo "$restore_out" | grep -q "Restarting the app" || fail "restore did not restart the app"
sleep 3
wait_healthy 120
[ "$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/api/v1/setup")" = "404" ] || fail "organisation not restored"
[ "$(compose exec -T db psql -U crowhr -d crowhr -tAc 'select name from organisations')" = "Kampong Kopi Pte. Ltd." ] || fail "organisation row"
[ "$(compose exec -T app cat /data/files/blobs/receipts/r-001.pdf)" = "%PDF receipt r-001" ] || fail "file not restored"
[ "$(compose exec -T app sha256sum /data/secrets/crowhr.key | cut -d' ' -f1)" = "$KEY_SUM" ] || fail "key not restored"
signin=$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -H "origin: ${PUBLIC_URL}" \
  -d "{\"org\":\"kampong-kopi\",\"email\":\"${OWNER_EMAIL}\",\"password\":\"${OWNER_PASSWORD}\"}" "$PUBLIC_URL/api/v1/auth/sign-in")
[ "$signin" = "200" ] || fail "owner cannot sign in after restore ($signin)"
again=$(compose exec -T app crowhr restore /backups/restore-me.tar.gz --no-restart 2>&1) && fail "restore over data without --force succeeded"
echo "$again" | grep -q -- "--force" || fail "no --force hint: $again"

step "Lost data volume: the app refuses to generate a new key; --secrets-only recovers"
compose stop app
compose rm -f app >/dev/null
docker volume rm "${PROJECT}_data" >/dev/null
compose up -d --no-build app
deadline=$((SECONDS + 60))
until compose logs --no-color app 2>/dev/null | grep -q "does not match this database"; do
  [ "$SECONDS" -lt "$deadline" ] || fail "app did not refuse the missing key"
  sleep 2
done
compose logs --no-color app | grep -q "crowhr restore --secrets-only" || fail "no --secrets-only hint"
compose stop app >/dev/null
compose run --rm --no-deps -T app crowhr restore --secrets-only /backups/restore-me.tar.gz
compose up -d --no-build app
wait_healthy 120

step "Behind Caddy (${CADDY_IMAGE})"
cookie="$WORK/cookies.txt"
signin_via() {
  curl -fsS -c "$cookie" -o /dev/null -H 'content-type: application/json' -H "origin: ${PUBLIC_URL}" \
    -d "{\"org\":\"kampong-kopi\",\"email\":\"${OWNER_EMAIL}\",\"password\":\"${OWNER_PASSWORD}\"}" "$1/api/v1/auth/sign-in"
}
docker run -d --name "$CADDY" --network "${PROJECT}_default" -p "127.0.0.1:${CADDY_PORT}:80" "$CADDY_IMAGE" \
  caddy reverse-proxy --from :80 --to app:8080 >/dev/null
CADDY_URL="http://127.0.0.1:${CADDY_PORT}"
deadline=$((SECONDS + 30))
until curl -fsS "$CADDY_URL/api/health" >/dev/null 2>&1; do
  [ "$SECONDS" -lt "$deadline" ] || fail "caddy not proxying"
  sleep 1
done
signin_via "$CADDY_URL"
untrusted=$(curl -fsS -b "$cookie" -H 'x-forwarded-for: 6.6.6.6' "$CADDY_URL/api/v1/system/status")
echo "TRUSTED_PROXIES empty: $(echo "$untrusted" | grep -oE '"request":\{[^}]*\}')"
echo "$untrusted" | grep -q '"viaTrustedProxy":false' || fail "untrusted proxy treated as trusted"
echo "$untrusted" | grep -q '"clientIp":"6.6.6.6"' && fail "spoofed X-Forwarded-For believed"
compose logs --no-color app | grep -q "Ignoring X-Forwarded-\* headers from" || fail "no untrusted-proxy hint in logs"

sed -i "s|^TRUSTED_PROXIES=.*|TRUSTED_PROXIES=private|" "$WORK/.env"
compose up -d --no-build app
wait_healthy 120
signin_via "$CADDY_URL"
trusted=$(curl -fsS -b "$cookie" -H 'x-forwarded-for: 6.6.6.6' "$CADDY_URL/api/v1/system/status")
echo "TRUSTED_PROXIES=private: $(echo "$trusted" | grep -oE '"request":\{[^}]*\}')"
echo "$trusted" | grep -q '"viaTrustedProxy":true' || fail "caddy not trusted with TRUSTED_PROXIES=private"
echo "$trusted" | grep -q '"clientIp":"6.6.6.6"' && fail "Caddy passed a spoofed X-Forwarded-For through"
echo "$trusted" | grep -qE '"clientIp":"[0-9.]+"' || fail "no client IP"

step "All self-host checks passed"
