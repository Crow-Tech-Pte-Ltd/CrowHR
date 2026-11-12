---
title: Mobile apps
description: Native iOS and Android apps for Crow HR. Version 1.0.0 is on Google Play; the iPhone and iPad app is in App Store review. How connecting a phone to your company's server works.
---

<span class="crow-pill crow-pill--soon">iPhone and iPad: coming soon</span>

Native iOS (SwiftUI, `apps/ios`) and Android (Kotlin and Jetpack Compose, `apps/android`) apps are built and tested against a real Crow HR server. Version 1.0.0 for Android is on [Google Play](https://play.google.com/store/apps/details?id=crowtech.crowhr). The iPhone and iPad app is in App Store review, so it is **not in the App Store yet**; until it is, the web app works on phones, with a bottom tab bar for employees. The iOS app is for iPhone and iPad: on an iPad it shows a sidebar in landscape and can share the screen in Split View, Slide Over and Stage Manager.

The apps cover what employees and managers do most: payslips, leave, clock in and out (also offline), claims with a photo of the receipt, your schedule, approvals and notifications. Everything else stays on the web.

## How the apps connect

The apps connect only to your company's own Crow HR server. Crow Tech runs no server for them, and they collect no data: no analytics, crash reporting or third-party SDKs.

Each person finds their connection code in **My profile → Mobile app**:

- a **QR code** to scan with the app. It holds `crowhr://connect?server=<your PUBLIC_URL>&org=<organisation>` and nothing else: no password, session or token, so it is safe to show on screen or print for a notice board;
- the **server address** (your `PUBLIC_URL`) to type into the app instead, with a copy button, and the organisation's short name;
- the store listings: a link to Google Play, and the App Store marked "coming soon" until the iPhone app is published.

If you type the address and the server hosts more than one organisation, the app also asks for the organisation's short name (its ID). The app then checks the server, shows your organisation's name for you to confirm, and signs you in through your phone's browser with the same methods you use on the web (password, Google, Microsoft, Singpass or your identity provider).

The app needs HTTPS. On a plain-HTTP server (a LAN install without a certificate), My profile says so: the app will connect over HTTP only to a private network address or a `.local` name, after warning that the connection is not encrypted. See [reverse proxy](/docs/self-hosting/reverse-proxy/) to add HTTPS.

On Android 17 and later, connecting to a server on your office network (a private address such as `192.168.1.20`) also needs the **local network** permission; the app asks for it before connecting. A server with a public HTTPS address needs no extra permission.

## Clocking in offline

A clock-in made without signal is saved on the phone and sent when it reconnects. The app sends the tap time and how long ago the tap was, measured by the phone's own timer, which changing the phone's clock doesn't affect. So the server records the real time even if the clock was changed while offline, flags a wrong phone clock as clock skew, and marks punches that arrive more than 10 minutes late as sent late. Punches more than 7 days old are refused, as on the web; the app keeps them visible with the server's reason so a manager can add the time to the timesheet.

The server side the apps use is part of every install: native sign-in with PKCE and device sessions (listed in **My sessions**, where you can sign a device out), `GET /api/v1/meta` for the organisation's name, logo, sign-in methods and features, and `GET /api/v1/notifications?since=<cursor>` for background refresh ([API conventions](/docs/developers/api-conventions/#new-notifications-since-a-cursor)). The apps check the server's features rather than its version, so they keep working with servers older than the app.
