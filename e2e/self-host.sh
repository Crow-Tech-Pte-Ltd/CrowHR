#!/usr/bin/env bash
# Self-host smoke test: a real `docker compose` install, following apps/docs/src/content/docs/self-hosting/install.md,
# in a throwaway compose project. It touches only containers, volumes and the image it creates.
#
#   e2e/self-host.sh                 # build the image, run everything, clean up
#   SKIP_BUILD=1 CROWHR_IMAGE=crowhr:x e2e/self-host.sh
#   KEEP_IMAGE=1 e2e/self-host.sh    # keep the built image afterwards
#   PROJECT=x HTTP_PORT=28080 PROXY_PORT_BASE=28440 e2e/self-host.sh   # beside another run
#
# Steps: install with only PUBLIC_URL set → healthy → setup wizard in a real browser → backup →
# wipe everything → fresh install → restore → data, files, key and sign-in back → lost data volume
# refused and recovered with --secrets-only → behind Caddy, nginx (in Docker and on the host) and
# Traefik, configured as on the reverse-proxy docs page, with and without TRUSTED_PROXIES.
#
# Needs docker (compose v2), curl, jq and openssl. Traefik's Docker provider gets the Docker socket
# read-only and is constrained to this compose project's containers.
set -euo pipefail

# `grep -q` exits at the first match; with pipefail, a producer still writing (compose logs, tar)
# then dies of SIGPIPE and the check fails although the text was there. Read all input instead.
has() { grep "$@" >/dev/null; }

PROJECT="${PROJECT:-crowhr-selfhost-test}"
IMAGE="${CROWHR_IMAGE:-crowhr:selfhost-test}"
HTTP_PORT="${HTTP_PORT:-18080}"
# The proxies publish 127.0.0.1:PROXY_PORT_BASE+1 … +7 (see "Behind reverse proxies").
PROXY_PORT_BASE="${PROXY_PORT_BASE:-18440}"
# The versions the reverse-proxy docs page names.
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2-alpine}"
NGINX_IMAGE="${NGINX_IMAGE:-nginx:1.30-alpine}"
TRAEFIK_IMAGE="${TRAEFIK_IMAGE:-traefik:v3.7}"
# `docker image inspect .Size` depends on the image store: GitHub's runners report far less than
# Docker's classic overlay2 store does for the same image. Raise it locally if overlay2 trips it.
IMAGE_MAX_BYTES="${IMAGE_MAX_BYTES:-250000000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/crowhr-selfhost.XXXXXX")"
# The app's own published port. PUBLIC_URL starts as this and becomes https://hr.example.sg
# for the reverse-proxy checks.
APP_URL="http://127.0.0.1:${HTTP_PORT}"
PUBLIC_URL="$APP_URL"
EXTRA_CONTAINERS=("${PROJECT}-caddy" "${PROJECT}-nginx" "${PROJECT}-nginx-host" "${PROJECT}-traefik" "${PROJECT}-placeholder")
OWNER_EMAIL="aisyah@kampongkopi.example"
OWNER_PASSWORD="kopi-o kosong peng, siew dai"

for tool in docker curl jq openssl; do
  command -v "$tool" >/dev/null || { echo "e2e/self-host.sh needs $tool on PATH" >&2; exit 1; }
done

export CROWHR_IMAGE="$IMAGE"
# The reverse-proxy checks add a docker-compose.override.yml (Traefik labels from the docs).
compose() {
  local files=(-f "$WORK/docker-compose.yml")
  [ ! -f "$WORK/docker-compose.override.yml" ] || files+=(-f "$WORK/docker-compose.override.yml")
  docker compose -p "$PROJECT" --project-directory "$WORK" "${files[@]}" "$@"
}
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() {
  printf '\033[31mFAIL: %s\033[0m\n' "$*" >&2
  compose ps -a >&2 || true
  compose logs --no-color --tail=80 app >&2 || true
  exit 1
}

cleanup() {
  step "Cleaning up (only ${PROJECT} resources)"
  # -v: Caddy's image declares /data and /config volumes; remove those anonymous volumes too.
  docker rm -fv "${EXTRA_CONTAINERS[@]}" >/dev/null 2>&1 || true
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  if [ -z "${KEEP_IMAGE:-}" ] && [ -z "${SKIP_BUILD:-}" ]; then docker image rm "$IMAGE" >/dev/null 2>&1 || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

wait_healthy() {
  local deadline=$((SECONDS + ${1:-120}))
  until curl -fsS "$APP_URL/api/health" >/dev/null 2>&1; do
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
[ "$size" -lt "$IMAGE_MAX_BYTES" ] || fail "image is larger than $((IMAGE_MAX_BYTES / 1000 / 1000)) MB"

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
echo "$health" | has '"status":"ok"' || fail "health: $health"
[ "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$PUBLIC_URL/")" = "302 ${PUBLIC_URL}/setup" ] || fail "/ does not redirect to /setup"
curl -fsS "$PUBLIC_URL/setup" | has '<div id="root">' || fail "/setup is not the web app"
compose logs --no-color app | has "Open ${PUBLIC_URL}/setup" || fail "setup URL not in logs"
CODE=$(setup_code)
[ -n "$CODE" ] || fail "no setup code in logs"
echo "setup code from logs: $CODE"
[ -z "$(docker port "$(compose ps -q db)")" ] || fail "postgres publishes a host port"
[ "$(compose exec -T app stat -c '%a %u' /data/secrets/crowhr.key)" = "600 10001" ] || fail "key file mode/owner"
[ "$(compose exec -T app id -u)" = "10001" ] || fail "app does not run as uid 10001"
[ "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$(compose ps -q app)")" = "true" ] || fail "root filesystem is writable"
compose logs --no-color app | has "Generated a new encryption key at /data/secrets/crowhr.key" || fail "no key generation log line"

step "Setup wizard in a real browser (Playwright)"
(cd "$ROOT" && SELFHOST_URL="$PUBLIC_URL" SELFHOST_SETUP_CODE="$CODE" bunx playwright test -c e2e/selfhost.config.ts)
[ "$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/api/v1/setup")" = "404" ] || fail "/api/v1/setup not 404 after setup"

step "Seed an uploaded file, then crowhr doctor and crowhr backup"
compose exec -T app sh -c 'mkdir -p /data/files/blobs/receipts && printf "%%PDF receipt r-001" > /data/files/blobs/receipts/r-001.pdf'
KEY_SUM=$(compose exec -T app sha256sum /data/secrets/crowhr.key | cut -d' ' -f1)
compose exec -T app crowhr doctor || fail "crowhr doctor reported problems"
backup_out=$(compose exec -T app crowhr backup 2>&1) || fail "crowhr backup: $backup_out"
echo "$backup_out"
echo "$backup_out" | has "contains your encryption key" || fail "no unencrypted-key warning"
ARCHIVE=$(echo "$backup_out" | grep -oE '/backups/crowhr-backup-[0-9TZ]+\.tar\.gz' | head -1)
[ -n "$ARCHIVE" ] || fail "no archive path"
compose exec -T app cat "$ARCHIVE" > "$WORK/backup.tar.gz"
tar -tzf "$WORK/backup.tar.gz" | sort | tr '\n' ' '
echo
tar -tzf "$WORK/backup.tar.gz" | has '^files/blobs/receipts/r-001.pdf$' || fail "file missing from archive"
encrypted_out=$(compose exec -T app crowhr backup --passphrase "correct horse battery staple" 2>&1) || fail "encrypted backup: $encrypted_out"
echo "$encrypted_out" | has 'tar.gz.age' || fail "encrypted backup not .age"

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
echo "$restore_out" | has "Restarting the app" || fail "restore did not restart the app"
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
echo "$again" | has -- "--force" || fail "no --force hint: $again"

step "Lost data volume: the app refuses to generate a new key; --secrets-only recovers"
compose stop app
compose rm -f app >/dev/null
docker volume rm "${PROJECT}_data" >/dev/null
compose up -d --no-build app
deadline=$((SECONDS + 60))
until compose logs --no-color app 2>/dev/null | has "does not match this database"; do
  [ "$SECONDS" -lt "$deadline" ] || fail "app did not refuse the missing key"
  sleep 2
done
compose logs --no-color app | has "crowhr restore --secrets-only" || fail "no --secrets-only hint"
compose stop app >/dev/null
compose run --rm --no-deps -T app crowhr restore --secrets-only /backups/restore-me.tar.gz
compose up -d --no-build app
wait_healthy 120

step "Behind reverse proxies, as on the docs page: ${CADDY_IMAGE}, ${NGINX_IMAGE} (in Docker and on the host), ${TRAEFIK_IMAGE}"
# The examples on apps/docs/src/content/docs/self-hosting/reverse-proxy.md are read from the page
# and used as written, except for what a test machine cannot do:
#  - TLS: there is no public DNS name, so no Let's Encrypt. Caddy issues from its internal CA
#    (`local_certs`), nginx gets a self-signed certificate at the docs' /etc/letsencrypt/live/ paths,
#    and Traefik, which has no `letsencrypt` resolver here, serves its default self-signed one.
#  - Ports: the proxies publish 443 (and 80) on 127.0.0.1:PROXY_PORT_BASE+n, and curl --connect-to
#    sends https://hr.example.sg there, so Host, SNI and Origin are what a browser would send.
# The client is curl on this host. Docker's port forwarding hands its connections to the proxy
# containers from the compose network's gateway address, so that is the real client IP here.
DOCS_PAGE="$ROOT/apps/docs/src/content/docs/self-hosting/reverse-proxy.md"
PROXY_HOST="hr.example.sg"
NET="${PROJECT}_default"
P="$WORK/proxies"
mkdir -p "$P/letsencrypt/live/$PROXY_HOST"
port() { echo $((PROXY_PORT_BASE + $1)); }
CADDY_TLS=$(port 1) CADDY_HTTP=$(port 2) NGINX_TLS=$(port 3) NGINX_HTTP=$(port 4)
NGINXH_TLS=$(port 5) NGINXH_HTTP=$(port 6) TRAEFIK_TLS=$(port 7)

# docs_block HEADING LANG: the first ```LANG code block in the docs section whose heading starts with HEADING.
docs_block() {
  local out
  out=$(awk -v h="$1" -v fence="\`\`\`$2" '
    index($0, h) == 1 { s = 1; next }
    s && /^## / { exit }
    s && !c && index($0, fence) == 1 { c = 1; next }
    c && /^```/ { exit }
    c { print }' "$DOCS_PAGE")
  [ -n "$out" ] || fail "no \`\`\`$2 block under '$1' in $DOCS_PAGE"
  printf '%s\n' "$out"
}
# replace FILE OLD NEW: literal text; fails when OLD is missing, i.e. the docs example changed.
replace() {
  local text
  text=$(cat "$1")
  [[ "$text" == *"$2"* ]] || fail "'$2' not found in $1 (taken from $DOCS_PAGE)"
  printf '%s\n' "${text//"$2"/"$3"}" >"$1"
}
set_env() { if grep -q "^$1=" "$WORK/.env"; then sed -i "s|^$1=.*|$1=$2|" "$WORK/.env"; else echo "$1=$2" >>"$WORK/.env"; fi; }
ip_of() { docker inspect -f "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}" "$1"; }
# via TLS_PORT CURL_ARGS…: curl https://hr.example.sg through the proxy on 127.0.0.1:TLS_PORT.
# -k: the test certificates are not publicly trusted.
via() {
  local p=$1
  shift
  curl -sS -k --connect-to "${PROXY_HOST}:443:127.0.0.1:${p}" "$@"
}
wait_proxy() {
  local deadline=$((SECONDS + 30))
  until via "$2" -f -o /dev/null "https://${PROXY_HOST}/api/health" 2>/dev/null; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      docker logs --tail=30 "${PROJECT}-$1" >&2 || true
      fail "$1 does not reach the app at https://${PROXY_HOST}/api/health${3:+ ($3)}"
    fi
    sleep 1
  done
}
SIGNIN_JSON="{\"org\":\"kampong-kopi\",\"email\":\"${OWNER_EMAIL}\",\"password\":\"${OWNER_PASSWORD}\"}"
# check_proxy NAME TLS_PORT CLIENT_IP PEER_IP TRUSTED: sign in through the proxy, then read what the
# app saw (Settings → System → This request) for a request whose client spoofs X-Forwarded-*.
check_proxy() {
  local name=$1 p=$2 client=$3 peer=$4 trusted=$5 scheme=http
  [ "$trusted" = false ] || scheme=https
  local jar="$WORK/cookies-$name.txt" hdrs="$WORK/headers-$name.txt" code audit_ip status got want
  code=$(via "$p" -o /dev/null -w '%{http_code}' -c "$jar" -D "$hdrs" -H 'content-type: application/json' \
    -H "origin: ${PUBLIC_URL}" -d "$SIGNIN_JSON" "${PUBLIC_URL}/api/v1/auth/sign-in")
  [ "$code" = 200 ] || fail "$name: sign-in through the proxy returned HTTP $code"
  has -iE '^set-cookie: __Host-crowhr_session=[^;]+;.*; ?secure' "$hdrs" ||
    fail "$name: the session cookie is not __Host- and Secure: $(grep -i '^set-cookie' "$hdrs")"
  audit_ip=$(compose exec -T db psql -U crowhr -d crowhr -tAc \
    "select ip from audit_events where action = 'auth.signed_in' order by seq desc limit 1")
  status=$(via "$p" -f -b "$jar" -H 'x-forwarded-for: 6.6.6.6' -H 'x-forwarded-host: evil.example' \
    -H 'x-forwarded-proto: http' "${PUBLIC_URL}/api/v1/system/status") || fail "$name: system status through the proxy"
  printf '  %-10s %s, sign-in audited from %s\n' "$name" "$(jq -c .request <<<"$status")" "$audit_ip"
  got=$(jq -cS .request <<<"$status")
  want=$(jq -cnS --arg c "$client" --arg p "$peer" --arg s "$scheme" --arg h "$PROXY_HOST" --argjson t "$trusted" \
    '{clientIp: $c, peerIp: $p, scheme: $s, host: $h, viaTrustedProxy: $t}')
  [ "$got" = "$want" ] || fail "$name: the app saw $got, expected $want"
  [ "$audit_ip" = "$client" ] || fail "$name: sign-in audited from $audit_ip, expected $client"
  [ "$(jq -r '"\(.secureCookies) \(.publicUrl)"' <<<"$status")" = "true ${PUBLIC_URL}" ] ||
    fail "$name: secureCookies/publicUrl in system status"
}
# http_redirects NAME HTTP_PORT: plain http:// is sent to https:// (Caddy by itself, nginx's port-80 block).
http_redirects() {
  local got
  got=$(curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' --connect-to "${PROXY_HOST}:80:127.0.0.1:$2" \
    "http://${PROXY_HOST}/sign-in?next=%2F")
  [[ "$got" =~ ^30[178]\ https://hr\.example\.sg/sign-in\?next=%2F$ ]] || fail "$1: http:// does not redirect to https:// ($got)"
}

# Caddy: the shipped deploy/caddy/Caddyfile.example (the docs show the same site block), plus a
# global block so the certificate comes from Caddy's internal CA instead of Let's Encrypt.
[ "$(docs_block "## Caddy" txt)" = "$(grep -v '^#' "$ROOT/deploy/caddy/Caddyfile.example")" ] ||
  fail "the Caddyfile on the docs page differs from deploy/caddy/Caddyfile.example"
{
  printf '{\n\tlocal_certs\n\tskip_install_trust\n}\n\n'
  cat "$ROOT/deploy/caddy/Caddyfile.example"
} >"$P/Caddyfile"

# nginx: the docs' config with the docs' certificate paths; a self-signed certificate is put there.
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=${PROXY_HOST}" -addext "subjectAltName=DNS:${PROXY_HOST}" \
  -keyout "$P/letsencrypt/live/$PROXY_HOST/privkey.pem" -out "$P/letsencrypt/live/$PROXY_HOST/fullchain.pem" 2>/dev/null
chmod 644 "$P/letsencrypt/live/$PROXY_HOST/"*.pem # a throwaway key, readable whatever uid Docker maps
# In Docker on the compose network: the docs' file as written.
docs_block "## nginx" nginx >"$P/nginx.conf"
# Installed on the host: the docs' edits for that case (upstream server 127.0.0.1:8080, no Docker
# DNS), run with host networking so it reaches the app's published port like a host nginx. The
# ports also change, because this machine's 443, 80 and 8080 are not ours to take.
cp "$P/nginx.conf" "$P/nginx-host.conf"
replace "$P/nginx-host.conf" "server app:8080 resolve;" "server 127.0.0.1:${HTTP_PORT};"
replace "$P/nginx-host.conf" "resolver 127.0.0.11 valid=10s;" ""
replace "$P/nginx-host.conf" "listen 443 ssl;" "listen 127.0.0.1:${NGINXH_TLS} ssl;"
replace "$P/nginx-host.conf" "listen 80;" "listen 127.0.0.1:${NGINXH_HTTP};"

# Traefik: the docs' labels, exactly, as docker-compose.override.yml for the app service.
docs_block "## Traefik" yaml >"$WORK/docker-compose.override.yml"

# .env as the docs say for all of them (BIND_ADDRESS=127.0.0.1 is already set).
PUBLIC_URL="https://${PROXY_HOST}"
set_env PUBLIC_URL "$PUBLIC_URL"
set_env TRUSTED_PROXIES private
compose up -d --no-build app
wait_healthy 120

docker run -d --name "${PROJECT}-caddy" --network "$NET" -p "127.0.0.1:${CADDY_TLS}:443" -p "127.0.0.1:${CADDY_HTTP}:80" \
  -v "$P/Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMAGE" >/dev/null
docker run -d --name "${PROJECT}-nginx" --network "$NET" -p "127.0.0.1:${NGINX_TLS}:443" -p "127.0.0.1:${NGINX_HTTP}:80" \
  -v "$P/nginx.conf:/etc/nginx/conf.d/default.conf:ro" -v "$P/letsencrypt:/etc/letsencrypt:ro" "$NGINX_IMAGE" >/dev/null
docker run -d --name "${PROJECT}-nginx-host" --network host \
  -v "$P/nginx-host.conf:/etc/nginx/conf.d/default.conf:ro" -v "$P/letsencrypt:/etc/letsencrypt:ro" "$NGINX_IMAGE" >/dev/null
# Traefik's Docker provider, which the labels are for. exposedByDefault=false: only containers
# labelled traefik.enable=true, as the docs' labels are. The constraint is for the test machine:
# this Traefik ignores every container outside this compose project.
docker_sock="${DOCKER_HOST:-$(docker context inspect -f '{{.Endpoints.docker.Host}}')}"
docker_sock="${docker_sock#unix://}"
[ -S "$docker_sock" ] || fail "Traefik's Docker provider needs a local Docker socket, got '$docker_sock'"
docker run -d --name "${PROJECT}-traefik" --network "$NET" -p "127.0.0.1:${TRAEFIK_TLS}:443" \
  -v "$docker_sock:/var/run/docker.sock:ro" "$TRAEFIK_IMAGE" \
  --global.checkNewVersion=false --global.sendAnonymousUsage=false \
  --entrypoints.websecure.address=:443 \
  --providers.docker.exposedByDefault=false \
  "--providers.docker.constraints=Label(\`com.docker.compose.project\`,\`${PROJECT}\`)" >/dev/null

for proxy in "caddy $CADDY_TLS" "nginx $NGINX_TLS" "nginx-host $NGINXH_TLS" "traefik $TRAEFIK_TLS"; do
  wait_proxy $proxy
done
echo "  versions: $(docker exec "${PROJECT}-caddy" caddy version | cut -d' ' -f1), $(docker exec "${PROJECT}-nginx" nginx -v 2>&1),"\
  "traefik $(docker exec "${PROJECT}-traefik" traefik version | awk '/^Version:/ {print $2}')"
for n in nginx nginx-host; do
  ! docker logs "${PROJECT}-$n" 2>&1 | has -E '\[(warn|error|crit|alert|emerg)\]' ||
    fail "$n warns about the docs' config: $(docker logs "${PROJECT}-$n" 2>&1 | grep -E '\[(warn|error|crit|alert|emerg)\]')"
done
http_redirects caddy "$CADDY_HTTP"
http_redirects nginx "$NGINX_HTTP"
http_redirects nginx-host "$NGINXH_HTTP"
# The docs quote this line: without a `letsencrypt` resolver Traefik falls back to its own certificate.
docker logs "${PROJECT}-traefik" 2>&1 | has "Router uses a nonexistent certificate resolver" ||
  fail "Traefik did not log the missing-resolver error the docs describe"

GATEWAY=$(docker network inspect "$NET" | jq -r '[.[0].IPAM.Config[].Gateway // empty | select(test("^[0-9.]+$"))][0] // empty')
[ -n "$GATEWAY" ] || fail "no IPv4 gateway on $NET"
echo "TRUSTED_PROXIES=private. Client: this host, which the containers see as $GATEWAY; the host nginx sees 127.0.0.1."
check_proxy caddy "$CADDY_TLS" "$GATEWAY" "$(ip_of "${PROJECT}-caddy")" true
check_proxy nginx "$NGINX_TLS" "$GATEWAY" "$(ip_of "${PROJECT}-nginx")" true
check_proxy nginx-host "$NGINXH_TLS" 127.0.0.1 "$GATEWAY" true
check_proxy traefik "$TRAEFIK_TLS" "$GATEWAY" "$(ip_of "${PROJECT}-traefik")" true

# Recreating the app container, as `docker compose up -d` does on an upgrade, can give it a new
# address: Docker hands out the lowest free one, so it moves when another container took the old
# one first. Make it move (a placeholder holds the old address); the proxies must follow.
app_ip=$(ip_of "$(compose ps -q app)")
set_env TRUSTED_PROXIES ""
compose rm -sf app >/dev/null
docker run -d --name "${PROJECT}-placeholder" --network "$NET" --entrypoint sleep "$NGINX_IMAGE" 3600 >/dev/null
compose up -d --no-build app
wait_healthy 120
new_app_ip=$(ip_of "$(compose ps -q app)")
[ "$new_app_ip" != "$app_ip" ] || fail "the recreated app kept $app_ip, so following a new address was not tested"
echo "TRUSTED_PROXIES empty. The app container was recreated and moved: $app_ip → $new_app_ip"
for proxy in "caddy $CADDY_TLS" "nginx $NGINX_TLS" "nginx-host $NGINXH_TLS" "traefik $TRAEFIK_TLS"; do
  wait_proxy $proxy "after the app container was recreated"
done
check_proxy caddy "$CADDY_TLS" "$(ip_of "${PROJECT}-caddy")" "$(ip_of "${PROJECT}-caddy")" false
check_proxy nginx "$NGINX_TLS" "$(ip_of "${PROJECT}-nginx")" "$(ip_of "${PROJECT}-nginx")" false
check_proxy nginx-host "$NGINXH_TLS" "$GATEWAY" "$GATEWAY" false
check_proxy traefik "$TRAEFIK_TLS" "$(ip_of "${PROJECT}-traefik")" "$(ip_of "${PROJECT}-traefik")" false
for peer in "$(ip_of "${PROJECT}-caddy")" "$(ip_of "${PROJECT}-nginx")" "$GATEWAY" "$(ip_of "${PROJECT}-traefik")"; do
  compose logs --no-color app | has -F "Ignoring X-Forwarded-* headers from ${peer} because" ||
    fail "no untrusted-proxy hint for ${peer} in the app logs"
done

step "All self-host checks passed"
