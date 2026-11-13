#!/usr/bin/env python3
"""App Store listing for Crow HR through the App Store Connect API (run on the release Mac).

  status                 read-only: the 1.0.0 version, listing text, category, age rating, price,
                         availability, screenshots and attached build, as JSON
  apply                  create or rename the editable iOS version to MARKETING_VERSION and fill
                         what the API allows from LISTING below: description, keywords, promotional
                         text, subtitle, support/marketing/privacy URLs, category, copyright, age
                         rating (every question "none"/"no"), free in every territory, and for an
                         update the version's "What's New" text from WHATS_NEW
  screenshots [DIR]      replace the en-GB screenshots: the 6.9-inch iPhone set with DIR/*.png and,
                         when DIR/ipad/ has PNGs, the 13-inch iPad set with DIR/ipad/*.png (name
                         order; DIR defaults to apps/ios/store/screenshots). Checks every size first
  check-screenshots [DIR]
                         offline, no API key or network: the sets `screenshots` would upload, with
                         each PNG's size checked against the display type
  attach-build N         attach processed build N to the version (it must be VALID)

Never submits anything for review, and leaves App Review contact and demo account, the App
Privacy answers and the submission to the App Store Connect web UI. Uses the Crow Tech team API key
kept on the Mac (APPLE_KEY_ID, APPLE_ISSUER_ID, and APPLE_KEY_PATH or APPLE_SIGNING_SECRET_DIR with
AuthKey_<key id>.p8), like scripts/ios-store-register.py. JWTs and key material are never printed.
Listing text is the approved copy in apps/ios/store/app-store-metadata.md.
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_ID = "6831992308"
LOCALE = "en-GB"
DEFAULT_SCREENSHOTS = ROOT / "apps/ios/store/screenshots"
# Screenshot slots, and the pixel sizes App Store Connect accepts in each (portrait or landscape).
IPHONE = "APP_IPHONE_67"  # the 6.9-inch (and 6.7-inch) iPhone slot; Apple scales it for smaller iPhones
IPAD = "APP_IPAD_PRO_3GEN_129"  # the 13-inch iPad slot; Apple scales it for smaller iPads
SCREENSHOT_SIZES = {
    IPHONE: {(1320, 2868), (1290, 2796)},
    IPAD: {(2064, 2752), (2048, 2732)},
}
EDITABLE = {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"}

LISTING = {
    "name": "Crow HR",
    "subtitle": "Payslips, leave and clock-in",
    "promotionalText": "Your company's own Crow HR, on your phone. Check payslips, apply for leave and clock in, even without signal.",
    "description": (
        "Crow HR is the free, open-source HR and payroll system that Singapore companies run on their own server. "
        "This app connects to your company's Crow HR. Ask HR for the address, or scan the QR code in Crow HR on the web.\n"
        "\n"
        "• See your payslips.\n"
        "• Check leave balances and apply for leave.\n"
        "• Clock in and out. With no signal, punches wait on your phone and are sent in order when you're back online.\n"
        "• Make claims with a photo of the receipt.\n"
        "• See your schedule.\n"
        "• Managers approve or reject requests.\n"
        "\n"
        "You sign in with your company's method (email and password, Google, Microsoft, Singpass or your company's "
        "single sign-on) in a secure browser window. The app talks only to your company's server. Crow Tech collects "
        "nothing: no analytics, no tracking, no advertising.\n"
        "\n"
        "Crow HR is made by Crow Tech Pte. Ltd. in Singapore and is MIT licensed."
    ),
    "keywords": "HR,payroll,payslip,leave,clock in,attendance,Singapore,CPF,claims,roster",
    "supportUrl": "https://crow.sg/apps/crow-hr/support/",
    "marketingUrl": "https://crow.sg/apps/crow-hr/",
    "privacyPolicyUrl": "https://crow.sg/apps/crow-hr/privacy/",
    "copyright": "2026 Crow Tech Pte. Ltd.",
    "primaryCategory": "BUSINESS",
}

# "What's New in This Version", per MARKETING_VERSION. Every update needs it (App Review refuses an
# update without it); the first version can't have it. Keep it in step with app-store-metadata.md.
WHATS_NEW = {
    "1.1.0": (
        "• Leave for a child: the leave types that need one ask which child it is for.\n"
        "• Team calendar: who is away over the next two weeks.\n"
        "• Shift swaps: swap a shift with a colleague or give it away, and pick up open shifts.\n"
        "• Claims with several lines, each in its own currency.\n"
        "• Notifications open the item they are about.\n"
        "• Clock-in keeps the time you tapped, and punches waiting to be sent are no longer lost when iOS "
        "starts the app in the background.\n"
        "• On iPad, approvals open beside the list.\n"
        "• Fixes for sign-in sessions, leave and approvals."
    ),
}


def load_register():
    spec = importlib.util.spec_from_file_location("ios_store_register", Path(__file__).with_name("ios-store-register.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Api:
    """App Store Connect client that renews its 10-minute token as it goes."""

    def __init__(self):
        missing = [n for n in ("APPLE_KEY_ID", "APPLE_ISSUER_ID") if not os.environ.get(n)]
        if not os.environ.get("APPLE_KEY_PATH") and not os.environ.get("APPLE_SIGNING_SECRET_DIR"):
            missing.append("APPLE_KEY_PATH or APPLE_SIGNING_SECRET_DIR")
        if missing:
            raise SystemExit(f"Set {', '.join(missing)} (the App Store Connect API key).")
        self.key_id, self.issuer = os.environ["APPLE_KEY_ID"], os.environ["APPLE_ISSUER_ID"]
        self.key_path = Path(os.environ.get("APPLE_KEY_PATH") or Path(os.environ["APPLE_SIGNING_SECRET_DIR"]) / f"AuthKey_{self.key_id}.p8")
        self.register = load_register()
        self.bearer, self.issued = None, 0.0

    def call(self, path, method="GET", data=None, ok_missing=False):
        if time.time() - self.issued > 480:
            self.bearer, self.issued = self.register.token(self.key_path, self.key_id, self.issuer), time.time()
        req = urllib.request.Request(
            path if path.startswith("https://") else "https://api.appstoreconnect.apple.com" + path,
            data=json.dumps(data).encode() if data is not None else None,
            method=method,
            headers={"Authorization": "Bearer " + self.bearer, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                raw = res.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as err:
            if ok_missing and err.code == 404:
                return None
            try:
                errors = [(e.get("code"), e.get("title"), e.get("detail"), (e.get("source") or {}).get("pointer"))
                          for e in json.load(err).get("errors", [])]
            except ValueError:
                errors = []
            raise ApiError(f"Apple HTTP {err.code} on {method} {path.split('?')[0]}: {errors}") from None

    def all(self, path):
        out, url = [], path
        while url:
            res = self.call(url)
            out += res.get("data", [])
            url = (res.get("links") or {}).get("next")
        return out


class ApiError(Exception):
    pass


def marketing_version():
    match = re.search(r"^\s*MARKETING_VERSION:\s*'([^']+)'", (ROOT / "apps/ios/project.yml").read_text(), re.M)
    if not match:
        raise SystemExit("MARKETING_VERSION not found in apps/ios/project.yml")
    return match.group(1)


def editable_version(api, version, create):
    versions = api.all(f"/v1/apps/{APP_ID}/appStoreVersions?filter[platform]=IOS&limit=50")
    for v in versions:
        if v["attributes"]["versionString"] == version:
            return v
    editable = [v for v in versions if v["attributes"].get("appStoreState") in EDITABLE]
    if not create:
        return None
    if editable:
        v = editable[0]
        body = {"data": {"type": "appStoreVersions", "id": v["id"], "attributes": {"versionString": version}}}
        print(f"Renamed the editable version {v['attributes']['versionString']} to {version}.")
        return api.call(f"/v1/appStoreVersions/{v['id']}", "PATCH", body)["data"]
    body = {"data": {"type": "appStoreVersions", "attributes": {"platform": "IOS", "versionString": version},
                     "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}}}}
    print(f"Created App Store version {version}.")
    return api.call("/v1/appStoreVersions", "POST", body)["data"]


def version_localization(api, version_id, create):
    locs = api.all(f"/v1/appStoreVersions/{version_id}/appStoreVersionLocalizations")
    loc = next((l for l in locs if l["attributes"]["locale"] == LOCALE), None)
    if loc is None and create:
        body = {"data": {"type": "appStoreVersionLocalizations", "attributes": {"locale": LOCALE},
                         "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": version_id}}}}}
        loc = api.call("/v1/appStoreVersionLocalizations", "POST", body)["data"]
    return loc


def editable_app_info(api):
    infos = api.all(f"/v1/apps/{APP_ID}/appInfos")
    live = {"READY_FOR_DISTRIBUTION", "READY_FOR_SALE"}
    return next((i for i in infos if (i["attributes"].get("appStoreState") or i["attributes"].get("state")) not in live), infos[0])


AGE_BOOLEANS = {"gambling", "unrestrictedWebAccess", "lootBox", "messagingAndChat", "parentalControls", "ageAssurance",
                "userGeneratedContent", "advertising", "healthOrWellnessTopics", "socialMedia", "seventeenPlus",
                "gamblingAndContests"}
AGE_LEVELS = {"alcoholTobaccoOrDrugUseOrReferences", "contests", "gamblingSimulated", "gunsOrOtherWeapons",
              "medicalOrTreatmentInformation", "profanityOrCrudeHumor", "sexualContentGraphicAndNudity",
              "sexualContentOrNudity", "horrorOrFearThemes", "matureOrSuggestiveThemes", "violenceCartoonOrFantasy",
              "violenceRealistic", "violenceRealisticProlongedGraphicOrSadistic"}


def age_rating(api, info_id, write):
    decl = api.call(f"/v1/appInfos/{info_id}/ageRatingDeclaration", ok_missing=True)
    if not decl or not decl.get("data"):
        return None
    decl = decl["data"]
    attrs = decl["attributes"]
    if write:
        wanted = {}
        for key, value in attrs.items():
            if key in AGE_LEVELS:
                wanted[key] = "NONE"
            elif key in AGE_BOOLEANS and key not in {"seventeenPlus", "gamblingAndContests"}:
                wanted[key] = False
        unknown = sorted(k for k in attrs if k not in AGE_LEVELS | AGE_BOOLEANS)
        if unknown:
            print(f"Age rating fields left as they are (not a yes/no or none question): {unknown}")
        body = {"data": {"type": "ageRatingDeclarations", "id": decl["id"], "attributes": wanted}}
        try:
            decl = api.call(f"/v1/ageRatingDeclarations/{decl['id']}", "PATCH", body)["data"]
        except ApiError as e:
            print(f"Age rating not set: {e}")
    return decl["attributes"]


def free_everywhere(api, write):
    report = {}
    schedule = api.call(f"/v1/apps/{APP_ID}/appPriceSchedule?include=manualPrices,baseTerritory", ok_missing=True)
    prices = [i for i in (schedule or {}).get("included", []) if i["type"] == "appPrices"]
    report["priceSchedule"] = bool(schedule and schedule.get("data"))
    report["manualPrices"] = len(prices)
    if write and not prices:
        points = api.all(f"/v1/apps/{APP_ID}/appPricePoints?filter[territory]=USA&limit=200")
        free = next((p for p in points if float(p["attributes"]["customerPrice"]) == 0.0), None)
        if not free:
            print("No free price point found; price not set.")
        else:
            body = {
                "data": {"type": "appPriceSchedules",
                         "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}},
                                           "baseTerritory": {"data": {"type": "territories", "id": "USA"}},
                                           "manualPrices": {"data": [{"type": "appPrices", "id": "${free}"}]}}},
                "included": [{"type": "appPrices", "id": "${free}", "attributes": {"startDate": None},
                              "relationships": {"appPricePoint": {"data": {"type": "appPricePoints", "id": free["id"]}}}}],
            }
            try:
                api.call("/v1/appPriceSchedules", "POST", body)
                print("Set the price to free (base territory USA, applied to every territory).")
                report["manualPrices"] = 1
            except ApiError as e:
                print(f"Price not set: {e}")
    availability = api.call(f"/v1/apps/{APP_ID}/appAvailabilityV2", ok_missing=True)
    if availability and availability.get("data"):
        a = availability["data"]
        territories = api.all(f"/v2/appAvailabilities/{a['id']}/territoryAvailabilities?limit=200")
        report["availability"] = {"availableInNewTerritories": a["attributes"].get("availableInNewTerritories"),
                                  "territories": len(territories),
                                  "available": sum(1 for t in territories if t["attributes"].get("available"))}
    elif write:
        territories = api.all("/v1/territories?limit=200")
        refs = [{"type": "territoryAvailabilities", "id": f"${{{t['id']}}}"} for t in territories]
        body = {
            "data": {"type": "appAvailabilities", "attributes": {"availableInNewTerritories": True},
                     "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}},
                                       "territoryAvailabilities": {"data": refs}}},
            "included": [{"type": "territoryAvailabilities", "id": f"${{{t['id']}}}", "attributes": {"available": True},
                          "relationships": {"territory": {"data": {"type": "territories", "id": t["id"]}}}}
                         for t in territories],
        }
        try:
            api.call("/v2/appAvailabilities", "POST", body)
            print(f"Made the app available in all {len(territories)} territories and in new ones.")
            report["availability"] = {"availableInNewTerritories": True, "territories": len(territories)}
        except ApiError as e:
            print(f"Availability not set: {e}")
            report["availability"] = None
    else:
        report["availability"] = None
    return report


def png_size(path):
    data = Path(path).read_bytes()[:24]
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def screenshot_sets(folder):
    """The sets in `folder`: its PNGs for the iPhone slot and, if present, ipad/*.png for the iPad
    slot, each in file-name order."""
    folder = Path(folder)
    sets = [(IPHONE, sorted(folder.glob("*.png")))]
    ipad = sorted((folder / "ipad").glob("*.png"))
    if ipad:
        sets.append((IPAD, ipad))
    return sets


def screenshot_problems(sets):
    problems = []
    for display, files in sets:
        if not 1 <= len(files) <= 10:
            problems.append(f"{display}: expected 1 to 10 PNG screenshots, found {len(files)}")
        for f in files:
            size = png_size(f)
            w, h = size or (0, 0)
            if size is None:
                problems.append(f"{display}: {f.name} is not a PNG")
            elif (min(w, h), max(w, h)) not in SCREENSHOT_SIZES[display]:
                allowed = " or ".join(f"{a} x {b}" for a, b in sorted(SCREENSHOT_SIZES[display]))
                problems.append(f"{display}: {f.name} is {w} x {h}, expected {allowed} (portrait or landscape)")
    return problems


def check_screenshots(folder):
    sets = screenshot_sets(folder)
    for display, files in sets:
        print(f"{display}: {len(files)} screenshot(s)")
        for f in files:
            w, h = png_size(f) or (0, 0)
            print(f"  {f.relative_to(ROOT) if f.is_relative_to(ROOT) else f}  {w} x {h}")
    problems = screenshot_problems(sets)
    for problem in problems:
        print(f"PROBLEM {problem}")
    return sets, problems


def screenshot_set(api, loc_id, display, create):
    sets = api.all(f"/v1/appStoreVersionLocalizations/{loc_id}/appScreenshotSets")
    s = next((x for x in sets if x["attributes"]["screenshotDisplayType"] == display), None)
    if s is None and create:
        body = {"data": {"type": "appScreenshotSets", "attributes": {"screenshotDisplayType": display},
                         "relationships": {"appStoreVersionLocalization": {"data": {"type": "appStoreVersionLocalizations", "id": loc_id}}}}}
        s = api.call("/v1/appScreenshotSets", "POST", body)["data"]
    return s


def upload_screenshots(api, loc_id, display, files):
    """Makes the `display` set match `files` in name order. Screenshots already processed with the
    same file name and checksum are kept; anything else (other files, or uploads Apple never
    finished processing) is deleted and uploaded again. Run it again if one stays UPLOAD_COMPLETE."""
    print(f"{display}:")
    s = screenshot_set(api, loc_id, display, create=True)
    wanted = {f.name: hashlib.md5(f.read_bytes()).hexdigest() for f in files}
    kept = {}
    for old in api.all(f"/v1/appScreenshotSets/{s['id']}/appScreenshots"):
        a = old["attributes"]
        done = (a.get("assetDeliveryState") or {}).get("state") == "COMPLETE"
        if done and wanted.get(a.get("fileName")) == a.get("sourceFileChecksum") and a.get("fileName") not in kept:
            kept[a["fileName"]] = old["id"]
        else:
            api.call(f"/v1/appScreenshots/{old['id']}", "DELETE")
    ids = {}
    for f in files:
        if f.name in kept:
            ids[f.name] = kept[f.name]
            continue
        data = f.read_bytes()
        body = {"data": {"type": "appScreenshots", "attributes": {"fileName": f.name, "fileSize": len(data)},
                         "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": s["id"]}}}}}
        shot = api.call("/v1/appScreenshots", "POST", body)["data"]
        for op in shot["attributes"]["uploadOperations"]:
            chunk = data[op["offset"]: op["offset"] + op["length"]]
            headers = {h["name"]: h["value"] for h in op.get("requestHeaders", [])}
            req = urllib.request.Request(op["url"], data=chunk, method=op["method"], headers=headers)
            with urllib.request.urlopen(req, timeout=120):
                pass
        body = {"data": {"type": "appScreenshots", "id": shot["id"],
                         "attributes": {"uploaded": True, "sourceFileChecksum": wanted[f.name]}}}
        api.call(f"/v1/appScreenshots/{shot['id']}", "PATCH", body)
        ids[f.name] = shot["id"]
        print(f"Uploaded {f.name}.")
    # Show them in file-name order.
    order = {"data": [{"type": "appScreenshots", "id": ids[f.name]} for f in files]}
    api.call(f"/v1/appScreenshotSets/{s['id']}/relationships/appScreenshots", "PATCH", order)
    deadline = time.time() + 300
    while time.time() < deadline:
        shots = api.all(f"/v1/appScreenshotSets/{s['id']}/appScreenshots")
        if all((x["attributes"].get("assetDeliveryState") or {}).get("state") in ("COMPLETE", "FAILED") for x in shots):
            break
        time.sleep(10)
    for x in api.all(f"/v1/appScreenshotSets/{s['id']}/appScreenshots"):
        d = x["attributes"].get("assetDeliveryState") or {}
        print(f"  {x['attributes'].get('fileName')}: {d.get('state')} {d.get('errors') or ''}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["status", "apply", "screenshots", "check-screenshots", "attach-build"])
    parser.add_argument("arg", nargs="?")
    args = parser.parse_args()
    if args.action in ("screenshots", "check-screenshots"):
        # Offline first: never upload a set App Store Connect would refuse.
        sets, problems = check_screenshots(args.arg or DEFAULT_SCREENSHOTS)
        if problems:
            raise SystemExit("Screenshots not uploaded: fix the problems above.")
        if args.action == "check-screenshots":
            return
    api = Api()
    version = marketing_version()
    write = args.action == "apply"

    v = editable_version(api, version, create=write)
    if v is None:
        versions = api.all(f"/v1/apps/{APP_ID}/appStoreVersions?filter[platform]=IOS&limit=50")
        print(json.dumps([{"id": x["id"], **{k: x["attributes"].get(k) for k in ("versionString", "appStoreState")}} for x in versions], indent=2))
        raise SystemExit(f"No App Store version {version} yet: `apply` creates it (or renames the editable one).")
    loc = version_localization(api, v["id"], create=write)
    info = editable_app_info(api)
    info_locs = api.all(f"/v1/appInfos/{info['id']}/appInfoLocalizations")
    info_loc = next((l for l in info_locs if l["attributes"]["locale"] == LOCALE), None)

    if write:
        body = {"data": {"type": "appStoreVersions", "id": v["id"], "attributes": {"copyright": LISTING["copyright"]}}}
        v = api.call(f"/v1/appStoreVersions/{v['id']}", "PATCH", body)["data"]
        fields = {k: LISTING[k] for k in ("description", "keywords", "promotionalText", "supportUrl", "marketingUrl")}
        if version in WHATS_NEW:
            fields["whatsNew"] = WHATS_NEW[version]
        body = {"data": {"type": "appStoreVersionLocalizations", "id": loc["id"], "attributes": fields}}
        try:
            api.call(f"/v1/appStoreVersionLocalizations/{loc['id']}", "PATCH", body)
        except ApiError as e:
            # Apple checks the URLs; retry without one it refuses, and say which.
            print(f"Listing text with URLs refused ({e}); retrying without the marketing URL.")
            fields.pop("marketingUrl")
            api.call(f"/v1/appStoreVersionLocalizations/{loc['id']}", "PATCH",
                     {"data": {"type": "appStoreVersionLocalizations", "id": loc["id"], "attributes": fields}})
        fields = {k: LISTING[k] for k in ("name", "subtitle", "privacyPolicyUrl")}
        if info_loc is None:
            info_loc = api.call("/v1/appInfoLocalizations", "POST", {"data": {
                "type": "appInfoLocalizations", "attributes": {"locale": LOCALE, **fields},
                "relationships": {"appInfo": {"data": {"type": "appInfos", "id": info["id"]}}}}})["data"]
        else:
            api.call(f"/v1/appInfoLocalizations/{info_loc['id']}", "PATCH",
                     {"data": {"type": "appInfoLocalizations", "id": info_loc["id"], "attributes": fields}})
        api.call(f"/v1/appInfos/{info['id']}", "PATCH", {"data": {
            "type": "appInfos", "id": info["id"],
            "relationships": {"primaryCategory": {"data": {"type": "appCategories", "id": LISTING["primaryCategory"]}}}}})
        print("Set the listing text, URLs, copyright and category" + (" and What's New." if version in WHATS_NEW else "."))

    if args.action == "screenshots":
        for display, files in sets:
            upload_screenshots(api, loc["id"], display, files)
    if args.action == "attach-build":
        number = args.arg or ""
        q = urllib.parse.urlencode({"filter[app]": APP_ID, "filter[version]": number, "filter[preReleaseVersion.version]": version})
        builds = api.all(f"/v1/builds?{q}")
        if not builds:
            raise SystemExit(f"Build {number} of {version} is not in App Store Connect yet.")
        b = builds[0]
        if b["attributes"].get("processingState") != "VALID":
            raise SystemExit(f"Build {number} is {b['attributes'].get('processingState')}, not VALID yet.")
        api.call(f"/v1/appStoreVersions/{v['id']}/relationships/build", "PATCH", {"data": {"type": "builds", "id": b["id"]}})
        print(f"Attached build {number} to version {version}.")

    # Read back everything (also after apply).
    v = api.call(f"/v1/appStoreVersions/{v['id']}?include=build")["data"]
    build = api.call(f"/v1/appStoreVersions/{v['id']}/build", ok_missing=True)
    loc_now = api.call(f"/v1/appStoreVersionLocalizations/{loc['id']}")["data"]["attributes"] if loc else {}
    info = api.call(f"/v1/appInfos/{info['id']}?include=primaryCategory")["data"]
    info_loc_now = api.call(f"/v1/appInfoLocalizations/{info_loc['id']}")["data"]["attributes"] if info_loc else {}
    shots = {}
    for display in (IPHONE, IPAD):
        s = screenshot_set(api, loc["id"], display, create=False) if loc else None
        shots[display] = [{"file": x["attributes"].get("fileName"), "state": (x["attributes"].get("assetDeliveryState") or {}).get("state"),
                           "size": [(x["attributes"].get("imageAsset") or {}).get("width"), (x["attributes"].get("imageAsset") or {}).get("height")]}
                          for x in api.all(f"/v1/appScreenshotSets/{s['id']}/appScreenshots")] if s else []
    out = {
        "app": APP_ID,
        "version": {"id": v["id"], "versionString": v["attributes"]["versionString"], "state": v["attributes"].get("appStoreState"),
                    "copyright": v["attributes"].get("copyright"), "releaseType": v["attributes"].get("releaseType")},
        "build": ({"number": build["data"]["attributes"].get("version"), "processingState": build["data"]["attributes"].get("processingState"),
                   "usesNonExemptEncryption": build["data"]["attributes"].get("usesNonExemptEncryption")}
                  if build and build.get("data") else None),
        "listing": {k: loc_now.get(k) for k in ("locale", "description", "keywords", "promotionalText", "supportUrl", "marketingUrl", "whatsNew")},
        "appInfo": {"name": info_loc_now.get("name"), "subtitle": info_loc_now.get("subtitle"),
                    "privacyPolicyUrl": info_loc_now.get("privacyPolicyUrl"),
                    "primaryCategory": ((info.get("relationships") or {}).get("primaryCategory") or {}).get("data")},
        "ageRating": age_rating(api, info["id"], write),
        "pricing": free_everywhere(api, write),
        "screenshots": shots,
    }
    if out["listing"].get("description"):
        out["listing"]["description"] = out["listing"]["description"][:80] + "…"
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    try:
        main()
    except ApiError as e:
        sys.exit(str(e))
