#!/usr/bin/env bash
# Crow HR Android release (add-mobile-apps task 4.2). Approval-gated:
#   scripts/android-release.sh internal [--upload --approval <record>] [--dry-run]
#       builds the release AAB signed with the private upload key (by path only:
#       CROWHR_SIGNING_PROPERTIES, required, kept outside the repository)
#       for a fresh CROWHR_ANDROID_VERSION_CODE, verifies it (package, versionCode, upload
#       certificate, bundletool validate) and copies it to artifacts/android/. With --upload it
#       then puts it on the Google Play *internal* track as a DRAFT release (scripts/android-play.py),
#       which needs an approval record like production's.
#   scripts/android-release.sh production --approval <record> [--dry-run]
#       checks the approval gates only. NOT IMPLEMENTED: promoting a reviewed internal release
#       to production; do that in Play Console after review.
# An approval record is a file that contains "Approved by Daniel", the package name and
# "versionCode <N>". --dry-run checks every gate and builds nothing.
# A real build also needs JDK 21 (JAVA_HOME, default /usr/lib/jvm/java-21-openjdk-amd64) and
# bundletool (CROWHR_BUNDLETOOL_JAR, the path to bundletool-all-<version>.jar).
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
android_dir="$repo_dir/apps/android"
package=crowtech.crowhr
signing="${CROWHR_SIGNING_PROPERTIES:-}"

die() { printf 'REFUSED: %s\n' "$2" >&2; exit "$1"; }

track="${1:-}"
shift || true
approval=""
dry_run=false
upload=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --approval) approval="${2:-}"; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    --upload) upload=true; shift ;;
    *) die 2 "Unknown option $1. Usage: android-release.sh internal|production [--upload] [--approval <record>] [--dry-run]" ;;
  esac
done

case "$track" in
  internal|production) ;;
  *) die 2 "Choose a track: internal (draft for internal testers) or production (needs Daniel's approval record)." ;;
esac

version_code="${CROWHR_ANDROID_VERSION_CODE:-}"
[[ "$version_code" =~ ^[1-9][0-9]*$ ]] || die 4 "Set CROWHR_ANDROID_VERSION_CODE to a fresh positive integer (never reuse an uploaded one)."

if [[ "$track" == production ]] || $upload; then
  [[ -n "$approval" ]] || die 3 "Production and --upload need --approval <record>: Daniel's written approval for this release."
  [[ -f "$approval" ]] || die 3 "Approval record $approval does not exist."
  grep -q "Approved by Daniel" "$approval" || die 3 "Approval record $approval does not say \"Approved by Daniel\"."
  grep -q "$package" "$approval" || die 3 "Approval record $approval does not name $package."
  grep -q "versionCode $version_code" "$approval" || die 3 "Approval record $approval does not approve versionCode $version_code."
fi

[[ -n "$signing" ]] || die 5 "Set CROWHR_SIGNING_PROPERTIES to the private upload-key properties file (referenced by path only; never committed)."
[[ -f "$signing" ]] || die 5 "Private upload-key properties not found at $signing (referenced by path only; never committed)."

if $dry_run; then
  printf 'DRY RUN: all gates passed for %s, track %s, versionCode %s.\n' "$package" "$track" "$version_code"
  printf 'Would build: gradlew :app:bundleRelease (signed with the key referenced by %s)\n' "$signing"
  if [[ "$track" == production ]]; then
    printf 'Would promote the reviewed internal release to production after the approval in %s.\n' "$approval"
  elif $upload; then
    printf 'Would upload the AAB to Google Play internal testing as a draft (not rolled out).\n'
  else
    printf 'Would verify the AAB and stop (add --upload --approval <record> to put it on internal testing as a draft).\n'
  fi
  exit 0
fi

if [[ "$track" == production ]]; then
  die 6 "Production promotion is not implemented: promote the reviewed internal release in Play Console."
fi

java="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}/bin/java"
bundletool="${CROWHR_BUNDLETOOL_JAR:-}"
[[ -x "$java" ]] || die 5 "JDK 21 not found at $java. Set JAVA_HOME to a JDK 21."
[[ -n "$bundletool" && -f "$bundletool" ]] || die 5 "Set CROWHR_BUNDLETOOL_JAR to bundletool-all-<version>.jar (https://github.com/google/bundletool/releases)."
cert="${signing%.properties}-upload-certificate.pem"
[[ -f "$cert" ]] || die 5 "Upload certificate $cert not found (it sits next to the signing properties)."

printf 'Building crowtech.crowhr versionCode %s (release, signed with the upload key)...\n' "$version_code"
CROWHR_SIGNING_PROPERTIES="$signing" CROWHR_ANDROID_VERSION_CODE="$version_code" \
  "$android_dir/gradlew" -p "$android_dir" --quiet :app:bundleRelease
aab="$android_dir/app/build/outputs/bundle/release/app-release.aab"

manifest="$("$java" -jar "$bundletool" dump manifest --bundle="$aab" --module=base)"
[[ "$manifest" == *"package=\"$package\""* ]] || die 7 "The AAB's package is not $package."
[[ "$manifest" == *"android:versionCode=\"$version_code\""* ]] || die 7 "The AAB's versionCode is not $version_code."
"$java" -jar "$bundletool" validate --bundle="$aab" >/dev/null || die 7 "bundletool validate failed."
signer="$("${java%/java}/keytool" -printcert -rfc -jarfile "$aab" 2>/dev/null | openssl x509 -noout -fingerprint -sha256 || true)"
expected="$(openssl x509 -in "$cert" -noout -fingerprint -sha256)"
[[ -n "$signer" && "$signer" == "$expected" ]] || die 7 "The AAB is not signed with the Crow HR upload certificate."

out="$repo_dir/artifacts/android/crow-hr-$(grep -oE 'versionName = "[^"]+"' "$android_dir/app/build.gradle.kts" | cut -d'"' -f2)-$version_code.aab"
mkdir -p "$(dirname "$out")"
cp "$aab" "$out"
printf 'Verified %s: package, versionCode %s, upload certificate (%s), bundletool validate.\n' "$out" "$version_code" "${expected#*=}"
sha256sum "$out"

if $upload; then
  /usr/bin/python3 "$repo_dir/scripts/android-play.py" upload-internal-draft "$out" --expected-version-code "$version_code"
else
  printf 'Not uploaded. To put it on internal testing as a draft: add --upload --approval <record>.\n'
fi
