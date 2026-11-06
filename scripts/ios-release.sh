#!/usr/bin/env bash
# Crow HR iOS release gate (add-mobile-apps task 4.2).
#
#   scripts/ios-release.sh internal   --approval <record> [--dry-run]   TestFlight internal testing only
#   scripts/ios-release.sh production --approval <record> [--dry-run]   App Store submission
#
# Every external step needs Daniel's written approval (AGENTS.md hard rule 1). An approval record
# is a file with these lines:
#   approved-by: Daniel
#   scope: testflight-internal | production
#   version: <MARKETING_VERSION from apps/ios/project.yml>
#   date: YYYY-MM-DD
# `production` refuses unless the record's scope is `production`; `internal` accepts either scope.
# Uploads never target external TestFlight groups.
#
# NOT IMPLEMENTED: the real archive, cloud signing and upload. The bundle id crowtech.crowhr is
# not registered yet (needs Daniel), and signing follows the Gremia cloud-signing workflow on s5.
# Without --dry-run the script stops after the approval checks with exit code 3.
set -euo pipefail
cd "$(dirname "$0")/.."

refuse() { echo "REFUSED: $1" >&2; exit 2; }

COMMAND="${1:-}"
shift || true
APPROVAL=""
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --approval) APPROVAL="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) refuse "unknown option $1" ;;
  esac
done

case "$COMMAND" in
  internal) WANT_SCOPE="testflight-internal|production" ;;
  production) WANT_SCOPE="production" ;;
  *) refuse "say 'internal' (TestFlight internal testing) or 'production'." ;;
esac

VERSION=$(grep -E "^\s*MARKETING_VERSION:" apps/ios/project.yml | head -1 | sed -E "s/.*'([^']+)'.*/\1/")
[[ -n "$APPROVAL" ]] || refuse "no --approval record. Releases need Daniel's written approval for version $VERSION."
[[ -f "$APPROVAL" ]] || refuse "approval record $APPROVAL does not exist."
field() { grep -E "^$1:" "$APPROVAL" | head -1 | sed -E "s/^$1:[[:space:]]*//" | tr -d '\r'; }
[[ "$(field approved-by)" == "Daniel" ]] || refuse "the approval record is not signed 'approved-by: Daniel'."
SCOPE="$(field scope)"
[[ "$SCOPE" =~ ^($WANT_SCOPE)$ ]] || refuse "the approval record's scope is '${SCOPE:-missing}', which does not allow '$COMMAND'."
[[ "$(field version)" == "$VERSION" ]] || refuse "the approval record is for version '$(field version)', not $VERSION."
[[ "$(field date)" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || refuse "the approval record has no date (YYYY-MM-DD)."

echo "Approval OK: $COMMAND of Crow HR iOS $VERSION ($APPROVAL)."
PLAN=(
  "sync apps/ios to s5 (scripts/ios-sync.sh)"
  "run unit and UI tests on s5 (scripts/ios-mac-test.sh, scripts/ios-ui-test.sh)"
  "archive Release with a fresh build number on s5"
  "cloud-sign and export the IPA (Gremia export workflow), verify bundle id crowtech.crowhr"
)
if [[ "$COMMAND" == internal ]]; then
  PLAN+=("upload to App Store Connect and add the build to the INTERNAL TestFlight group only")
else
  PLAN+=("submit the approved TestFlight build for App Store review (privacy label: Data Not Collected)")
fi
for step in "${PLAN[@]}"; do echo "  - $step"; done

if [[ $DRY_RUN -eq 1 ]]; then
  echo "DRY RUN: nothing was built, signed or uploaded."
  exit 0
fi
echo "NOT IMPLEMENTED: real archive/sign/upload (bundle id not registered yet; see header)." >&2
exit 3
