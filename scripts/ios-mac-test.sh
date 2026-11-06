#!/usr/bin/env bash
# Runs ON THE MAC (s5) from the synced checkout: generates the project, builds for testing with the
# pinned Xcode, runs the tests on Crow HR's own simulator, and always shuts that simulator down
# (never `simctl shutdown all`: the Mac is shared).
#
#   CROWHR_SIM_UDID=<udid> scripts/ios-mac-test.sh <label> [xcodebuild test args, e.g. -only-testing:CrowHRTests]
#
# Env: DEVELOPER_DIR (default Xcode 27.1), CROWHR_TEST_DRIVER_DIR (optional older Xcode used only to
# run tests if CoreSimulator belongs to another Xcode), TEST_RUNNER_* (passed to the test runner).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/ios"
export PATH="/opt/homebrew/bin:$PATH"
export DEVELOPER_DIR="${DEVELOPER_DIR:-$HOME/Applications/Xcode-27.1.app/Contents/Developer}"
UDID="${CROWHR_SIM_UDID:?Set CROWHR_SIM_UDID to the CrowHR simulator UDID}"
LABEL="${1:-all}"
shift || true
DERIVED="${CROWHR_DERIVED:-$ROOT/DerivedData}"
mkdir -p "$ROOT/results"
RESULT="$ROOT/results/$(date +%Y%m%d-%H%M%S)-$LABEL.xcresult"

cleanup() {
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

xcodegen generate --quiet
xcodebuild -project CrowHR.xcodeproj -scheme CrowHR -sdk iphonesimulator \
  -destination "id=$UDID" -derivedDataPath "$DERIVED" -jobs 4 -quiet build-for-testing

if [[ -n "${CROWHR_TEST_DRIVER_DIR:-}" ]]; then export DEVELOPER_DIR="$CROWHR_TEST_DRIVER_DIR"; fi
set +e
xcodebuild test-without-building -project CrowHR.xcodeproj -scheme CrowHR \
  -destination "id=$UDID" -derivedDataPath "$DERIVED" -resultBundlePath "$RESULT" \
  -parallel-testing-enabled NO -collect-test-diagnostics never "$@"
STATUS=$?
set -e
echo "RESULT_BUNDLE=$RESULT"
exit $STATUS
