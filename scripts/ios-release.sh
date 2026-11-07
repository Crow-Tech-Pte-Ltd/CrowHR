#!/usr/bin/env bash
# Crow HR iOS release gate (add-mobile-apps task 4.2).
#
#   CROWHR_BUILD_NUMBER=<n> scripts/ios-release.sh internal --approval <record> [--dry-run]   TestFlight internal only
#   scripts/ios-release.sh production --approval <record> [--dry-run]                       App Store submission
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
# `internal` (real run), all on s5 over SSH: sync, unit + UI tests, unsigned Release archive
# (scripts/ios-archive-on-mac.sh), Apple cloud-signed export marked "TestFlight internal testing
# only" plus IPA checks (scripts/ios-export-on-mac.sh, scripts/ios-verify-ipa.py), then
# `altool --validate-app` and `altool --upload-app`. CROWHR_BUILD_NUMBER must be numeric and higher
# than every build in apps/ios/store/uploaded-builds.txt; a successful upload is appended there.
# Archive and export were run and verified for build 1 on 7 Nov 2026 (not uploaded). The upload
# itself has never run: it needs the App Store Connect app record (owner step) and an approval.
# Adding the build to the internal TestFlight group is done in App Store Connect, not here.
#
# NOT IMPLEMENTED: `production` (App Store submission) stops after the approval checks with exit 3.
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

# Build numbers: numeric, and never one App Store Connect has already received.
LEDGER="${CROWHR_UPLOADED_BUILDS:-apps/ios/store/uploaded-builds.txt}"
BUILD="${CROWHR_BUILD_NUMBER:-}"
if [[ "$COMMAND" == internal ]]; then
  if [[ -z "$BUILD" && $DRY_RUN -eq 0 ]]; then
    refuse "set CROWHR_BUILD_NUMBER to a fresh numeric build number (higher than any in $LEDGER)."
  fi
  if [[ -n "$BUILD" ]]; then
    [[ "$BUILD" =~ ^[1-9][0-9]*$ ]] || refuse "CROWHR_BUILD_NUMBER must be a positive whole number, not '$BUILD'."
    HIGHEST=$( (grep -E '^[0-9]+' "$LEDGER" 2>/dev/null || true) | awk '{print $1}' | sort -n | tail -1)
    if [[ -n "$HIGHEST" && "$BUILD" -le "$HIGHEST" ]]; then
      refuse "build $BUILD is not higher than build $HIGHEST, already uploaded (see $LEDGER)."
    fi
  fi
fi

echo "Approval OK: $COMMAND of Crow HR iOS $VERSION${BUILD:+ ($BUILD)} ($APPROVAL)."
PLAN=(
  "sync apps/ios to s5 (scripts/ios-sync.sh)"
  "run unit tests and the user-flow UI tests on s5 (scripts/ios-mac-test.sh, scripts/ios-ui-test.sh)"
)
if [[ "$COMMAND" == internal ]]; then
  PLAN+=(
    "archive Release unsigned with build ${BUILD:-<CROWHR_BUILD_NUMBER>} on s5 (scripts/ios-archive-on-mac.sh)"
    "cloud-sign and export an internal-only IPA, verify bundle id crowtech.crowhr, team and entitlements (scripts/ios-export-on-mac.sh)"
    "validate, then upload to App Store Connect for the INTERNAL TestFlight group only (altool)"
  )
else
  PLAN+=("submit the approved TestFlight build for App Store review (privacy label: Data Not Collected)")
fi
for step in "${PLAN[@]}"; do echo "  - $step"; done

if [[ $DRY_RUN -eq 1 ]]; then
  echo "DRY RUN: nothing was built, signed or uploaded."
  exit 0
fi
if [[ "$COMMAND" == production ]]; then
  echo "NOT IMPLEMENTED: App Store submission (see header). Nothing was built or submitted." >&2
  exit 3
fi

# ---- internal: real run, approval checked above ----
SSH=(ssh -F "$HOME/.ssh/config")
HOST="${CROWHR_MAC_HOST:-s5}"
REMOTE="${CROWHR_MAC_DIR:-Developer/crowhr-ios}"
UDID="${CROWHR_SIM_UDID:-D03C6B39-F769-4E90-804B-7B1F49DEAD15}"
KEY_ID="42R4538ML4"
ISSUER_ID="de0b1507-decc-4c9e-a7f9-0df008735b76"
ARCHIVE="artifacts/CrowHR-build$BUILD.xcarchive"
EXPORT="artifacts/CrowHR-build$BUILD-export"
on_mac() { "${SSH[@]}" "$HOST" "cd $REMOTE && export DEVELOPER_DIR=\$HOME/Applications/Xcode-27.1.app/Contents/Developer && $1"; }
altool_args="-f $EXPORT/CrowHR.ipa -t ios --apiKey $KEY_ID --apiIssuer $ISSUER_ID --p8-file-path \$HOME/Documents/crow-reader-secrets/AuthKey_$KEY_ID.p8"

scripts/ios-sync.sh
on_mac "CROWHR_SIM_UDID=$UDID scripts/ios-mac-test.sh release-unit -only-testing:CrowHRTests"
# The release gate runs the user-flow UI tests. QAScreenshotsUITests is left out: its Xcode
# accessibility audit reports a different Dynamic Type item on each run (add-mobile-apps task 3.7,
# docs/limitations.md) and needs a manual pass on a real device, which a TestFlight build allows.
CROWHR_SIM_UDID="$UDID" CROWHR_UI_ONLY=CrowHRUITests/EssJourneyUITests scripts/ios-ui-test.sh
on_mac "CROWHR_BUILD_NUMBER=$BUILD CROWHR_ARCHIVE_PATH=\$PWD/$ARCHIVE scripts/ios-archive-on-mac.sh"
on_mac "CROWHR_BUILD_NUMBER=$BUILD CROWHR_INTERNAL_ONLY=1 scripts/ios-export-on-mac.sh $ARCHIVE $EXPORT"
on_mac "xcrun altool --validate-app $altool_args"
on_mac "xcrun altool --upload-app $altool_args"
echo "$BUILD $VERSION $(date -u +%Y-%m-%dT%H:%M:%SZ) internal" >> "$LEDGER"
"${SSH[@]}" "$HOST" "cat $REMOTE/$EXPORT/verification.json" > "apps/ios/store/build$BUILD-verification.json"
echo "Uploaded build $BUILD (internal-only). Recorded in $LEDGER. Upload is not processing: check"
echo "App Store Connect until the build is processed, then add it to the internal TestFlight group."
