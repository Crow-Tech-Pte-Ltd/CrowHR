#!/usr/bin/env bash
# Render the hosted overlay without starting containers or reading an installation's .env.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
cp "$root/docker-compose.yml" "$root/deploy/hosted/compose.yml" "$fixture/"
cat > "$fixture/.env" <<'EOF'
DATABASE_URL=postgres://example.invalid/shared
DATABASE_PORT=6464
FILE_STORAGE_DIR=/tmp/shared-files
SECRET_KEY_FILE=/tmp/shared-key
BACKUP_DIR=/tmp/shared-backups
EOF

render() {
  docker compose --project-directory "$fixture" -p "$1" --env-file "$fixture/.env" \
    -f "$fixture/docker-compose.yml" -f "$fixture/compose.yml" config --format json
}

export CROWHR_IMAGE_SHA256="$(printf '%064d' 0)"
export BIND_ADDRESS=0.0.0.0
export HTTP_PORT=28080
for project in crowhr-pilot-one crowhr-pilot-two; do
  render "$project" | jq --exit-status --arg project "$project" --arg digest "$CROWHR_IMAGE_SHA256" '
    .name == $project and
    .services.app.image == ("ghcr.io/crow-tech-pte-ltd/crowhr@sha256:" + $digest) and
    .services.init.image == .services.app.image and
    .services.app.environment.CROWHR_HOSTED == "true" and
    .services.app.environment.DATABASE_URL == "" and
    .services.app.environment.DATABASE_HOST == "db" and
    .services.app.environment.DATABASE_PORT == "5432" and
    .services.app.environment.DATABASE_PASSWORD == "" and
    .services.app.environment.FILE_STORAGE_DIR == "/data/files" and
    .services.app.environment.SECRET_KEY_FILE == "/data/secrets/crowhr.key" and
    .services.app.environment.CROWHR_SECRET_KEY == "" and
    .services.app.environment.BACKUP_DIR == "/backups" and
    (.services.app.ports | length) == 1 and
    .services.app.ports[0].host_ip == "127.0.0.1" and
    .services.app.ports[0].published == "28080" and
    .services.app.ports[0].target == 8080 and
    (.services.db.ports | length) == 0 and
    .networks.default.name == ($project + "_default") and
    ([.volumes[] | .name] | sort) == (["backups", "data", "db", "secrets"] | map($project + "_" + .))
  '
done

unset CROWHR_IMAGE_SHA256
if render crowhr-pilot-one > "$fixture/unpinned.out" 2>&1; then
  echo "Hosted configuration accepted an unpinned image" >&2
  exit 1
fi
[[ $(<"$fixture/unpinned.out") == *CROWHR_IMAGE_SHA256* ]]
