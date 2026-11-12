# Crow HR for iOS: App Store metadata

The copy below is what `scripts/ios-store-listing.py` sets through the App Store Connect API;
change it here and in that script's `LISTING` together. App Store Connect app record: "Crow HR",
English (U.K.), SKU `CROW-HR`, bundle id `crowtech.crowhr` (registered with Apple; read-back in
`apple-resources.json`). Apple's API cannot create an app record: that was done once in the web UI.
The release record (uploaded builds, their IPA checks and the approvals) is in this directory:
`uploaded-builds.txt`, `build<n>-verification.json` and `approvals/`.

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
- **Devices:** iPhone and iPad. Once a version has shipped with iPad support, no later version can
  drop it. The listing text doesn't name a device, so it fits both.
- **Export compliance:** `ITSAppUsesNonExemptEncryption` is false in Info.plist (HTTPS through
  the system only), so App Store Connect doesn't ask per build.

## What the scripts set, and what is set by hand

Through the API, `scripts/ios-store-listing.py`: `apply` (the version named from
`MARKETING_VERSION`, the listing text and URLs above, category, copyright, age rating answers, the
free price and availability), `screenshots` (both sets) and `attach-build <n>`.
`scripts/ios-store-review.py`: the App Review contact, demo account and notes, content rights,
excluded territories (mainland China, which needs an ICP filing number) and the submission.
Release option: App Store Connect's default, "Automatically release this version" after approval.

Only in the web UI, because the API has no endpoint for it: **App Privacy**, "Data Not Collected"
(below).

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

The reading rests on Apple's definition of collection: data the app sends only to the user's
employer, on the employer's own server, never to the developer or a third party.

## Review notes (for App Review information)

Crow HR is self-hosted, so the reviewer needs a server and an account: the address and a demo
sign-in on a server with fictional data go in App Review information
(`ios-store-review.py review-details`).

Sign-in uses ASWebAuthenticationSession. The camera is used for receipts and the connection QR
code. Location is "while using" only, when the employer's attendance policy asks for it. There is
no remote push: local notifications carry only a count.

## Screenshots

`screenshots/` holds the 6.9-inch iPhone screenshots (1320 x 2868, iPhone 17 Pro Max simulator)
and `screenshots/ipad/` the 13-inch iPad ones (2064 x 2752 portrait, iPad Pro 13-inch (M5)
simulator), real captures of the app against the seeded test server with fictional data, made by
`StoreScreenshotsUITests` (see `apps/ios/README.md`): Today with the schedule, a payslip, leave
balances, a leave application, a claim with its receipt, and a manager's approvals. On the iPad
they show the sidebar, the payslip beside the payslip list and Today's two columns. Apple scales
each set for the smaller sizes of its device. App Store Connect slots: `APP_IPHONE_67` and
`APP_IPAD_PRO_3GEN_129`; `ios-store-listing.py check-screenshots` checks both sets' sizes offline.
Recapture both sets from `main` before uploading a new version's. The icon is generated by
`design/app-icon/make-app-icon.py`.
