#!/usr/bin/env bash
# QA helpers for the project-owned emulator only (verifies the AVD name before every command).
#   scripts/android-qa.sh screenshot <file.png>     capture the current screen
#   scripts/android-qa.sh link <uri>                open a deep link in the debug app
#   scripts/android-qa.sh logcat [lines]            recent logcat lines for the app
#   scripts/android-qa.sh pull-shots <variant>      copy QaScreenshotTest captures to artifacts/android/screenshots/<variant>
#   scripts/android-qa.sh shots <variant>           run QaScreenshotTest for phone|large|dark|large-dark and pull
#   scripts/android-qa.sh store-shots               Play listing screenshots (1080x1920, demo status bar) into apps/android/store/screenshots
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
sdk="${ANDROID_HOME:-$HOME/Android/Sdk}"
adb="$sdk/platform-tools/adb"
serial="emulator-${CROWHR_EMU_PORT:-5604}"
pkg=crowtech.crowhr.debug
name="$("$adb" -s "$serial" emu avd name 2>/dev/null | head -1 | tr -d '\r')"
if [[ "$name" != "CrowHR_QA" ]]; then
  printf '%s\n' "$serial is '$name', not CrowHR_QA. Refusing to touch it." >&2
  exit 1
fi
case "${1:-}" in
  screenshot) "$adb" -s "$serial" exec-out screencap -p > "$2" ;;
  link) "$adb" -s "$serial" shell am start -W -a android.intent.action.VIEW -d "'$2'" "$pkg" ;;
  logcat) "$adb" -s "$serial" logcat -d -t "${2:-200}" ;;
  tap) "$adb" -s "$serial" shell input tap "$2" "$3" ;;
  packages) "$adb" -s "$serial" shell pm list packages | grep -i "${2:-chrome}" ;;
  dump) "$adb" -s "$serial" exec-out uiautomator dump /dev/tty | sed 's/<\/hierarchy>.*/<\/hierarchy>/' > "$2" ;;
  text) "$adb" -s "$serial" shell input text "$2" ;;
  key) "$adb" -s "$serial" shell input keyevent "$2" ;;
  timezone)
    # Device time zone for QA (e.g. America/New_York; Asia/Singapore to restore). The app must
    # keep showing Singapore time whatever this is.
    "$adb" -s "$serial" shell cmd alarm set-timezone "$2"
    "$adb" -s "$serial" shell date ;;
  select-all) "$adb" -s "$serial" shell input keycombination 113 29 ;;
  install) "$adb" -s "$serial" install -r "$repo_dir/apps/android/app/build/outputs/apk/debug/app-debug.apk" ;;
  perms) "$adb" -s "$serial" shell pm list permissions -g -f | grep -i -B2 -A6 "${2:-local}" ;;
  appops) "$adb" -s "$serial" shell dumpsys package "$pkg" | grep -i -A3 "${2:-permission}" ;;
  reach)
    # Can the emulator reach the host's test server (10.0.2.2:<port>)?
    "$adb" -s "$serial" shell "printf 'GET /api/health HTTP/1.0\r\n\r\n' | toybox nc -w 5 10.0.2.2 ${2:-3197} | head -1" ;;
  pull-shots)
    out="$repo_dir/artifacts/android/screenshots/$2"
    rm -rf "$out" && mkdir -p "$out"
    "$adb" -s "$serial" pull "/sdcard/Android/data/$pkg/files/qa/$2/." "$out" >/dev/null
    ls "$out" ;;
  shots)
    ANDROID_SERIAL="$serial" CROWHR_TEST_CLASS=crowtech.crowhr.QaScreenshotTest CROWHR_SHOTS="$2" \
      "$repo_dir/scripts/android-build.sh" ui
    "$0" pull-shots "$2" ;;
  store-shots)
    # Google Play listing screenshots: a 1080 x 1920 screen (Play allows at most 2:1) and the
    # system demo-mode status bar, then the real app against the fictional seeded test server.
    # The chosen screens are copied to apps/android/store/screenshots/.
    "$adb" -s "$serial" shell wm size 1080x1920
    "$adb" -s "$serial" shell settings put global sysui_demo_allowed 1
    demo() { "$adb" -s "$serial" shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }
    demo enter
    demo clock -e hhmm 0930
    demo battery -e level 100 -e plugged false
    demo network -e wifi show -e level 4
    demo network -e mobile show -e datatype none -e level 4
    demo notifications -e visible false
    restore_screen() { demo exit || true; "$adb" -s "$serial" shell wm size reset || true; }
    trap restore_screen EXIT
    "$0" shots store
    store="$repo_dir/apps/android/store/screenshots"
    rm -rf "$store" && mkdir -p "$store"
    n=0
    # Only screens that look right with the e2e seed: its employee is on probation (no leave
    # balances yet), has no published shifts, and its notifications name the test devices.
    for name in clock leave-apply approvals claim-new; do
      src="$(ls "$repo_dir/artifacts/android/screenshots/store/"*"-$name.png")"
      n=$((n + 1))
      cp "$src" "$store/$(printf '%02d' "$n")-$name.png"
    done
    ls "$store" ;;
  *) printf '%s\n' 'Usage: scripts/android-qa.sh screenshot|link|logcat|pull-shots|shots|store-shots' >&2; exit 2 ;;
esac
