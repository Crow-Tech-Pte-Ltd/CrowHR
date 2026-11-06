#!/usr/bin/env bash
# Dry-run tests of scripts/ios-release.sh: every path without Daniel's approval is refused, and
# nothing is ever built or uploaded. Usage: scripts/ios-release.test.sh
set -uo pipefail
cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
VERSION=$(grep -E "^\s*MARKETING_VERSION:" apps/ios/project.yml | head -1 | sed -E "s/.*'([^']+)'.*/\1/")
PASS=0
FAIL=0

record() { printf '%s\n' "$@" > "$TMP/$1.rec.tmp"; mv "$TMP/$1.rec.tmp" "$TMP/rec"; }
write() { local name="$1"; shift; printf '%s\n' "$@" > "$TMP/$name"; echo "$TMP/$name"; }

expect() { # expect <exit code> <output pattern> <description> -- args...
  local code="$1" pattern="$2" what="$3"; shift 4
  local out; out=$(scripts/ios-release.sh "$@" 2>&1); local got=$?
  if [[ $got -eq $code && "$out" =~ $pattern ]]; then PASS=$((PASS + 1)); echo "ok   $what"
  else FAIL=$((FAIL + 1)); echo "FAIL $what (exit $got): $out"; fi
}

INTERNAL=$(write internal.txt "approved-by: Daniel" "scope: testflight-internal" "version: $VERSION" "date: 2026-11-07")
PROD=$(write prod.txt "approved-by: Daniel" "scope: production" "version: $VERSION" "date: 2026-11-07")
UNSIGNED=$(write unsigned.txt "approved-by: someone" "scope: production" "version: $VERSION" "date: 2026-11-07")
OLD=$(write old.txt "approved-by: Daniel" "scope: production" "version: 0.0.9" "date: 2026-11-07")
NODATE=$(write nodate.txt "approved-by: Daniel" "scope: production" "version: $VERSION")

expect 2 "REFUSED: no --approval" "production without an approval flag is refused" -- production --dry-run
expect 2 "REFUSED: no --approval" "internal upload without an approval flag is refused" -- internal --dry-run
expect 2 "does not exist" "a missing approval record is refused" -- production --approval "$TMP/nope.txt" --dry-run
expect 2 "not signed" "an approval not signed by Daniel is refused" -- production --approval "$UNSIGNED" --dry-run
expect 2 "scope is 'testflight-internal'" "an internal-only approval cannot release to production" -- production --approval "$INTERNAL" --dry-run
expect 2 "not $VERSION" "an approval for another version is refused" -- production --approval "$OLD" --dry-run
expect 2 "no date" "an undated approval is refused" -- production --approval "$NODATE" --dry-run
expect 2 "say 'internal'" "an unknown command is refused" -- publish --dry-run
expect 0 "INTERNAL TestFlight group only.*DRY RUN" "internal dry run plans an internal-only upload" -- internal --approval "$INTERNAL" --dry-run
expect 0 "App Store review.*DRY RUN" "production dry run with a production approval only plans" -- production --approval "$PROD" --dry-run
expect 3 "NOT IMPLEMENTED" "a real run stops before building or uploading" -- internal --approval "$INTERNAL"

echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
