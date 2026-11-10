#!/usr/bin/env bash
# Runs ON THE MAC from the synced checkout: generates the project, builds for testing with the
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

SAMPLER=""
cleanup() {
  if [[ -n "$SAMPLER" ]]; then kill "$SAMPLER" >/dev/null 2>&1 || true; fi
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

xcodegen generate --quiet
xcodebuild -project CrowHR.xcodeproj -scheme CrowHR -sdk iphonesimulator \
  -destination "id=$UDID" -derivedDataPath "$DERIVED" -jobs 4 -quiet build-for-testing

if [[ -n "${CROWHR_TEST_DRIVER_DIR:-}" ]]; then export DEVELOPER_DIR="$CROWHR_TEST_DRIVER_DIR"; fi

# Store screenshots (CROWHR_STATUS_BAR=demo): boot our simulator first and give it a clean status
# bar (9:41, full battery and signal). The trap above shuts it down, which drops the override.
if [[ "${CROWHR_STATUS_BAR:-}" == demo ]]; then
  xcrun simctl boot "$UDID" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$UDID" >/dev/null
  xcrun simctl status_bar "$UDID" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 --operatorName "" --batteryState charged --batteryLevel 100
fi

# Network allow-list, seen by the OS: sample every socket the CrowHR app process holds while the
# tests run (simulator apps are Mac processes), then require every remote end to be the test server.
NETLOG=""
if [[ -n "${CROWHR_NET_ALLOW:-}" ]]; then
  NETLOG="$ROOT/results/$(basename "$RESULT" .xcresult)-sockets.log"
  : > "$NETLOG"
  ( set +e +o pipefail
    while true; do
      PIDS=$(pgrep -f '/CrowHR.app/CrowHR' || true)
      echo "$(date +%T) pids=$(echo $PIDS)" >> "$NETLOG.pids"
      for pid in $PIDS; do lsof -nP -a -p "$pid" -i 2>/dev/null | tail -n +2; done
      sleep 0.2
    done ) >> "$NETLOG" &
  SAMPLER=$!
fi

set +e
xcodebuild test-without-building -project CrowHR.xcodeproj -scheme CrowHR \
  -destination "id=$UDID" -derivedDataPath "$DERIVED" -resultBundlePath "$RESULT" \
  -parallel-testing-enabled NO -collect-test-diagnostics never "$@"
STATUS=$?
set -e
echo "RESULT_BUNDLE=$RESULT"

if [[ -n "$NETLOG" ]]; then
  kill "$SAMPLER" >/dev/null 2>&1 || true
  SAMPLER=""
  REMOTES=$(grep -o -- '->[^ ]*' "$NETLOG" | sed 's/^->//' | sort -u || true)
  SAMPLES=$(wc -l < "$NETLOG" | tr -d ' ')
  echo "NETWORK_SAMPLES=$SAMPLES"
  echo "NETWORK_REMOTES=$(echo "$REMOTES" | tr '\n' ' ')"
  if [[ -z "$REMOTES" ]]; then
    echo "NETWORK_ALLOWLIST=no-connections-observed"
    STATUS=${STATUS:-1}
    [[ $STATUS -eq 0 ]] && STATUS=1
  elif [[ -n "$(echo "$REMOTES" | grep -v -x -F "$CROWHR_NET_ALLOW" || true)" ]]; then
    echo "NETWORK_ALLOWLIST=FAILED (only $CROWHR_NET_ALLOW is allowed)"
    STATUS=1
  else
    echo "NETWORK_ALLOWLIST=passed (every connection went to $CROWHR_NET_ALLOW)"
  fi
fi
exit $STATUS
