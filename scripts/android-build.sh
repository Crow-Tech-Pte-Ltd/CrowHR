#!/usr/bin/env bash
# Crow HR Android build entry point (add-mobile-apps tasks 2.1-2.7).
#   scripts/android-build.sh check   debug APK + unit tests + lint
#   ANDROID_SERIAL=emulator-NNNN CROWHR_TEST_SERVER=http://10.0.2.2:3197 \
#     scripts/android-build.sh ui    Compose UI tests on a project-owned emulator
#   scripts/android-build.sh clean   remove build outputs and stop the Gradle daemon
# Release builds and uploads live in scripts/android-release.sh (approval-gated).
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
android_dir="$repo_dir/apps/android"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
export ANDROID_HOME="${ANDROID_HOME:-/home/daniel/Android/Sdk}"
gradle=("$android_dir/gradlew" -p "$android_dir" --console=plain)
mode="${1:-check}"
case "$mode" in
  check)
    exec "${gradle[@]}" :app:assembleDebug :app:testDebugUnitTest :app:lintDebug ;;
  ui)
    if [[ -z "${ANDROID_SERIAL:-}" ]]; then
      printf '%s\n' 'Set ANDROID_SERIAL to the project-owned test emulator (never a shared or release-test device).' >&2
      exit 1
    fi
    server="${CROWHR_TEST_SERVER:-http://10.0.2.2:3197}"
    args=("-Pandroid.testInstrumentationRunnerArguments.crowhrServer=$server")
    if [[ -n "${CROWHR_TEST_CLASS:-}" ]]; then
      args+=("-Pandroid.testInstrumentationRunnerArguments.class=$CROWHR_TEST_CLASS")
    else
      # Screenshot capture runs only on request (scripts/android-qa.sh shots <variant>).
      args+=("-Pandroid.testInstrumentationRunnerArguments.notClass=crowtech.crowhr.QaScreenshotTest")
    fi
    if [[ -n "${CROWHR_SHOTS:-}" ]]; then
      args+=("-Pandroid.testInstrumentationRunnerArguments.crowhrShots=$CROWHR_SHOTS")
      # Keep the app installed so scripts/android-qa.sh can pull the captures from its files dir.
      args+=("-Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true")
    fi
    exec "${gradle[@]}" :app:connectedDebugAndroidTest "${args[@]}" ;;
  clean)
    "${gradle[@]}" clean
    exec "${gradle[@]}" --stop ;;
  *)
    printf '%s\n' 'Usage: scripts/android-build.sh [check|ui|clean]' >&2
    exit 2 ;;
esac
