#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d)"
cleanup() {
  if [[ -n ${live_project:-} ]]; then live_compose down -v >/dev/null 2>&1 || true; fi
  rm -rf "$fixture"
}
trap cleanup EXIT
instance="$fixture/site"
digest="$(printf '%064d' 0)"
docker_bin="$(command -v docker)"
unset PUBLIC_URL CROWHR_IMAGE_SHA256
launcher="$root/deploy/hosted/crowhr-vps"
"$launcher" prepare "$instance" crowhr-fixture hr.example.test "$digest" >/dev/null
[[ $(stat -c %a "$instance") == 700 && $(stat -c %a "$instance/.env") == 600 ]]
[[ -x "$instance/crowhr-vps" ]]
grep -qE '^BACKUP_PASSPHRASE=[0-9a-f]{64}$' "$instance/.env"
if "$launcher" prepare "$instance" crowhr-different other.example.test "$digest" >/dev/null 2>&1; then
  echo "prepare replaced an existing installation" >&2
  exit 1
fi
for arguments in 'https://hr.example.test invalid' "hr.example.test invalid"; do
  read -r hostname image_digest <<< "$arguments"
  if "$launcher" prepare "$fixture/invalid" crowhr-fixture "$hostname" "$image_digest" >/dev/null 2>&1; then
    echo "prepare accepted invalid configuration" >&2
    exit 1
  fi
done
[[ ! -e "$fixture/invalid" ]]
project="$(<"$instance/project")"
[[ "$project" =~ ^crowhr-fixture-[0-9a-f]{16}$ ]]
"$launcher" prepare "$fixture/second" crowhr-fixture other.example.test "$digest" >/dev/null
[[ $(<"$fixture/second/project") != "$project" ]]

(
  cd "$instance"
  docker compose -p "$project" -f docker-compose.yml -f compose.hosted.yml -f compose.caddy.yml config --format json
) | jq -e --arg digest "$digest" --arg project "$project" '
  .name == $project and
  .services.app.image == ("ghcr.io/crow-tech-pte-ltd/crowhr@sha256:" + $digest) and
  .services.app.environment.CROWHR_HOSTED == "true" and
  .services.app.environment.TRUSTED_PROXIES == "private" and
  (.services.app.ports | length) == 0 and
  (.services.db.ports | length) == 0 and
  (.services.caddy.ports | map(.published) | sort) == ["443", "80"] and
  .services.caddy.environment.PUBLIC_URL == "https://hr.example.test" and
  .volumes.caddy_data.name == ($project + "_caddy_data")
' >/dev/null

# The full Docker smoke passes its already-built release image. TLS stays on loopback with
# a test CA, so this exercises the real overlay without public DNS or issuing a certificate.
if [[ $# == 1 ]]; then
  live="$fixture/live"
  "$launcher" prepare "$live" crowhr-vps-smoke hr.example.test "$digest" >/dev/null
  live_project="$(<"$live/project")"
  export VPS_TEST_APP_IMAGE="$1"
  export VPS_TEST_CADDY_IMAGE="${CADDY_IMAGE:-caddy:2-alpine}"
  cat > "$live/compose.test.yml" <<'MOCK'
services:
  init:
    image: ${VPS_TEST_APP_IMAGE:?}
  app:
    image: ${VPS_TEST_APP_IMAGE:?}
  caddy:
    image: ${VPS_TEST_CADDY_IMAGE:?}
    ports: !override
      - "127.0.0.1::443"
MOCK
  sed -i '/^{$PUBLIC_URL} {/a\	tls internal' "$live/Caddyfile"
  live_compose() {
    "$docker_bin" compose -p "$live_project" --project-directory "$live" --env-file "$live/.env" \
      -f "$live/docker-compose.yml" -f "$live/compose.hosted.yml" -f "$live/compose.caddy.yml" \
      -f "$live/compose.test.yml" "$@"
  }
  live_compose up -d --wait --wait-timeout 180 --pull never
  [[ -z $(docker port "$(live_compose ps -q app)") ]]
  [[ -z $(docker port "$(live_compose ps -q db)") ]]
  tls_address="$(live_compose port caddy 443)"
  proxy="hr.example.test:443:$tls_address"
  curl --noproxy "*" --insecure --fail --silent --show-error --retry 5 --retry-all-errors --max-time 5 \
    --connect-to "$proxy" https://hr.example.test/api/health >/dev/null
  live_compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > "$fixture/ca.pem"
  curl --noproxy "*" --fail --silent --show-error --cacert "$fixture/ca.pem" --connect-to "$proxy" \
    https://hr.example.test/api/health | jq -e '.status == "ok"' >/dev/null
  "$live/crowhr-vps" setup-code >/dev/null
  mkdir "$fixture/live-archives"
  "$live/crowhr-vps" backup "$fixture/live-archives"
  [[ $(find "$fixture/live-archives" -maxdepth 1 -type f -name '*.tar.gz.age' | wc -l) == 1 ]]
fi

mkdir "$fixture/bin" "$fixture/archives"
export COMMAND_LOG="$fixture/commands"
cat > "$fixture/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$COMMAND_LOG"
case " $* " in
  *" exec -T app crowhr backup "*)
    printf 'Backup written: /backups/crowhr-backup-20260101T120000Z.tar.gz.age (2 kB)\n'
    ;;
  *" exec -T app cat /backups/crowhr-backup-20260101T120000Z.tar.gz.age "*)
    case "${COPY_MODE:-ok}" in
      failed) printf 'partial'; exit 1 ;;
      plaintext) printf 'not an encrypted archive\n' ;;
      ok) printf 'age-encryption.org/v1\nopaque archive contents\n' ;;
    esac ;;
esac
MOCK
cat > "$fixture/bin/curl" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$COMMAND_LOG"
if [[ ${HEALTH_MODE:-ok} == failed ]]; then exit 1; fi
printf '{"status":"ok"}\n'
MOCK
chmod +x "$fixture/bin/docker" "$fixture/bin/curl"
export PATH="$fixture/bin:$PATH"
installed="$instance/crowhr-vps"
if HEALTH_MODE=failed "$installed" up >/dev/null 2>&1; then
  echo "up reported success while HTTPS was unreachable" >&2
  exit 1
fi
"$installed" up >/dev/null
"$installed" check >/dev/null
"$installed" setup-code >/dev/null
has_command() { grep -qF -- "$1" "$COMMAND_LOG"; }
has_command 'up -d --wait'
has_command 'hr.example.test:443:127.0.0.1'
has_command 'exec -T app crowhr setup-code'

for mode in failed plaintext; do
  if COPY_MODE="$mode" "$installed" backup "$fixture/archives" >/dev/null 2>&1; then
    echo "backup accepted a $mode export" >&2
    exit 1
  fi
  [[ -z $(find "$fixture/archives" -mindepth 1 -print) ]]
done
"$installed" backup "$fixture/archives" >/dev/null
archive="$fixture/archives/crowhr-backup-20260101T120000Z.tar.gz.age"
[[ -f "$archive" && $(stat -c %a "$archive") == 600 ]]
if "$installed" backup "$fixture/archives" >/dev/null 2>&1; then
  echo "backup replaced an existing archive" >&2
  exit 1
fi
[[ $(find "$fixture/archives" -mindepth 1 -type f | wc -l) == 1 ]]
printf 'Hosted VPS installer checks passed.\n'
