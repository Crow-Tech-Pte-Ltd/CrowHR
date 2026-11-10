#!/usr/bin/env bash
# Runs ON THE RELEASE MAC: has Apple cloud-sign an unsigned Crow HR archive for App Store Connect
# and exports the IPA, then verifies it (scripts/ios-verify-ipa.py). Nothing is uploaded. It
# temporarily selects the dedicated build keychain and always restores the original keychain
# search list and default keychain.
#
#   CROWHR_BUILD_NUMBER=<n> [CROWHR_INTERNAL_ONLY=1] scripts/ios-export-on-mac.sh ARCHIVE_PATH NEW_EXPORT_DIR
#
# CROWHR_INTERNAL_ONLY=1 marks the build "TestFlight internal testing only" (it can then never go to
# external testers or App Review). Credentials are used in place, by path, and never printed:
#   APPLE_KEY_ID, APPLE_ISSUER_ID   the App Store Connect API key (required)
#   APPLE_SIGNING_SECRET_DIR        directory with AuthKey_<key id>.p8, build-signing.keychain-db and
#                                   build-signing.password (or set APPLE_KEY_PATH,
#                                   APPLE_BUILD_KEYCHAIN and APPLE_BUILD_KEYCHAIN_PASSWORD_FILE)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ $# -ne 2 ]]; then
  echo "Usage: CROWHR_BUILD_NUMBER=<n> $0 ARCHIVE_PATH NEW_EXPORT_DIR" >&2
  exit 2
fi
export DEVELOPER_DIR="${DEVELOPER_DIR:-$HOME/Applications/Xcode-27.1.app/Contents/Developer}"
archive=$1
export_dir=$2
build=${CROWHR_BUILD_NUMBER:?Set CROWHR_BUILD_NUMBER to the archived build number}
team_id=${CROWHR_TEAM_ID:-A8GBLXTNHB}
bundle_id=crowtech.crowhr
internal_only=${CROWHR_INTERNAL_ONLY:-0}
key_id=${APPLE_KEY_ID:?Set APPLE_KEY_ID to the App Store Connect API key ID}
issuer_id=${APPLE_ISSUER_ID:?Set APPLE_ISSUER_ID to the App Store Connect API issuer ID}
secret_dir=${APPLE_SIGNING_SECRET_DIR:-}
if [[ -z $secret_dir && ( -z ${APPLE_KEY_PATH:-} || -z ${APPLE_BUILD_KEYCHAIN:-} || -z ${APPLE_BUILD_KEYCHAIN_PASSWORD_FILE:-} ) ]]; then
  echo "Set APPLE_SIGNING_SECRET_DIR to the directory on this Mac with AuthKey_${key_id}.p8 and the build keychain." >&2
  exit 2
fi
key_path=${APPLE_KEY_PATH:-$secret_dir/AuthKey_${key_id}.p8}
keychain=${APPLE_BUILD_KEYCHAIN:-$secret_dir/build-signing.keychain-db}
password_file=${APPLE_BUILD_KEYCHAIN_PASSWORD_FILE:-$secret_dir/build-signing.password}

[[ -d $archive && -f $archive/Info.plist ]] || { echo "Archive not found: $archive" >&2; exit 2; }
[[ ! -e $export_dir ]] || { echo "Export path already exists: $export_dir. Choose a new one." >&2; exit 2; }
[[ -f $key_path && -f $keychain && -f $password_file ]] || { echo "Apple API key or build keychain is missing under $secret_dir" >&2; exit 2; }
[[ $internal_only == 0 || $internal_only == 1 ]] || { echo "CROWHR_INTERNAL_ONLY must be 0 or 1" >&2; exit 2; }
[[ $key_id =~ ^[A-Z0-9]{10}$ ]] || { echo "Invalid APPLE_KEY_ID" >&2; exit 2; }
[[ $issuer_id =~ ^[a-fA-F0-9-]{36}$ ]] || { echo "Invalid APPLE_ISSUER_ID" >&2; exit 2; }

scratch=$(mktemp -d)
original_default=$(security default-keychain -d user | sed -e 's/^[[:space:]]*//' -e 's/^"//' -e 's/"$//')
original_keychains=()
while IFS= read -r entry; do
  entry=$(printf '%s' "$entry" | sed -e 's/^[[:space:]]*//' -e 's/^"//' -e 's/"$//')
  [[ -z $entry ]] || original_keychains+=("$entry")
done < <(security list-keychains -d user)
changed_keychains=0
cleanup() {
  result=$?
  if [[ $changed_keychains == 1 ]]; then
    security default-keychain -d user -s "$original_default" >/dev/null || true
    security list-keychains -d user -s "${original_keychains[@]}" >/dev/null || true
  fi
  rm -rf "$scratch"
  exit "$result"
}
trap cleanup EXIT INT TERM

# Disposable copy of the archive with an ad-hoc signature; Apple applies the distribution
# certificate and App Store profile during export. Crow HR has no entitlements file.
prepared_archive=$scratch/CrowHR.xcarchive
cp -a "$archive" "$prepared_archive"
shopt -s nullglob
archive_apps=("$prepared_archive/Products/Applications/"*.app)
[[ ${#archive_apps[@]} -eq 1 ]] || { echo "Expected one app in the archive" >&2; exit 1; }
prepared_app=${archive_apps[0]}
archived_bundle=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$prepared_app/Info.plist")
[[ $archived_bundle == "$bundle_id" ]] || { echo "Unexpected archive bundle: $archived_bundle" >&2; exit 1; }
archived_build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$prepared_app/Info.plist")
[[ $archived_build == "$build" ]] || { echo "Archive is build $archived_build, not $build" >&2; exit 1; }
codesign --force --sign - "$prepared_app"
codesign --verify --deep --strict "$prepared_app"

internal_option=''
[[ $internal_only == 1 ]] && internal_option='<key>testFlightInternalTestingOnly</key><true/>'
cat > "$scratch/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>export</string>
<key>signingStyle</key><string>automatic</string>
<key>teamID</key><string>$team_id</string>
<key>manageAppVersionAndBuildNumber</key><false/>
$internal_option
</dict></plist>
PLIST
plutil -lint "$scratch/ExportOptions.plist" >/dev/null

security unlock-keychain -p "$(cat "$password_file")" "$keychain"
changed_keychains=1
security list-keychains -d user -s "$keychain" "${original_keychains[@]}"
security default-keychain -d user -s "$keychain"
xcodebuild -exportArchive -archivePath "$prepared_archive" -exportPath "$export_dir" \
  -exportOptionsPlist "$scratch/ExportOptions.plist" -allowProvisioningUpdates \
  -authenticationKeyPath "$key_path" -authenticationKeyID "$key_id" \
  -authenticationKeyIssuerID "$issuer_id"

# Restore the keychain configuration before verifying (verification needs no secrets). The shared
# build keychain is left unlocked, so a concurrent export by another project
# on the Mac is not broken.
security default-keychain -d user -s "$original_default"
security list-keychains -d user -s "${original_keychains[@]}"
changed_keychains=0

ipas=("$export_dir"/*.ipa)
[[ ${#ipas[@]} -eq 1 ]] || { echo "Expected exactly one exported IPA in $export_dir" >&2; exit 1; }
cp "$scratch/ExportOptions.plist" "$export_dir/ExportOptions.used.plist"
verify_args=("${ipas[0]}" --build "$build")
[[ $internal_only == 1 ]] && verify_args+=(--internal-only)
/usr/bin/python3 "$ROOT/scripts/ios-verify-ipa.py" "${verify_args[@]}"
echo "IPA=${ipas[0]}"
