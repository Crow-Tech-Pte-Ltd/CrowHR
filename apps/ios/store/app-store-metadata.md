# Crow HR for iOS: App Store metadata

Status: **approved.** Daniel approved submitting Crow HR 1.0.0 to the App Store for public release
on 10 Nov 2026 ("Submit both"; approval record `approvals/2026-11-10-app-store-1.0.0.txt`). The
copy below is what `scripts/ios-store-listing.py` sets through the App Store Connect API; change it
here and in that script's `LISTING` together. Nothing has been submitted for App Review yet:
that is done by hand in App Store Connect.

The bundle id `crowtech.crowhr` is registered with Apple (resource `4T7KK78X45`, team Crow Tech
Pte. Ltd., 7 Nov 2026; read-back in `apple-resources.json`). Daniel created the App Store Connect
app record in the web UI on 7 Nov 2026 (Apple's API does not allow creating apps): "Crow HR",
Apple ID `6831992308`, English (U.K.), SKU `CROW-HR`. Builds 2 and 3 (0.1.0) went to internal
TestFlight; build 4 (1.0.0) is the App Store build (`uploaded-builds.txt`).

## Listing

- **Name:** Crow HR
- **Subtitle:** Payslips, leave and clock-in
- **Category:** Business (primary; no secondary)
- **Price:** Free, available in every territory and in new territories as Apple adds them
- **Promotional text:** Your company's own Crow HR, on your phone. Check payslips, apply for leave and clock in, even without signal.
- **Description:**
  Crow HR is the free, open-source HR and payroll system that Singapore companies run on their own server. This app connects to your company's Crow HR. Ask HR for the address, or scan the QR code in Crow HR on the web.
  - See your payslips.
  - Check leave balances and apply for leave.
  - Clock in and out. With no signal, punches wait on your phone and are sent in order when you're back online.
  - Make claims with a photo of the receipt.
  - See your schedule.
  - Managers approve or reject requests.
  You sign in with your company's method (email and password, Google, Microsoft, Singpass or your company's single sign-on) in a secure browser window. The app talks only to your company's server. Crow Tech collects nothing: no analytics, no tracking, no advertising.
  Crow HR is made by Crow Tech Pte. Ltd. in Singapore and is MIT licensed.
- **Keywords:** HR,payroll,payslip,leave,clock in,attendance,Singapore,CPF,claims,roster
- **Support URL:** https://crow.sg/apps/crow-hr/support/
- **Marketing URL:** https://crow.sg/apps/crow-hr/
- **Privacy policy URL:** https://crow.sg/apps/crow-hr/privacy/
- **Copyright:** 2026 Crow Tech Pte. Ltd.
- **Age rating:** every content question "None", every capability question "No" (no web
  browser, user-generated content, messaging, social media, advertising, gambling, loot boxes,
  health topics, parental controls or age assurance). Apple computes the rating from these answers.
- **Devices:** iPhone only. On iPad the app runs in iPhone compatibility mode.
- **Export compliance:** `ITSAppUsesNonExemptEncryption` is false in Info.plist (HTTPS through
  the system only), so App Store Connect doesn't ask per build.

## Set in App Store Connect (10 Nov 2026)

Through the API (`scripts/ios-store-listing.py apply`, `screenshots`, `attach-build`): version
1.0.0 (the editable "1.0" version renamed), the listing text and URLs above, category, copyright,
age rating answers, the free price and availability in all 175 territories, the 6.9-inch iPhone
screenshots, and the build. Release option: App Store Connect's default, "Automatically release
this version" after approval.

Left for the web UI, by hand:

- **App Review information:** contact name, phone and email, sign-in required (yes), and the demo
  account on a reviewer server with fictional data, plus the review notes below.
- **App Privacy:** "Data Not Collected" (below). The API has no endpoint for these answers.
- **Content rights** ("Does your app contain, show, or access third-party content?").
- **Submit for Review.**

## App Privacy ("nutrition label")

**Data Not Collected.** Answer "No, we do not collect data from this app".

Why that's accurate:

- The developer (Crow Tech) receives nothing. Every request goes to the employer's own server, at
  the address the user enters. The UI tests prove this by recording every connection the app makes.
- There are no third-party SDKs: no analytics, crash reporting or advertising.
- The privacy manifest (`CrowHR/Resources/PrivacyInfo.xcprivacy`) declares no tracking, no
  tracking domains and no collected data types. Its required-reason APIs are:
  - UserDefaults, CA92.1;
  - system boot time, 35F9.1. Elapsed time is measured between a clock-in tap and its send.

Open question, already flagged in the design's Risks: Apple's definition of data a "third party"
collects, when data goes to the user's employer.

## Review notes (draft for App Review information)

Crow HR is self-hosted, so the reviewer needs a server and an account: a reviewer server with
fictional data (being set up separately), whose address and demo sign-in go in App Review
information.

Sign-in uses ASWebAuthenticationSession. The camera is used for receipts and the connection QR
code. Location is "while using" only, when the employer's attendance policy asks for it. There is
no remote push.

## Screenshots

`screenshots/` holds the 6.9-inch iPhone screenshots (1320 x 2868, iPhone 17 Pro Max simulator),
real captures of the app against the seeded test server with fictional data, made by
`StoreScreenshotsUITests` (see `apps/ios/README.md`): Today with the schedule, a payslip, leave
balances, a leave application, a claim with its receipt, and a manager's approvals. Apple scales
them for the smaller iPhone sizes. No iPad screenshots: the app is iPhone only. The icon is
generated by `design/app-icon/make-app-icon.py`.
