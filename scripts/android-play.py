#!/usr/bin/python3
"""Crow HR Google Play helper (crowtech.crowhr). Read-only unless a write subcommand is named.

  status                          read-only: tracks and listing of the draft app (edit discarded)
  listing                         write the en-GB store listing, icon, feature graphic and phone
                                  screenshots from apps/android/store/listing.json (not a release)
  upload-internal-draft AAB --expected-version-code N
                                  upload a signed AAB and put it on the INTERNAL track as a DRAFT
                                  release (not rolled out to anyone). Called by
                                  scripts/android-release.sh internal; never targets production.
  upload-production-draft AAB --expected-version-code N [--expected-sha256 HEX]
                                  upload a signed AAB and put it on the PRODUCTION track as a DRAFT
                                  release with en-GB release notes. Nothing is sent for review:
                                  that, and the App content forms, stay in Play Console.

Auth: the maintainers' Play publisher service account, through a Google credentials file
(CROWHR_PLAY_CREDENTIALS, else GOOGLE_APPLICATION_CREDENTIALS, else gcloud's application default
credentials; an impersonated service account works). Needs the google-auth Python package (pip, or
the copy inside the Google Cloud SDK: PYTHONPATH=<sdk>/lib/third_party). upload-internal-draft
also needs JDK 21 (JAVA_HOME) and bundletool (CROWHR_BUNDLETOOL_JAR). Tokens, credentials and raw
OAuth errors are never printed. Receipts (public ids and hashes only) go to
apps/android/store/receipts/.
"""
import argparse
import hashlib
import json
import os
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

try:
    import google.auth
    from google.auth.exceptions import RefreshError
    from google.auth.transport.requests import AuthorizedSession
except ImportError:
    raise SystemExit(
        "google-auth is not installed: pip install google-auth requests, or set PYTHONPATH to the "
        "Google Cloud SDK's lib/third_party directory."
    ) from None

ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / "apps/android/store"
META = json.loads((STORE / "listing.json").read_text())
PACKAGE = META["packageName"]
BASE = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}"
UPLOAD = f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PACKAGE}"
ADC = Path(
    os.environ.get("CROWHR_PLAY_CREDENTIALS")
    or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    or Path.home() / ".config/gcloud/application_default_credentials.json"
)
JAVA = Path(os.environ.get("JAVA_HOME", "/usr/lib/jvm/java-21-openjdk-amd64")) / "bin/java"
BUNDLETOOL = os.environ.get("CROWHR_BUNDLETOOL_JAR", "")
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
    if not ADC.is_file():
        raise SystemExit(
            f"No Google credentials file at {ADC}. Set CROWHR_PLAY_CREDENTIALS to the Play publisher's "
            "credentials file (or run gcloud auth application-default login)."
        )
    creds, _ = google.auth.load_credentials_from_file(str(ADC), scopes=["https://www.googleapis.com/auth/androidpublisher"])
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


RELEASE_NOTES = {"production": "First release: payslips, leave, clock-in with an offline queue, claims with receipt photos, your schedule and manager approvals, from your company's own Crow HR server."}


def upload_draft(s, edit, aab: Path, version_code: int, track: str, expected_sha256: str | None = None):
    if not BUNDLETOOL or not Path(BUNDLETOOL).is_file():
        raise PlayError("Set CROWHR_BUNDLETOOL_JAR to bundletool-all-<version>.jar. Nothing uploaded.")
    if expected_sha256 and sha256(aab) != expected_sha256.lower():
        raise PlayError(f"The bundle's SHA-256 is {sha256(aab)}, not {expected_sha256}. Nothing uploaded.")
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
    release = {"name": f"{version_code} ({manifest.get('{http://schemas.android.com/apk/res/android}versionName')})" if track == "production" else f"{version_code}",
               "versionCodes": [str(version_code)], "status": "draft"}
    if track in RELEASE_NOTES:
        release["releaseNotes"] = [{"language": LANG, "text": RELEASE_NOTES[track]}]
    call(s, "PUT", f"{edit}/tracks/{track}", json={"track": track, "releases": [release]})
    receipt(
        f"{track}-draft-{version_code}.json",
        {"packageName": PACKAGE, "track": track, "status": "draft", "versionCode": version_code, "aabSha256": sha256(aab), "playSha256": bundle.get("sha256")},
    )
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["status", "listing", "upload-internal-draft", "upload-production-draft"])
    parser.add_argument("aab", nargs="?", type=Path)
    parser.add_argument("--expected-version-code", type=int)
    parser.add_argument("--expected-sha256")
    args = parser.parse_args()
    if args.command.startswith("upload-") and not (args.aab and args.aab.is_file() and args.expected_version_code):
        parser.error(f"{args.command} needs an existing AAB and --expected-version-code")
    try:
        s = session()
        edit = f"{BASE}/edits/{call(s, 'POST', f'{BASE}/edits', json={})['id']}"
    except RefreshError:
        raise SystemExit("The Play publisher credentials need renewing (see the header of this script); nothing was changed.") from None
    committed = False
    try:
        if args.command == "status":
            changed = status(s, edit)
        elif args.command == "listing":
            changed = listing(s, edit)
        else:
            track = "internal" if args.command == "upload-internal-draft" else "production"
            changed = upload_draft(s, edit, args.aab, args.expected_version_code, track, args.expected_sha256)
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
