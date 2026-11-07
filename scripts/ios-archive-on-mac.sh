#!/usr/bin/env bash
# Runs ON THE MAC (s5) from the synced checkout: archives the Release app for a generic iOS device,
# unsigned, ready for Apple cloud signing by scripts/ios-export-on-mac.sh. Adapted from Learning
# TA's archive-on-mac.sh. Nothing is signed or uploaded here.
#
#   CROWHR_BUILD_NUMBER=<n> [CROWHR_ARCHIVE_PATH=...] scripts/ios-archive-on-mac.sh
#
# CROWHR_BUILD_NUMBER must be numeric and never one already uploaded to App Store Connect.
# The archive path must not exist yet (default artifacts/CrowHR-build<n>.xcarchive).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/bin:$PATH"
export DEVELOPER_DIR="${DEVELOPER_DIR:-$HOME/Applications/Xcode-27.1.app/Contents/Developer}"
TEAM_ID="${CROWHR_TEAM_ID:-A8GBLXTNHB}"
BUILD="${CROWHR_BUILD_NUMBER:?Set CROWHR_BUILD_NUMBER to a fresh numeric build number}"
ARCHIVE="${CROWHR_ARCHIVE_PATH:-$ROOT/artifacts/CrowHR-build$BUILD.xcarchive}"
DERIVED="${CROWHR_RELEASE_DERIVED:-$ROOT/DerivedDataRelease}"

[[ "$TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || { echo "Invalid Apple team id: $TEAM_ID" >&2; exit 1; }
[[ "$BUILD" =~ ^[1-9][0-9]*$ ]] || { echo "CROWHR_BUILD_NUMBER must be a positive whole number, got '$BUILD'." >&2; exit 1; }
[[ ! -e "$ARCHIVE" ]] || { echo "Archive already exists: $ARCHIVE. Use a new build number or CROWHR_ARCHIVE_PATH." >&2; exit 1; }
mkdir -p "$(dirname "$ARCHIVE")"

cd "$ROOT/apps/ios"
xcodegen generate --quiet
xcodebuild -project CrowHR.xcodeproj -scheme CrowHR \
  -configuration Release -destination 'generic/platform=iOS' -jobs 2 \
  -derivedDataPath "$DERIVED" -archivePath "$ARCHIVE" \
  CODE_SIGNING_ALLOWED=NO DEVELOPMENT_TEAM="$TEAM_ID" \
  CURRENT_PROJECT_VERSION="$BUILD" -quiet archive

ARCHIVED_BUILD=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$ARCHIVE/Products/Applications/CrowHR.app/Info.plist")
[[ "$ARCHIVED_BUILD" == "$BUILD" ]] || { echo "Archived build is $ARCHIVED_BUILD, expected $BUILD" >&2; exit 1; }
echo "ARCHIVE=$ARCHIVE"
echo "Unsigned archive. Next: scripts/ios-export-on-mac.sh \"$ARCHIVE\" <new export directory>"
