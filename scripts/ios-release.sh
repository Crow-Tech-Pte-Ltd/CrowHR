#!/usr/bin/env bash
# Crow HR iOS release gate (add-mobile-apps task 4.2).
#
#   CROWHR_BUILD_NUMBER=<n> scripts/ios-release.sh internal --approval <record> [--dry-run]     TestFlight internal only
#   CROWHR_BUILD_NUMBER=<n> scripts/ios-release.sh production --approval <record> [--dry-run]   App Store build
#
# Every external step needs Daniel's written approval (AGENTS.md hard rule 1). An approval record
# is a file with these lines:
#   approved-by: Daniel
#   scope: testflight-internal | production
#   version: <MARKETING_VERSION from apps/ios/project.yml>
#   build: <CROWHR_BUILD_NUMBER>          (required for production)
#   date: YYYY-MM-DD
# `production` refuses unless the record's scope is `production` and its build is this build;
# `internal` accepts either scope. Uploads never target external TestFlight groups.
#
# Both commands run, all on the release Mac over SSH: sync, unit tests and the user-flow UI tests,
# an unsigned Release archive (scripts/ios-archive-on-mac.sh), an Apple cloud-signed export with
# IPA checks (scripts/ios-export-on-mac.sh, scripts/ios-verify-ipa.py), then
# `altool --validate-app` and `altool --upload-app`. `internal` exports with "TestFlight internal
# testing only" set, so that build can never reach external testers or App Review. `production`
# exports for App Store distribution (the flag absent, which ios-verify-ipa.py checks) and uploads
# the build to App Store Connect. It does not submit anything for review: attaching the build to
# the App Store version and submitting it are done in App Store Connect after the listing is
# complete. CROWHR_BUILD_NUMBER must be numeric and higher than every build in
# apps/ios/store/uploaded-builds.txt; a successful upload is appended there, and the IPA receipt
# is saved as apps/ios/store/build<n>-verification.json.
#
# A real run needs, in the environment here: CROWHR_MAC_HOST (SSH host of the release Mac),
# CROWHR_SIM_UDID (the Crow HR simulator on it), APPLE_KEY_ID and APPLE_ISSUER_ID (the App Store
# Connect API key) and APPLE_SIGNING_SECRET_DIR (the directory on the Mac with AuthKey_<key id>.p8
# and the build keychain; see scripts/ios-export-on-mac.sh). Optional: CROWHR_MAC_DIR (checkout on
# the Mac, default ~/Developer/crowhr-ios) and DEVELOPER_DIR (Xcode on the Mac, default
# ~/Applications/Xcode-27.1.app/Contents/Developer).
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
if [[ "$COMMAND" == production ]]; then
  [[ "$(field build)" =~ ^[1-9][0-9]*$ ]] || refuse "the production approval record names no build ('build: <n>')."
fi

# Build numbers: numeric, and never one App Store Connect has already received.
LEDGER="${CROWHR_UPLOADED_BUILDS:-apps/ios/store/uploaded-builds.txt}"
BUILD="${CROWHR_BUILD_NUMBER:-}"
if [[ -z "$BUILD" && $DRY_RUN -eq 0 ]]; then
  refuse "set CROWHR_BUILD_NUMBER to a fresh numeric build number (higher than any in $LEDGER)."
fi
if [[ -n "$BUILD" ]]; then
  [[ "$BUILD" =~ ^[1-9][0-9]*$ ]] || refuse "CROWHR_BUILD_NUMBER must be a positive whole number, not '$BUILD'."
  HIGHEST=$( (grep -E '^[0-9]+' "$LEDGER" 2>/dev/null || true) | awk '{print $1}' | sort -n | tail -1)
  if [[ -n "$HIGHEST" && "$BUILD" -le "$HIGHEST" ]]; then
    refuse "build $BUILD is not higher than build $HIGHEST, already uploaded (see $LEDGER)."
  fi
  if [[ "$COMMAND" == production && "$(field build)" != "$BUILD" ]]; then
    refuse "the production approval record is for build $(field build), not build $BUILD."
  fi
fi

echo "Approval OK: $COMMAND of Crow HR iOS $VERSION${BUILD:+ ($BUILD)} ($APPROVAL)."
PLAN=(
  "sync apps/ios to the release Mac (scripts/ios-sync.sh)"
  "run unit tests and the user-flow UI tests on the Mac (scripts/ios-mac-test.sh, scripts/ios-ui-test.sh)"
)
PLAN+=("archive Release unsigned with build ${BUILD:-<CROWHR_BUILD_NUMBER>} on the Mac (scripts/ios-archive-on-mac.sh)")
if [[ "$COMMAND" == internal ]]; then
  INTERNAL_ONLY=1
  SCOPE_LABEL=internal
  PLAN+=(
    "cloud-sign and export an internal-only IPA, verify bundle id crowtech.crowhr, team and entitlements (scripts/ios-export-on-mac.sh)"
    "validate, then upload to App Store Connect for the INTERNAL TestFlight group only (altool)"
  )
else
  INTERNAL_ONLY=0
  SCOPE_LABEL=app-store
  PLAN+=(
    "cloud-sign and export for App Store distribution (not internal-only), verify bundle id crowtech.crowhr, team, entitlements and export compliance (scripts/ios-export-on-mac.sh)"
    "validate, then upload build ${BUILD:-<CROWHR_BUILD_NUMBER>} to App Store Connect (altool). Not submitted for App Review: that is done in App Store Connect"
  )
fi
for step in "${PLAN[@]}"; do echo "  - $step"; done

if [[ $DRY_RUN -eq 1 ]]; then
  echo "DRY RUN: nothing was built, signed or uploaded."
  exit 0
fi

# ---- real run, approval checked above ----
SSH=(ssh -F "$HOME/.ssh/config")
HOST="${CROWHR_MAC_HOST:-}"
REMOTE="${CROWHR_MAC_DIR:-Developer/crowhr-ios}"
UDID="${CROWHR_SIM_UDID:-}"
KEY_ID="${APPLE_KEY_ID:-}"
ISSUER_ID="${APPLE_ISSUER_ID:-}"
SECRET_DIR="${APPLE_SIGNING_SECRET_DIR:-}"
[[ -n "$HOST" ]] || refuse "set CROWHR_MAC_HOST to the SSH host of the release Mac."
[[ -n "$UDID" ]] || refuse "set CROWHR_SIM_UDID to the Crow HR simulator's UDID on the Mac."
[[ "$KEY_ID" =~ ^[A-Z0-9]{10}$ ]] || refuse "set APPLE_KEY_ID to the App Store Connect API key ID."
[[ "$ISSUER_ID" =~ ^[a-fA-F0-9-]{36}$ ]] || refuse "set APPLE_ISSUER_ID to the App Store Connect API issuer ID."
[[ -n "$SECRET_DIR" ]] || refuse "set APPLE_SIGNING_SECRET_DIR to the directory on the Mac with AuthKey_$KEY_ID.p8 and the build keychain."
ARCHIVE="artifacts/CrowHR-build$BUILD.xcarchive"
EXPORT="artifacts/CrowHR-build$BUILD-export"
MAC_ENV="export DEVELOPER_DIR=\${DEVELOPER_DIR:-\$HOME/Applications/Xcode-27.1.app/Contents/Developer}"
MAC_ENV+=" APPLE_KEY_ID=$KEY_ID APPLE_ISSUER_ID=$ISSUER_ID APPLE_SIGNING_SECRET_DIR=$(printf %q "$SECRET_DIR")"
on_mac() { "${SSH[@]}" "$HOST" "cd $REMOTE && $MAC_ENV && $1"; }
altool_args="-f $EXPORT/CrowHR.ipa -t ios --apiKey $KEY_ID --apiIssuer $ISSUER_ID --p8-file-path \"\$APPLE_SIGNING_SECRET_DIR/AuthKey_$KEY_ID.p8\""

scripts/ios-sync.sh
on_mac "CROWHR_SIM_UDID=$UDID scripts/ios-mac-test.sh release-unit -only-testing:CrowHRTests"
# The release gate runs the user-flow UI tests. QAScreenshotsUITests (Xcode's accessibility audit
# on every screen, four tours, about 15 minutes; clean since the screens stopped using SwiftUI
# List/Form, add-mobile-apps task 3.7, docs/limitations.md) is not part of the gate: run it before
# a release with CROWHR_UI_ONLY=CrowHRUITests/QAScreenshotsUITests scripts/ios-ui-test.sh. The
# manual VoiceOver and Dynamic Type pass on a real device is separate.
CROWHR_SIM_UDID="$UDID" CROWHR_UI_ONLY=CrowHRUITests/EssJourneyUITests scripts/ios-ui-test.sh
on_mac "CROWHR_BUILD_NUMBER=$BUILD CROWHR_ARCHIVE_PATH=\$PWD/$ARCHIVE scripts/ios-archive-on-mac.sh"
on_mac "CROWHR_BUILD_NUMBER=$BUILD CROWHR_INTERNAL_ONLY=$INTERNAL_ONLY scripts/ios-export-on-mac.sh $ARCHIVE $EXPORT"
on_mac "xcrun altool --validate-app $altool_args"
UPLOAD_LOG="$(mktemp)"
on_mac "xcrun altool --upload-app $altool_args" 2>&1 | tee "$UPLOAD_LOG"
UPLOADED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "$BUILD $VERSION $UPLOADED_AT $SCOPE_LABEL" >> "$LEDGER"
# The IPA receipt (public facts only), marked uploaded with the delivery id altool printed.
DELIVERY="$(grep -oiE 'delivery uuid:? *[0-9a-f-]{36}' "$UPLOAD_LOG" | grep -oiE '[0-9a-f-]{36}' | tail -1 || true)"
rm -f "$UPLOAD_LOG"
RECEIPT="apps/ios/store/build$BUILD-verification.json"
"${SSH[@]}" "$HOST" "cat $REMOTE/$EXPORT/verification.json" | python3 -c '
import json, sys
receipt = json.load(sys.stdin)
receipt.update(uploaded=True, uploadedAt=sys.argv[1], distribution=sys.argv[2], approval=sys.argv[3])
if sys.argv[4]:
    receipt["deliveryUuid"] = sys.argv[4]
print(json.dumps(receipt, indent=2))' "$UPLOADED_AT" "$SCOPE_LABEL" "$APPROVAL" "$DELIVERY" > "$RECEIPT"
echo "Uploaded build $BUILD ($SCOPE_LABEL). Recorded in $LEDGER and $RECEIPT. App Store Connect"
if [[ "$COMMAND" == internal ]]; then
  echo "processes it next; then add it to the internal TestFlight group."
else
  echo "processes it next; then attach it to the $VERSION App Store version. Nothing was submitted for review."
fi
