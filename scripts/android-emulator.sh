#!/usr/bin/env bash
# Project-owned QA emulator for Crow HR (add-mobile-apps task 2.7). Touches only the AVD named
# CrowHR_QA and the serial it runs on; never another project's device.
#   scripts/android-emulator.sh create    make the AVD (in CROWHR_AVD_HOME); delete removes it
#   scripts/android-emulator.sh start     boot CrowHR_QA headless on port $CROWHR_EMU_PORT (5604)
#   scripts/android-emulator.sh wait      wait for boot, verify the AVD name and 16 KB pages
#   scripts/android-emulator.sh restore   reset font scale and night mode overrides
#   scripts/android-emulator.sh stop      restore, then kill only this emulator
# CROWHR_AVD_HOME: where the AVD lives (default ~/.android/avd). On a nearly full disk it can be
# a tmpfs directory: the API 37 image needs 1.2 x 6 GB free for its data partition check.
set -euo pipefail
sdk="${ANDROID_HOME:-$HOME/Android/Sdk}"
adb="$sdk/platform-tools/adb"
port="${CROWHR_EMU_PORT:-5604}"
serial="emulator-$port"
avd=CrowHR_QA
export ANDROID_AVD_HOME="${CROWHR_AVD_HOME:-$HOME/.android/avd}"

verify() {
  local name
  name="$("$adb" -s "$serial" emu avd name 2>/dev/null | head -1 | tr -d '\r')"
  if [[ "$name" != "$avd" ]]; then
    printf '%s\n' "$serial is '$name', not $avd. Refusing to touch it." >&2
    exit 1
  fi
}

case "${1:-}" in
  create)
    # Pixel 8 profile on the installed API 37 Google Play 16 KB-page image (no download).
    mkdir -p "$ANDROID_AVD_HOME"
    echo no | JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}" "$sdk/cmdline-tools/latest/bin/avdmanager" create avd \
      -n "$avd" -k "system-images;android-37.0;google_apis_playstore_ps16k;x86_64" -d pixel_8 >/dev/null
    # 6 GB data partition, the image's minimum (the device profile defaults to more); it is a
    # sparse file, but the emulator wants 1.2 x this free before it boots.
    sed -i -E 's/^disk\.dataPartition\.size ?=.*/disk.dataPartition.size = 6442450944/' "$ANDROID_AVD_HOME/$avd.avd/config.ini"
    sed -i -E 's/^hw\.ramSize ?=.*/hw.ramSize = 4096/' "$ANDROID_AVD_HOME/$avd.avd/config.ini"
    printf 'created %s in %s\n' "$avd" "$ANDROID_AVD_HOME" ;;
  delete)
    rm -rf "${ANDROID_AVD_HOME:?}/$avd.avd" "${ANDROID_AVD_HOME:?}/$avd.ini"
    printf 'deleted %s from %s\n' "$avd" "$ANDROID_AVD_HOME" ;;
  start)
    "$sdk/emulator/emulator" -avd "$avd" -port "$port" -no-window -no-audio -no-boot-anim \
      -gpu swiftshader_indirect -no-snapshot -memory 4096 -cores 4 ;;
  wait)
    "$adb" -s "$serial" wait-for-device
    for _ in $(seq 1 90); do
      [[ "$("$adb" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]] && break
      sleep 4
    done
    verify
    printf 'serial=%s avd=%s sdk=%s pagesize=%s\n' "$serial" "$avd" \
      "$("$adb" -s "$serial" shell getprop ro.build.version.sdk | tr -d '\r')" \
      "$("$adb" -s "$serial" shell getconf PAGESIZE | tr -d '\r')" ;;
  restore)
    verify
    "$adb" -s "$serial" shell settings put system font_scale 1.0
    "$adb" -s "$serial" shell cmd uimode night no ;;
  stop)
    verify
    "$adb" -s "$serial" shell settings put system font_scale 1.0 || true
    "$adb" -s "$serial" shell cmd uimode night no || true
    "$adb" -s "$serial" emu kill ;;
  *)
    printf '%s\n' 'Usage: scripts/android-emulator.sh start|wait|restore|stop' >&2
    exit 2 ;;
esac
