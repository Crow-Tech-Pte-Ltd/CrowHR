#!/usr/bin/env bash
# iOS UI tests (task 3.5) end to end, from Linux:
#   1. start the seeded Crow HR server here (127.0.0.1 only; scripts/ios-ui-server.sh),
#   2. open an SSH reverse tunnel bound to the Mac's loopback (no public port),
#   3. sync and run the XCUITests on the Mac with the socket allow-list check,
#   4. stop the tunnel and the server, always.
#
#   CROWHR_MAC_HOST=<ssh host> CROWHR_SIM_UDID=<udid> [CROWHR_UI_ONLY=CrowHRUITests/QAScreenshotsUITests] scripts/ios-ui-test.sh [extra xcodebuild args]
# Build the web app first: bun run --cwd apps/web build
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${CROWHR_UI_PORT:-3190}"
UDID="${CROWHR_SIM_UDID:?Set CROWHR_SIM_UDID}"
SSH=(ssh -F "$HOME/.ssh/config")
HOST="${CROWHR_MAC_HOST:?Set CROWHR_MAC_HOST to the SSH host of the release Mac}"
REMOTE="${CROWHR_MAC_DIR:-Developer/crowhr-ios}"
STATE="$(mktemp -d "${TMPDIR:-/tmp}/crowhr-ios-ui.XXXXXX")"
SERVER_PID=""
TUNNEL_PID=""
cleanup() {
  [[ -n "$TUNNEL_PID" ]] && kill "$TUNNEL_PID" >/dev/null 2>&1 || true
  [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" >/dev/null 2>&1 || true
  wait >/dev/null 2>&1 || true
  rm -rf "$STATE"
}
trap cleanup EXIT INT TERM

[[ -f apps/web/dist/index.html ]] || { echo "Build the web app first: bun run --cwd apps/web build" >&2; exit 1; }
scripts/ios-ui-server.sh "$STATE" "$PORT" > "$STATE/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 150); do
  curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break
  kill -0 "$SERVER_PID" 2>/dev/null || { cat "$STATE/server.log" >&2; exit 1; }
  sleep 1
done
curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null || { echo "Server did not start" >&2; exit 1; }

"${SSH[@]}" -N -o ExitOnForwardFailure=yes -R "127.0.0.1:$PORT:127.0.0.1:$PORT" "$HOST" &
TUNNEL_PID=$!
sleep 3
kill -0 "$TUNNEL_PID" 2>/dev/null || { echo "Tunnel failed (port $PORT busy on the Mac?)" >&2; exit 1; }

scripts/ios-sync.sh
set +e
"${SSH[@]}" "$HOST" "cd $REMOTE && CROWHR_SIM_UDID=$UDID CROWHR_NET_ALLOW=127.0.0.1:$PORT \
  TEST_RUNNER_CROWHR_TEST_SERVER=http://127.0.0.1:$PORT scripts/ios-mac-test.sh ui -only-testing:${CROWHR_UI_ONLY:-CrowHRUITests} $*" | tee "$STATE/mac.log"
STATUS=${PIPESTATUS[0]}
set -e

# Copy only the named screenshots (small PNGs) from the result bundle to artifacts/ios/.
RESULT=$(grep -o 'RESULT_BUNDLE=.*' "$STATE/mac.log" | tail -1 | cut -d= -f2)
if [[ -n "$RESULT" ]]; then
  "${SSH[@]}" "$HOST" "export DEVELOPER_DIR=\${DEVELOPER_DIR:-\$HOME/Applications/Xcode-27.1.app/Contents/Developer}
    OUT=\"$RESULT-att\"; rm -rf \"\$OUT\" \"\$OUT-shots\"; mkdir -p \"\$OUT\" \"\$OUT-shots\"
    xcrun xcresulttool export attachments --path \"$RESULT\" --output-path \"\$OUT\" >/dev/null
    python3 - \"\$OUT\" <<'PY'
import json, os, re, shutil, sys
out = sys.argv[1]
for test in json.load(open(os.path.join(out, 'manifest.json'))):
    for a in test['attachments']:
        name = a.get('suggestedHumanReadableName', '')
        m = re.match(r'([0-9a-z-]+)_\d+_[0-9A-F-]+\.png$', name)
        if m and a['exportedFileName'].endswith('.png'):
            shutil.copy(os.path.join(out, a['exportedFileName']), os.path.join(out + '-shots', m.group(1) + '.png'))
PY"
  mkdir -p artifacts/ios
  rsync -az -e "${SSH[*]}" "$HOST:$RESULT-att-shots/" artifacts/ios/
  echo "Screenshots: artifacts/ios/ (from $RESULT)"
fi
exit "$STATUS"
