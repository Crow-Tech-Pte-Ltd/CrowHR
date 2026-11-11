#!/usr/bin/env python3
"""App Review for Crow HR through the App Store Connect API: the review contact and demo account,
the content rights declaration, territories, and the submission itself.

  status                     read-only: which App Review fields are set (never their values), the
                             content rights declaration, unavailable territories, open submissions
  review-details             set the App Review contact, demo account and reviewer notes on the
                             editable version. Reads one JSON object on stdin with demoAccountName,
                             demoAccountPassword, managerEmail, managerPassword and either
                             contactFirstName, contactLastName, contactPhone, contactEmail or
                             nothing plus --contact-from-team (reuse the App Review contact of the
                             team's most recent other app). Values are never printed.
  content-rights             declare that the app shows no third-party content
  exclude TERRITORIES        make the app unavailable in TERRITORIES (comma separated, e.g. CHN)
  submit --build N --yes     submit the editable version for App Review, refusing unless build N is
                             the attached, VALID build and the review details are complete

The App Privacy answers ("Data Not Collected") have no public API: set them in the web UI.
Same API key setup as scripts/ios-store-listing.py (APPLE_KEY_ID, APPLE_ISSUER_ID and APPLE_KEY_PATH
or APPLE_SIGNING_SECRET_DIR). JWTs, key material and the review credentials are never printed.
"""
import argparse
import importlib.util
import json
import sys
from pathlib import Path


def load_listing():
    spec = importlib.util.spec_from_file_location("ios_store_listing", Path(__file__).with_name("ios-store-listing.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


listing = load_listing()
APP_ID = listing.APP_ID
CONTACT = ("contactFirstName", "contactLastName", "contactPhone", "contactEmail")
DEMO = ("demoAccountName", "demoAccountPassword")
SUBMITTABLE = {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED"}

NOTES = """Crow HR connects to a company's own Crow HR server; Crow Tech runs no service for the app. For review we run a demo server with a fictional company, Kopi Kaki Pte. Ltd. All data is fictional.

1. Connect: enter the server address hr-demo.crow.sg and tap Continue. The server hosts more than one organisation, so the app asks for an Organisation ID: enter kopi-kaki, tap Continue, then Connect.
2. Tap Sign in and sign in on the web page that opens (iOS may first ask to continue). Employee (Hafiz): the demo account above. Manager (Siti): {manager_email} / {manager_password}
3. As the employee: payslips, leave balances and applying for leave, clock in and out, claims with a receipt photo, and the work schedule. As the manager: Approvals has pending leave and claims from the team; leave the employee applies for appears there too.

The app collects no data: no analytics, crash reporting, tracking or advertising, and it talks only to the server the user connects to. The camera scans the company's connection QR code and photographs receipts; location is sent with a clock-in only when the company requires it (Kopi Kaki doesn't); Face ID unlocks the app only if the user turns it on."""


def editable_version(api):
    v = listing.editable_version(api, listing.marketing_version(), create=False)
    if v is None:
        raise SystemExit(f"No App Store version {listing.marketing_version()} yet: run ios-store-listing.py apply first.")
    return v


def review_detail(api, version_id):
    res = api.call(f"/v1/appStoreVersions/{version_id}/appStoreReviewDetail", ok_missing=True)
    return res["data"] if res and res.get("data") else None


def team_contact(api):
    """The App Review contact of the team's most recently created other app that has a full one."""
    apps = [a for a in api.all("/v1/apps?limit=200&fields[apps]=name") if a["id"] != APP_ID]
    for app in sorted(apps, key=lambda a: int(a["id"]), reverse=True):
        for v in api.all(f"/v1/apps/{app['id']}/appStoreVersions?limit=10&fields[appStoreVersions]=versionString"):
            detail = review_detail(api, v["id"])
            attrs = (detail or {}).get("attributes") or {}
            if all(attrs.get(k) for k in CONTACT):
                print(f"Using the App Review contact of {app['attributes'].get('name')!r}.")
                return {k: attrs[k] for k in CONTACT}
    raise SystemExit("No other app in the team has a complete App Review contact: pass it on stdin.")


def set_review_details(api, version, payload, contact_from_team):
    contact = team_contact(api) if contact_from_team else {k: payload.get(k) for k in CONTACT}
    missing = [k for k in CONTACT if not contact.get(k)] + [k for k in (*DEMO, "managerEmail", "managerPassword") if not payload.get(k)]
    if missing:
        raise SystemExit(f"Missing on stdin: {', '.join(missing)}")
    notes = NOTES.format(manager_email=payload["managerEmail"], manager_password=payload["managerPassword"])
    attrs = {**contact, "demoAccountRequired": True, "demoAccountName": payload["demoAccountName"],
             "demoAccountPassword": payload["demoAccountPassword"], "notes": notes}
    detail = review_detail(api, version["id"])
    if detail:
        api.call(f"/v1/appStoreReviewDetails/{detail['id']}", "PATCH",
                 {"data": {"type": "appStoreReviewDetails", "id": detail["id"], "attributes": attrs}})
    else:
        api.call("/v1/appStoreReviewDetails", "POST", {"data": {
            "type": "appStoreReviewDetails", "attributes": attrs,
            "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": version["id"]}}}}})
    print("Set the App Review contact, demo account and notes.")


def territory_availabilities(api):
    availability = api.call(f"/v1/apps/{APP_ID}/appAvailabilityV2", ok_missing=True)
    if not availability or not availability.get("data"):
        raise SystemExit("The app has no availability yet: run ios-store-listing.py apply first.")
    out, url = [], f"/v2/appAvailabilities/{availability['data']['id']}/territoryAvailabilities?include=territory&limit=200"
    while url:
        res = api.call(url)
        out += [(t["relationships"]["territory"]["data"]["id"], t) for t in res.get("data", [])]
        url = (res.get("links") or {}).get("next")
    return out


def exclude(api, territories):
    wanted = {t.strip().upper() for t in territories.split(",") if t.strip()}
    found = dict(territory_availabilities(api))
    unknown = sorted(wanted - found.keys())
    if unknown:
        raise SystemExit(f"Unknown territories: {unknown}")
    for code in sorted(wanted):
        if found[code]["attributes"].get("available"):
            api.call(f"/v1/territoryAvailabilities/{found[code]['id']}", "PATCH",
                     {"data": {"type": "territoryAvailabilities", "id": found[code]["id"], "attributes": {"available": False}}})
            print(f"Made the app unavailable in {code}.")
        else:
            print(f"Already unavailable in {code}.")


def open_submissions(api):
    q = f"/v1/reviewSubmissions?filter[app]={APP_ID}&filter[platform]=IOS&limit=50"
    return [s for s in api.all(q) if s["attributes"].get("state") not in {"COMPLETE"}]


def status(api, version):
    detail = review_detail(api, version["id"])
    attrs = (detail or {}).get("attributes") or {}
    app = api.call(f"/v1/apps/{APP_ID}")["data"]["attributes"]
    build = api.call(f"/v1/appStoreVersions/{version['id']}/build", ok_missing=True)
    build = build["data"]["attributes"] if build and build.get("data") else {}
    return {
        "version": {"id": version["id"], "versionString": version["attributes"]["versionString"],
                    "state": version["attributes"].get("appStoreState"),
                    "build": build.get("version"), "buildState": build.get("processingState")},
        "reviewDetail": {k: bool(attrs.get(k)) for k in (*CONTACT, *DEMO, "notes")} | {"demoAccountRequired": attrs.get("demoAccountRequired")},
        "contentRightsDeclaration": app.get("contentRightsDeclaration"),
        "unavailableTerritories": sorted(code for code, t in territory_availabilities(api) if not t["attributes"].get("available")),
        "openSubmissions": [{"id": s["id"], "state": s["attributes"].get("state")} for s in open_submissions(api)],
    }


def submit(api, version, build_number):
    report = status(api, version)
    problems = []
    if report["version"]["state"] not in SUBMITTABLE:
        problems.append(f"version state is {report['version']['state']}")
    if str(report["version"]["build"]) != str(build_number) or report["version"]["buildState"] != "VALID":
        problems.append(f"attached build is {report['version']['build']} ({report['version']['buildState']}), not VALID build {build_number}")
    if not all(report["reviewDetail"][k] for k in (*CONTACT, *DEMO, "notes")):
        problems.append("App Review contact, demo account or notes incomplete")
    if not report["contentRightsDeclaration"]:
        problems.append("content rights not declared")
    if problems:
        raise SystemExit("Not submitting: " + "; ".join(problems))
    ready = [s for s in open_submissions(api) if s["attributes"].get("state") == "READY_FOR_REVIEW"]
    if ready:
        sub = ready[0]
    else:
        sub = api.call("/v1/reviewSubmissions", "POST", {"data": {
            "type": "reviewSubmissions", "attributes": {"platform": "IOS"},
            "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}}}})["data"]
    items = api.all(f"/v1/reviewSubmissions/{sub['id']}/items?include=appStoreVersion")
    if not any(((i.get("relationships") or {}).get("appStoreVersion") or {}).get("data", {}).get("id") == version["id"] for i in items):
        api.call("/v1/reviewSubmissionItems", "POST", {"data": {
            "type": "reviewSubmissionItems",
            "relationships": {"reviewSubmission": {"data": {"type": "reviewSubmissions", "id": sub["id"]}},
                              "appStoreVersion": {"data": {"type": "appStoreVersions", "id": version["id"]}}}}})
    sub = api.call(f"/v1/reviewSubmissions/{sub['id']}", "PATCH",
                   {"data": {"type": "reviewSubmissions", "id": sub["id"], "attributes": {"submitted": True}}})["data"]
    print(f"Submitted version {version['attributes']['versionString']} (build {build_number}) for App Review: "
          f"submission {sub['id']}, state {sub['attributes'].get('state')}.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["status", "review-details", "content-rights", "exclude", "submit"])
    parser.add_argument("arg", nargs="?")
    parser.add_argument("--contact-from-team", action="store_true")
    parser.add_argument("--build")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()
    api = listing.Api()
    version = editable_version(api)

    if args.action == "review-details":
        set_review_details(api, version, json.load(sys.stdin), args.contact_from_team)
    elif args.action == "content-rights":
        api.call(f"/v1/apps/{APP_ID}", "PATCH", {"data": {"type": "apps", "id": APP_ID,
                 "attributes": {"contentRightsDeclaration": "DOES_NOT_USE_THIRD_PARTY_CONTENT"}}})
        print("Declared that the app shows no third-party content.")
    elif args.action == "exclude":
        if not args.arg:
            raise SystemExit("Name the territories, e.g. `exclude CHN`.")
        exclude(api, args.arg)
    elif args.action == "submit":
        if not args.build or not args.yes:
            raise SystemExit("Submitting is irreversible: pass --build N (the attached build) and --yes.")
        submit(api, version, args.build)
    print(json.dumps(status(api, version), indent=2))


if __name__ == "__main__":
    try:
        main()
    except listing.ApiError as e:
        raise SystemExit(str(e)) from None
