#!/usr/bin/env bash
# Local seeded Crow HR server for the Android UI tests (add-mobile-apps task 2.5): the same
# fictional e2e seed as Playwright (e2e/seed.ts), on PGlite in a throwaway directory, bound to
# 127.0.0.1 only. The emulator reaches it at http://10.0.2.2:$PORT. Nothing is exposed publicly.
#   scripts/android-test-server.sh            start in the foreground (Ctrl-C stops it)
#   CROWHR_TEST_PORT=3197 scripts/android-test-server.sh
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
port="${CROWHR_TEST_PORT:-3197}"
work="${CROWHR_TEST_DIR:-$(mktemp -d -t crowhr-android-server-XXXXXX)}"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
cd "$repo_dir"
export DATABASE_URL="pglite:$work/db"
export HOST=127.0.0.1
export PORT="$port"
export DATA_DIR="$work/data"
export FILE_STORAGE_DIR="$work/files"
export LOG_LEVEL=warn
export PUBLIC_URL="http://10.0.2.2:$port"
# Fixed throwaway key for local tests only (same as playwright.config.ts).
export CROWHR_SECRET_KEY="ZTJlLW9ubHktdGhyb3dhd2F5LWtleS0zMi1ieXRlcyE"
node e2e/seed.ts
exec node apps/server/src/main.ts
