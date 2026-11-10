#!/usr/bin/env bash
# Zero-data-collection audit of a built Crow HR APK (add-mobile-apps task 2.7 / 4.3):
# fails if any known telemetry, crash-reporting, ads or Play Services code is inside, and lists
# the merged manifest's permissions and the runtime dependency tree for the Data safety form.
#   scripts/android-audit.sh [path/to/app.apk]   (default: the debug APK)
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
android_dir="$repo_dir/apps/android"
apk="${1:-$android_dir/app/build/outputs/apk/debug/app-debug.apk}"
sdk="${ANDROID_HOME:-$HOME/Android/Sdk}"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
[[ -f "$apk" ]] || { printf '%s\n' "No APK at $apk. Run scripts/android-build.sh check first." >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
unzip -q -o "$apk" 'classes*.dex' -d "$work"

status=0
# Positive control: the scan must see a library that is really there.
grep -a -q "Lokhttp3/OkHttpClient;" "$work"/classes*.dex || { printf '%s\n' 'Audit self-check failed: OkHttp not found in the dex.' >&2; exit 2; }
for pattern in com/google/android/gms com/google/firebase com/google/android/datatransport \
  com/crashlytics io/sentry com/bugsnag com/google/android/play/core com/facebook \
  com/appsflyer com/adjust com/mixpanel com/segment com/amplitude com/onesignal; do
  if grep -a -q "L$pattern/" "$work"/classes*.dex; then
    printf 'FOUND  %s\n' "$pattern"
    status=1
  else
    printf 'absent %s\n' "$pattern"
  fi
done

printf '\nPermissions (merged manifest):\n'
"$sdk/build-tools/37.0.0/aapt2" dump permissions "$apk" | sed -n 's/^uses-permission: name=//p' | sort -u | sed 's/^/  /'

printf '\nRuntime dependencies (release):\n'
"$android_dir/gradlew" -p "$android_dir" -q :app:dependencies --configuration releaseRuntimeClasspath \
  | grep -oE '[a-z0-9.-]+:[A-Za-z0-9.-]+:[0-9][^ ]*' | sed 's/ -> .*//' | awk -F: '{print "  " $1 ":" $2}' | sort -u
exit "$status"
