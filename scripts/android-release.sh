#!/usr/bin/env bash
# Crow HR Android release (add-mobile-apps task 4.2). Approval-gated:
#   scripts/android-release.sh internal [--dry-run]
#       signed AAB for a Google Play *internal testing draft*. Needs the private upload-key
#       properties (by path only: CROWHR_SIGNING_PROPERTIES, default
#       /home/daniel/.config/gremia/android-signing/crow-hr.properties) and a fresh
#       CROWHR_ANDROID_VERSION_CODE.
#   scripts/android-release.sh production --approval <record> [--dry-run]
#       refuses unless <record> is an existing approval record file written for this
#       release (it must name the package and version code and contain "Approved by Daniel").
# Nothing here publishes on its own. The Play upload step is NOT IMPLEMENTED: the Play Console
# app for crowtech.crowhr does not exist yet (owner step), so a real run stops after building
# and prints the upload it would make. --dry-run checks every gate and builds nothing.
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
android_dir="$repo_dir/apps/android"
package=crowtech.crowhr
signing="${CROWHR_SIGNING_PROPERTIES:-/home/daniel/.config/gremia/android-signing/crow-hr.properties}"

die() { printf 'REFUSED: %s\n' "$2" >&2; exit "$1"; }

track="${1:-}"
shift || true
approval=""
dry_run=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --approval) approval="${2:-}"; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    *) die 2 "Unknown option $1. Usage: android-release.sh internal|production [--approval <record>] [--dry-run]" ;;
  esac
done

case "$track" in
  internal|production) ;;
  *) die 2 "Choose a track: internal (draft for internal testers) or production (needs Daniel's approval record)." ;;
esac

version_code="${CROWHR_ANDROID_VERSION_CODE:-}"
[[ "$version_code" =~ ^[1-9][0-9]*$ ]] || die 4 "Set CROWHR_ANDROID_VERSION_CODE to a fresh positive integer (never reuse an uploaded one)."

if [[ "$track" == production ]]; then
  [[ -n "$approval" ]] || die 3 "Production needs --approval <record>: Daniel's written approval for this release."
  [[ -f "$approval" ]] || die 3 "Approval record $approval does not exist."
  grep -q "Approved by Daniel" "$approval" || die 3 "Approval record $approval does not say \"Approved by Daniel\"."
  grep -q "$package" "$approval" || die 3 "Approval record $approval does not name $package."
  grep -q "versionCode $version_code" "$approval" || die 3 "Approval record $approval does not approve versionCode $version_code."
fi

[[ -f "$signing" ]] || die 5 "Private upload-key properties not found at $signing (referenced by path only; never committed)."

if $dry_run; then
  printf 'DRY RUN: all gates passed for %s, track %s, versionCode %s.\n' "$package" "$track" "$version_code"
  printf 'Would build: gradlew :app:bundleRelease (signed with the key referenced by %s)\n' "$signing"
  if [[ "$track" == production ]]; then
    printf 'Would promote the reviewed internal release to production after the approval in %s.\n' "$approval"
  else
    printf 'Would upload the AAB to Google Play internal testing as a draft (not rolled out).\n'
  fi
  exit 0
fi

# NOT IMPLEMENTED: signing config injection and the Play upload. Both need the upload key and
# the Play Console app for crowtech.crowhr, which don't exist yet; adding them is a separate,
# approved step (reuse the shared Gremia publisher per /home/daniel/Gremia/AGENTS.md).
die 6 "Real releases are not implemented yet: create the Play Console app and upload key first (owner step), then add the signing and upload steps. Use --dry-run to check the gates."
