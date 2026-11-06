---
title: Mobile apps
description: Native iOS and Android apps for Crow HR are being built and are not in the app stores yet. How connecting a phone to your company's server works.
sidebar:
  badge:
    text: Soon
    variant: note
---

<span class="crow-pill crow-pill--soon">Coming soon</span>

Native iOS (SwiftUI) and Android (Kotlin) apps are in development (`openspec/changes/add-mobile-apps`) and are **not published** in the App Store or Google Play yet. Until then, the web app works on phones, with a bottom tab bar for employees.

## How the apps will connect

The apps connect only to your company's own Crow HR server. Crow Tech runs no server for them, and they collect no data: no analytics, crash reporting or third-party SDKs.

Each person finds their connection code in **My profile → Mobile app**:

- a **QR code** to scan with the app. It holds `crowhr://connect?server=<your PUBLIC_URL>&org=<organisation>` and nothing else: no password, session or token, so it is safe to show on screen or print for a notice board;
- the **server address** (your `PUBLIC_URL`) to type into the app instead, with a copy button, and the organisation's short name;
- the store listings, marked "coming soon" until the apps are published.

The app then checks the server, shows your organisation's name for you to confirm, and signs you in through your phone's browser with the same methods you use on the web (password, Google, Microsoft, Singpass or your identity provider).

The app needs HTTPS. On a plain-HTTP server (a LAN install without a certificate), My profile says so: the app will connect over HTTP only to a private network address or a `.local` name, after warning that the connection is not encrypted. See [reverse proxy](/docs/self-hosting/reverse-proxy/) to add HTTPS.

The server side the apps need is ready and tested: native sign-in with PKCE and device sessions (listed in **My sessions**, where you can sign a device out), and `GET /api/v1/notifications?since=<cursor>` for background refresh ([API conventions](/docs/developers/api-conventions/#new-notifications-since-a-cursor)).

Progress is tracked on the [project status](/docs/status/) page.
