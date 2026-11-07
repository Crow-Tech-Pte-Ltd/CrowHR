#!/usr/bin/python3
"""Crow HR Google Play helper (crowtech.crowhr). Read-only unless a write subcommand is named.

  status                          read-only: tracks and listing of the draft app (edit discarded)
  listing                         write the en-GB store listing, icon, feature graphic and phone
                                  screenshots from apps/android/store/listing.json (not a release)
  upload-internal-draft AAB --expected-version-code N
                                  upload a signed AAB and put it on the INTERNAL track as a DRAFT
                                  release (not rolled out to anyone). Called by
                                  scripts/android-release.sh internal; never targets production.

Auth: the shared Gremia publisher (impersonated service account, ADC path below; see
/home/daniel/Gremia/AGENTS.md). Tokens, credentials and raw OAuth errors are never printed.
Receipts (public ids and hashes only) go to apps/android/store/receipts/.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, "/home/daniel/.local/share/gremia/google-cloud-sdk/lib/third_party")
import google.auth  # noqa: E402
from google.auth.exceptions import RefreshError  # noqa: E402
from google.auth.transport.requests import AuthorizedSession  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / "apps/android/store"
META = json.loads((STORE / "listing.json").read_text())
PACKAGE = META["packageName"]
BASE = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}"
UPLOAD = f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PACKAGE}"
ADC = "/home/daniel/.config/gremia/gcloud/application_default_credentials.json"
JAVA = "/usr/lib/jvm/java-21-openjdk-amd64/bin/java"
BUNDLETOOL = "/home/daniel/.local/share/gremia/bundletool-all-1.18.3.jar"
LANG = META["defaultLanguage"]


class PlayError(Exception):
    pass


def call(session, method, url, **kwargs):
    res = session.request(method, url, timeout=300, **kwargs)
    if not res.ok:
        try:
            err = res.json().get("error", {})
            detail = f"{err.get('status', 'UNKNOWN')}: {str(err.get('message', ''))[:600]}"
        except ValueError:
            detail = "UNKNOWN"
        raise PlayError(f"Google Play HTTP {res.status_code} on {method} {url.split(PACKAGE)[-1]} ({detail})")
    return res.json() if res.content else {}


def session():
    creds, _ = google.auth.load_credentials_from_file(ADC, scopes=["https://www.googleapis.com/auth/androidpublisher"])
    return AuthorizedSession(creds)


def receipt(name, data):
    out = STORE / "receipts" / name
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({**data, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, indent=2) + "\n")
    print(json.dumps(data, indent=2))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def status(s, edit):
    tracks = call(s, "GET", f"{edit}/tracks").get("tracks", [])
    listings = call(s, "GET", f"{edit}/listings").get("listings", [])
    details = call(s, "GET", f"{edit}/details")
    receipt(
        "status.json",
        {
            "packageName": PACKAGE,
            "defaultLanguage": details.get("defaultLanguage"),
            "tracks": [{"track": t["track"], "releases": [{"status": r.get("status"), "versionCodes": r.get("versionCodes")} for r in t.get("releases", [])]} for t in tracks],
            "listings": [{"language": entry.get("language"), "title": entry.get("title")} for entry in listings],
        },
    )
    return False  # nothing to commit


def listing(s, edit):
    call(
        s,
        "PATCH",
        f"{edit}/details",
        json={"defaultLanguage": LANG, "contactEmail": META["contactEmail"], "contactWebsite": META["contactWebsite"]},
    )
    call(
        s,
        "PUT",
        f"{edit}/listings/{LANG}",
        json={"language": LANG, "title": META["title"], "shortDescription": META["shortDescription"], "fullDescription": META["fullDescription"]},
    )
    images = META["images"]
    uploaded = {}
    for kind, files in (("icon", [images["icon"]]), ("featureGraphic", [images["featureGraphic"]]), ("phoneScreenshots", images["phoneScreenshots"])):
        call(s, "DELETE", f"{edit}/listings/{LANG}/{kind}")
        for name in files:
            path = STORE / name
            res = call(s, "POST", f"{UPLOAD}/edits/{edit.rsplit('/', 1)[1]}/listings/{LANG}/{kind}", params={"uploadType": "media"}, data=path.read_bytes(), headers={"Content-Type": "image/png"})
            uploaded.setdefault(kind, []).append({"file": name, "sha256": sha256(path), "playSha256": res.get("image", {}).get("sha256")})
    receipt("listing.json", {"packageName": PACKAGE, "language": LANG, "title": META["title"], "images": uploaded})
    return True


def upload_internal_draft(s, edit, aab: Path, version_code: int):
    manifest = ET.fromstring(
        subprocess.run([JAVA, "-jar", BUNDLETOOL, "dump", "manifest", f"--bundle={aab}", "--module=base"], check=True, capture_output=True, text=True).stdout
    )
    if manifest.get("package") != PACKAGE:
        raise PlayError(f"The bundle's package is {manifest.get('package')}, not {PACKAGE}. Nothing uploaded.")
    actual = int(manifest.get("{http://schemas.android.com/apk/res/android}versionCode"))
    if actual != version_code:
        raise PlayError(f"The bundle's versionCode is {actual}, not {version_code}. Nothing uploaded.")
    edit_id = edit.rsplit("/", 1)[1]
    bundle = call(s, "POST", f"{UPLOAD}/edits/{edit_id}/bundles", params={"uploadType": "media"}, data=aab.read_bytes(), headers={"Content-Type": "application/octet-stream"})
    if int(bundle["versionCode"]) != version_code:
        raise PlayError("Google Play reports a different versionCode; the edit is discarded.")
    call(
        s,
        "PUT",
        f"{edit}/tracks/internal",
        json={"track": "internal", "releases": [{"name": f"{version_code}", "versionCodes": [str(version_code)], "status": "draft"}]},
    )
    receipt(
        f"internal-draft-{version_code}.json",
        {"packageName": PACKAGE, "track": "internal", "status": "draft", "versionCode": version_code, "aabSha256": sha256(aab), "playSha256": bundle.get("sha256")},
    )
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["status", "listing", "upload-internal-draft"])
    parser.add_argument("aab", nargs="?", type=Path)
    parser.add_argument("--expected-version-code", type=int)
    args = parser.parse_args()
    if args.command == "upload-internal-draft" and not (args.aab and args.aab.is_file() and args.expected_version_code):
        parser.error("upload-internal-draft needs an existing AAB and --expected-version-code")
    try:
        s = session()
        edit = f"{BASE}/edits/{call(s, 'POST', f'{BASE}/edits', json={})['id']}"
    except RefreshError:
        raise SystemExit("The shared Play login needs renewing (see /home/daniel/Gremia/AGENTS.md); nothing was changed.") from None
    committed = False
    try:
        if args.command == "status":
            changed = status(s, edit)
        elif args.command == "listing":
            changed = listing(s, edit)
        else:
            changed = upload_internal_draft(s, edit, args.aab, args.expected_version_code)
        if changed:
            call(s, "POST", f"{edit}:commit")
            committed = True
            print(f"Committed to Google Play ({args.command}).")
    except PlayError as err:
        raise SystemExit(str(err)) from None
    finally:
        if not committed:
            try:
                call(s, "DELETE", edit)
            except PlayError:
                pass


if __name__ == "__main__":
    main()
