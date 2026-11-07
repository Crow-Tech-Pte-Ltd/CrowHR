#!/usr/bin/env python3
"""Registers Crow HR's Apple resources with the App Store Connect API (run on the s5 Mac).

  status           read-only: bundle id + app record for crowtech.crowhr
  register-bundle  create the explicit bundle id crowtech.crowhr (no capabilities) if missing
  create-app       create the App Store Connect app record "Crow HR" if missing (Apple refuses:
                   the record is made in the web UI)
  builds           read-only: uploaded builds, processing state and encryption answer

Uses the Crow Tech team API key kept on the Mac (APPLE_KEY_ID, APPLE_ISSUER_ID, optional
APPLE_KEY_PATH). JWTs and key material are never printed. Nothing is uploaded or submitted.
Writes the read-back to apps/ios/store/apple-resources.json (public ids only).
Owner approval to register: Daniel, 7 Nov 2026 ("yeah register the apps there").
"""
import argparse
import base64
import json
import os
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

IDENTIFIER = "crowtech.crowhr"
NAME = "Crow HR"
SKU = "CROW-HR"
LOCALE = "en-GB"


def b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def jose_signature(der: bytes) -> bytes:
    """OpenSSL's DER ECDSA signature -> JWT's fixed-width ES256 (r || s)."""
    if der[0] != 0x30:
        raise ValueError("Invalid ECDSA signature")
    i = 2 if der[1] < 0x80 else 2 + (der[1] & 0x7F)
    parts = []
    for _ in range(2):
        if der[i] != 0x02:
            raise ValueError("Invalid ECDSA integer")
        n = der[i + 1]
        parts.append(int.from_bytes(der[i + 2 : i + 2 + n], "big").to_bytes(32, "big"))
        i += 2 + n
    return b"".join(parts)


def token(key_path: Path, key_id: str, issuer: str) -> str:
    now = int(time.time())
    header = b64(json.dumps({"alg": "ES256", "kid": key_id, "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64(
        json.dumps({"iss": issuer, "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"}, separators=(",", ":")).encode()
    )
    message = f"{header}.{payload}".encode()
    der = subprocess.run(["openssl", "dgst", "-sha256", "-sign", str(key_path)], input=message, capture_output=True, check=True).stdout
    return f"{message.decode()}.{b64(jose_signature(der))}"


class Apple:
    def __init__(self, bearer: str):
        self.bearer = bearer

    def call(self, path: str, method: str = "GET", data=None):
        req = urllib.request.Request(
            "https://api.appstoreconnect.apple.com" + path,
            data=json.dumps(data).encode() if data is not None else None,
            method=method,
            headers={"Authorization": "Bearer " + self.bearer, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                raw = res.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as err:
            try:
                errors = [(e.get("code"), e.get("title"), e.get("detail")) for e in json.load(err).get("errors", [])]
            except ValueError:
                errors = []
            raise SystemExit(f"Apple HTTP {err.code} on {method} {path.split('?')[0]}: {errors}") from None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=["status", "register-bundle", "create-app", "builds"])
    args = parser.parse_args()
    key_id, issuer = os.environ["APPLE_KEY_ID"], os.environ["APPLE_ISSUER_ID"]
    key_path = Path(os.environ.get("APPLE_KEY_PATH", Path.home() / f"Documents/crow-reader-secrets/AuthKey_{key_id}.p8"))
    api = Apple(token(key_path, key_id, issuer))

    q = urllib.parse.urlencode({"filter[identifier]": IDENTIFIER})
    bundles = [b for b in api.call(f"/v1/bundleIds?{q}")["data"] if b["attributes"]["identifier"] == IDENTIFIER]
    if not bundles and args.action == "register-bundle":
        body = {"data": {"type": "bundleIds", "attributes": {"identifier": IDENTIFIER, "name": NAME, "platform": "IOS"}}}
        bundles = [api.call("/v1/bundleIds", "POST", body)["data"]]
        print(f"Registered bundle id {IDENTIFIER}.")

    q = urllib.parse.urlencode({"filter[bundleId]": IDENTIFIER})
    apps = api.call(f"/v1/apps?{q}")["data"]
    if not apps and args.action == "create-app":
        if not bundles:
            raise SystemExit("Register the bundle id first.")
        body = {
            "data": {
                "type": "apps",
                "attributes": {"bundleId": IDENTIFIER, "name": NAME, "sku": SKU, "primaryLocale": LOCALE},
            }
        }
        apps = [api.call("/v1/apps", "POST", body)["data"]]
        print(f"Created App Store Connect app {NAME}.")

    if args.action == "builds":
        if not apps:
            raise SystemExit("No App Store Connect app record yet.")
        q = urllib.parse.urlencode({"filter[app]": apps[0]["id"], "sort": "-uploadedDate", "limit": 10, "include": "preReleaseVersion"})
        res = api.call(f"/v1/builds?{q}")
        versions = {i["id"]: i["attributes"].get("version") for i in res.get("included", []) if i["type"] == "preReleaseVersions"}
        rows = [
            {
                "id": b["id"],
                "version": versions.get(b["relationships"]["preReleaseVersion"]["data"]["id"]) if b["relationships"].get("preReleaseVersion", {}).get("data") else None,
                "build": b["attributes"].get("version"),
                "processingState": b["attributes"].get("processingState"),
                "usesNonExemptEncryption": b["attributes"].get("usesNonExemptEncryption"),
                "expired": b["attributes"].get("expired"),
                "uploadedDate": b["attributes"].get("uploadedDate"),
            }
            for b in res["data"]
        ]
        print(json.dumps(rows, indent=2))
        return

    report = {
        "bundleId": IDENTIFIER,
        "bundleResourceId": bundles[0]["id"] if bundles else None,
        "bundleName": bundles[0]["attributes"].get("name") if bundles else None,
        "apps": [
            {"id": a["id"], "name": a["attributes"]["name"], "sku": a["attributes"].get("sku"), "primaryLocale": a["attributes"].get("primaryLocale")}
            for a in apps
        ],
        "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    out = Path(__file__).resolve().parents[1] / "apps/ios/store/apple-resources.json"
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
