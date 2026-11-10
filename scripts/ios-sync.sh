#!/usr/bin/env bash
# Syncs the iOS app (and the shared mobile fixtures) to the checkout on the release Mac. Build
# outputs and the xcodegen-generated project stay on the Mac.
#   CROWHR_MAC_HOST=<ssh host> [CROWHR_MAC_DIR=Developer/crowhr-ios] scripts/ios-sync.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SSH="ssh -F $HOME/.ssh/config"
HOST="${CROWHR_MAC_HOST:?Set CROWHR_MAC_HOST to the SSH host of the release Mac}"
REMOTE="${CROWHR_MAC_DIR:-Developer/crowhr-ios}"

$SSH "$HOST" "mkdir -p $REMOTE/apps $REMOTE/scripts"
rsync -az --delete \
  --exclude 'CrowHR.xcodeproj' --exclude 'CrowHR/Info.plist' --exclude 'DerivedData*' \
  --exclude '*.xcresult' --exclude 'build/' \
  -e "$SSH" apps/ios/ "$HOST:$REMOTE/apps/ios/"
if [[ -d apps/mobile-fixtures ]]; then
  rsync -az --delete -e "$SSH" apps/mobile-fixtures/ "$HOST:$REMOTE/apps/mobile-fixtures/"
fi
rsync -az -e "$SSH" scripts/ios-mac-test.sh scripts/ios-release.sh scripts/ios-store-register.py scripts/ios-store-listing.py \
  scripts/ios-archive-on-mac.sh scripts/ios-export-on-mac.sh scripts/ios-verify-ipa.py "$HOST:$REMOTE/scripts/"
echo "Synced to $HOST:$REMOTE"
