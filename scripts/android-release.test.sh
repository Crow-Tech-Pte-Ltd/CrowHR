#!/usr/bin/env bash
# Dry-run tests of scripts/android-release.sh's refusal paths (add-mobile-apps task 4.2).
# Builds and uploads nothing: every case is --dry-run or fails a gate first.
set -uo pipefail
script="$(cd "$(dirname "$0")" && pwd)/android-release.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
touch "$tmp/signing.properties"
printf 'Approved by Daniel on 1 Dec 2026: crowtech.crowhr versionCode 7 to production.\n' > "$tmp/approval-7.txt"
printf 'Looks good to me\n' > "$tmp/not-an-approval.txt"
pass=0
fail=0

check() { # name, expected exit code, expected text, command...
  local name="$1" want="$2" text="$3"
  shift 3
  local out code
  out="$("$@" 2>&1)"
  code=$?
  if [[ "$code" == "$want" && "$out" == *"$text"* ]]; then
    pass=$((pass + 1))
    printf 'ok   %s\n' "$name"
  else
    fail=$((fail + 1))
    printf 'FAIL %s (exit %s, wanted %s)\n%s\n' "$name" "$code" "$want" "$out"
  fi
}

export CROWHR_SIGNING_PROPERTIES="$tmp/signing.properties"
check "no track" 2 "Choose a track" env CROWHR_ANDROID_VERSION_CODE=7 "$script"
check "unknown track" 2 "Choose a track" env CROWHR_ANDROID_VERSION_CODE=7 "$script" beta --dry-run
check "missing version code" 4 "CROWHR_ANDROID_VERSION_CODE" env -u CROWHR_ANDROID_VERSION_CODE "$script" internal --dry-run
check "production without approval" 3 "need --approval" env CROWHR_ANDROID_VERSION_CODE=7 "$script" production --dry-run
check "production with missing record" 3 "does not exist" env CROWHR_ANDROID_VERSION_CODE=7 "$script" production --approval "$tmp/nope.txt" --dry-run
check "production with a non-approval" 3 "Approved by Daniel" env CROWHR_ANDROID_VERSION_CODE=7 "$script" production --approval "$tmp/not-an-approval.txt" --dry-run
check "production approval for another version" 3 "versionCode 8" env CROWHR_ANDROID_VERSION_CODE=8 "$script" production --approval "$tmp/approval-7.txt" --dry-run
check "missing signing key" 5 "upload-key properties not found" env CROWHR_ANDROID_VERSION_CODE=7 CROWHR_SIGNING_PROPERTIES="$tmp/none.properties" "$script" internal --dry-run
check "signing key not configured" 5 "Set CROWHR_SIGNING_PROPERTIES" env -u CROWHR_SIGNING_PROPERTIES CROWHR_ANDROID_VERSION_CODE=7 "$script" internal --dry-run
check "internal dry run passes gates" 0 "Would build" env CROWHR_ANDROID_VERSION_CODE=7 "$script" internal --dry-run
check "approved production dry run" 0 "Would promote" env CROWHR_ANDROID_VERSION_CODE=7 "$script" production --approval "$tmp/approval-7.txt" --dry-run
check "upload without approval" 3 "need --approval" env CROWHR_ANDROID_VERSION_CODE=7 "$script" internal --upload --dry-run
check "upload approved for another version" 3 "versionCode 8" env CROWHR_ANDROID_VERSION_CODE=8 "$script" internal --upload --approval "$tmp/approval-7.txt" --dry-run
check "approved upload dry run" 0 "internal testing as a draft" env CROWHR_ANDROID_VERSION_CODE=7 "$script" internal --upload --approval "$tmp/approval-7.txt" --dry-run
check "internal without upload only verifies" 0 "Would verify the AAB and stop" env CROWHR_ANDROID_VERSION_CODE=7 "$script" internal --dry-run
check "real production run is not implemented" 6 "not implemented" env CROWHR_ANDROID_VERSION_CODE=7 "$script" production --approval "$tmp/approval-7.txt"

printf '%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" == 0 ]]
