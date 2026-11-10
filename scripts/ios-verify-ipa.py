#!/usr/bin/env python3
"""Runs ON THE RELEASE MAC: verifies an exported Crow HR IPA before validation or upload and prints a
JSON receipt (also written next to the IPA as verification.json). Reads no credentials.

  scripts/ios-verify-ipa.py PATH.ipa --build N [--internal-only]

Checks: bundle id, version and build; the internal-only flag (present for --internal-only, absent
for an App Store build); export compliance (ITSAppUsesNonExemptEncryption false); iPhone only;
App Store distribution signature by the Crow Tech team;
get-task-allow false and no entitlements beyond the ones Apple adds to every App Store app; an App
Store (not ad hoc or development) provisioning profile; PrivacyInfo.xcprivacy present; an opaque
1024 px app icon in the compiled asset catalog; no test bundles or secrets in the archive.
"""
import argparse
import hashlib
import json
import plistlib
import re
import struct
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

BUNDLE_ID = "crowtech.crowhr"
TEAM_ID = "A8GBLXTNHB"
ROOT = Path(__file__).resolve().parents[1]
SOURCE_ICON = ROOT / "apps/ios/CrowHR/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
# Apple adds these to every App Store-signed app; anything else means a capability crept in.
ALLOWED_ENTITLEMENTS = {
    "application-identifier",
    "com.apple.developer.team-identifier",
    "get-task-allow",
    "beta-reports-active",
}
FORBIDDEN_SUFFIXES = (".p8", ".password", ".keychain-db", ".keychain", ".xctest", ".storekit", ".xctestplan")


def fail(message):
    print(f"IPA CHECK FAILED: {message}", file=sys.stderr)
    sys.exit(1)


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True)


def marketing_version():
    text = (ROOT / "apps/ios/project.yml").read_text()
    match = re.search(r"^\s*MARKETING_VERSION:\s*'([^']+)'", text, re.M)
    if not match:
        fail("MARKETING_VERSION not found in apps/ios/project.yml")
    return match.group(1)


def png_is_opaque(path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        fail(f"{path.name} is not a PNG")
    width, height, _depth, color_type = struct.unpack(">IIBB", data[16:26])
    # Colour types 2 (RGB) and 0 (grey) have no alpha channel; a tRNS chunk would add one.
    return (width, height), color_type in (0, 2) and b"tRNS" not in data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("ipa", type=Path)
    parser.add_argument("--build", required=True)
    parser.add_argument("--internal-only", action="store_true")
    args = parser.parse_args()
    version = marketing_version()

    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(args.ipa) as archive:
            names = archive.namelist()
            bad = [n for n in names if n.rstrip("/").endswith(FORBIDDEN_SUFFIXES)]
            if bad:
                fail(f"unexpected files in the IPA: {bad[:5]}")
            apps = {n.split("/")[1] for n in names if n.startswith("Payload/") and n.split("/")[1].endswith(".app")}
            if apps != {"CrowHR.app"}:
                fail(f"expected Payload/CrowHR.app only, found {sorted(apps)}")
            archive.extractall(tmp)
        app = Path(tmp) / "Payload/CrowHR.app"

        info = plistlib.loads((app / "Info.plist").read_bytes())
        expect = {"CFBundleIdentifier": BUNDLE_ID, "CFBundleShortVersionString": version,
                  "CFBundleVersion": args.build, "DTPlatformName": "iphoneos"}
        for key, value in expect.items():
            if info.get(key) != value:
                fail(f"Info.plist {key} is {info.get(key)!r}, expected {value!r}")
        if args.internal_only and info.get("TFInternalTestingOnly") is not True:
            fail("internal-only export but Info.plist has no TFInternalTestingOnly=true")
        if not args.internal_only and "TFInternalTestingOnly" in info:
            fail("TFInternalTestingOnly is set on an export meant for App Store review")
        # Export compliance: HTTPS through the system only, answered in Info.plist so App Store
        # Connect doesn't ask per build.
        if info.get("ITSAppUsesNonExemptEncryption") is not False:
            fail(f"ITSAppUsesNonExemptEncryption is {info.get('ITSAppUsesNonExemptEncryption')!r}, expected false")
        if info.get("UIDeviceFamily") != [1]:
            fail(f"UIDeviceFamily is {info.get('UIDeviceFamily')!r}, expected [1] (iPhone only)")

        run("codesign", "--verify", "--deep", "--strict", str(app))
        details = run("codesign", "-dv", "--verbose=4", str(app)).stderr
        authorities = re.findall(r"^Authority=(.+)$", details, re.M)
        signed_team = (re.findall(r"^TeamIdentifier=(.+)$", details, re.M) or [""])[0]
        signed_id = (re.findall(r"^Identifier=(.+)$", details, re.M) or [""])[0]
        if signed_team != TEAM_ID or signed_id != BUNDLE_ID:
            fail(f"signed as {signed_id} by team {signed_team}")
        if not authorities or not authorities[0].startswith("Apple Distribution:") or not authorities[0].endswith(f"({TEAM_ID})"):
            fail(f"leaf certificate is {authorities[:1]}, expected Apple Distribution for {TEAM_ID}")
        if "Apple Worldwide Developer Relations Certification Authority" not in authorities:
            fail(f"unexpected certificate chain {authorities}")

        entitlements = plistlib.loads(subprocess.run(
            ["codesign", "-d", "--entitlements", ":-", str(app)], check=True, capture_output=True).stdout)
        extra = sorted(set(entitlements) - ALLOWED_ENTITLEMENTS)
        if extra:
            fail(f"extra entitlements: {extra}")
        if entitlements.get("application-identifier") != f"{TEAM_ID}.{BUNDLE_ID}":
            fail(f"application-identifier is {entitlements.get('application-identifier')}")
        if entitlements.get("com.apple.developer.team-identifier") != TEAM_ID:
            fail("team-identifier entitlement mismatch")
        if entitlements.get("get-task-allow") is not False:
            fail("get-task-allow is not false")

        profile = plistlib.loads(subprocess.run(
            ["security", "cms", "-D", "-i", str(app / "embedded.mobileprovision")],
            check=True, capture_output=True).stdout)
        if profile.get("TeamIdentifier") != [TEAM_ID]:
            fail(f"profile team {profile.get('TeamIdentifier')}")
        if "ProvisionedDevices" in profile or profile.get("ProvisionsAllDevices"):
            fail("profile is ad hoc, development or enterprise, not App Store")
        if profile.get("Entitlements", {}).get("get-task-allow") is not False:
            fail("profile allows get-task-allow")
        if profile.get("Entitlements", {}).get("application-identifier") != f"{TEAM_ID}.{BUNDLE_ID}":
            fail("profile is for another app id")

        privacy_path = app / "PrivacyInfo.xcprivacy"
        if not privacy_path.is_file():
            fail("PrivacyInfo.xcprivacy is missing from the app bundle")
        privacy = plistlib.loads(privacy_path.read_bytes())

        if not (app / "Assets.car").is_file():
            fail("Assets.car is missing")
        catalog = json.loads(run("xcrun", "assetutil", "--info", str(app / "Assets.car")).stdout)
        icons = [e for e in catalog if e.get("Name") == "AppIcon" and e.get("AssetType") in ("Icon Image", "Image")]
        big = [e for e in icons if e.get("PixelWidth") == 1024 and e.get("PixelHeight") == 1024]
        if not big:
            fail(f"no 1024x1024 AppIcon in Assets.car (found {[(e.get('PixelWidth'), e.get('PixelHeight')) for e in icons]})")
        if not all(e.get("Opaque") is True for e in big):
            fail("the 1024x1024 AppIcon in Assets.car is not opaque")
        source_size, source_opaque = png_is_opaque(SOURCE_ICON)
        if source_size != (1024, 1024) or not source_opaque:
            fail(f"source icon is {source_size}, opaque={source_opaque}")

    ipa_bytes = args.ipa.read_bytes()
    report = {
        "ipa": args.ipa.name,
        "ipaSHA256": hashlib.sha256(ipa_bytes).hexdigest(),
        "ipaBytes": len(ipa_bytes),
        "bundleId": info["CFBundleIdentifier"],
        "version": info["CFBundleShortVersionString"],
        "build": info["CFBundleVersion"],
        "sdk": info.get("DTSDKName"),
        "xcodeBuild": info.get("DTXcodeBuild"),
        "minimumOS": info.get("MinimumOSVersion"),
        "internalTestingOnly": info.get("TFInternalTestingOnly") is True,
        "usesNonExemptEncryption": info.get("ITSAppUsesNonExemptEncryption"),
        "deviceFamily": info.get("UIDeviceFamily"),
        "signingAuthority": authorities[0],
        "certificateChain": authorities,
        "team": signed_team,
        "entitlements": {k: entitlements[k] for k in sorted(entitlements)},
        "profile": {"name": profile.get("Name"), "uuid": profile.get("UUID"),
                    "expires": str(profile.get("ExpirationDate")), "type": "app-store"},
        "privacyManifest": {"present": True, "tracking": privacy.get("NSPrivacyTracking"),
                            "collectedDataTypes": len(privacy.get("NSPrivacyCollectedDataTypes", []))},
        "appIcon1024": {"inAssetCatalog": True, "opaque": True, "sourceOpaquePNG": source_opaque},
        "uploaded": False,
    }
    text = json.dumps(report, indent=2) + "\n"
    (args.ipa.parent / "verification.json").write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
