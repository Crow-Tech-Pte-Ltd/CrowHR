#!/usr/bin/env bash
# Runs the seeded Crow HR server for the iOS UI tests, on Linux, bound to 127.0.0.1 only.
# Same setup as playwright.config.ts (e2e seed, PGlite, throwaway key) plus scripts/ios-ui-seed.ts.
# Build the web app first (bun run --cwd apps/web build): the server serves the sign-in page.
#
#   scripts/ios-ui-server.sh <state-dir> [port]     (foreground; stop with Ctrl-C / kill)
set -euo pipefail
cd "$(dirname "$0")/.."
STATE="${1:?state directory, e.g. a fresh temp dir}"
PORT="${2:-3190}"
mkdir -p "$STATE"
export DATABASE_URL="pglite:$STATE/db"
export HOST=127.0.0.1
export PORT
export DATA_DIR="$STATE/data"
export FILE_STORAGE_DIR="$STATE/files"
export LOG_LEVEL=warn
export PUBLIC_URL="http://127.0.0.1:$PORT"
# The fixed throwaway e2e key (playwright.config.ts); never a real secret.
export CROWHR_SECRET_KEY="ZTJlLW9ubHktdGhyb3dhd2F5LWtleS0zMi1ieXRlcyE"
node e2e/seed.ts
node scripts/ios-ui-seed.ts
exec node apps/server/src/main.ts
