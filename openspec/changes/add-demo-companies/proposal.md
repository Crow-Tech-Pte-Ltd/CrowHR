## Why
The in-browser demo (hr.crow.sg) lets anyone try the web app in one click, but nobody can try the mobile apps without what only maintainers have: a server address, an organisation code and a password from the vault. Daniel (12 Nov 2026): people should be able to test Crow HR end to end, on their phone too, without "all this fancy stuff". The apps can't use the in-browser demo: they need a real server.

## What Changes
- **Demo companies.** A Crow HR server started with `DEMO_COMPANIES=1` gives any visitor their own private copy of the fictional sample company Kopi Kaki (the demo's company). The copy has its own unguessable short name and its own history (payroll, leave, claims, rosters, approvals) relative to the day it was made, and it is deleted with everything in it after a few days (`DEMO_COMPANY_TTL_HOURS`, default 72). A small pool of ready copies keeps the start instant. Creation is capped per network and in total. Off by default, so no real install can turn it on by accident.
- **One-tap sign-in.** A demo company's sign-in page offers its people (owner, HR admin, payroll admin, manager, employees) instead of passwords, on the web and in the apps' sign-in browser. The 1.0.0 apps need no change: they already open `crowhr://connect` links, sign in through the server's sign-in page and label a demo server.
- **Try page.** `/try` on that server: get the app, start your demo company, then open it in the app (a link on the phone, a QR code on a computer) or in the browser. The same company works on both, so a visitor can approve on the web as the manager what they applied for on the phone as the employee.
- **Guard rails.** In a demo company, sign-in and security settings, SSO, invitations, password/email/MFA changes and outgoing email are refused by the server; uploads have a per-company quota. Demo companies are never listed by the API. The audit log stays append-only for every real organisation; only a demo company's own audit events can be deleted, and only by the expiry sweep.
- **Links.** The in-browser demo, the docs' mobile apps page and the crow.sg product page link to the try page.

## Capabilities
### New Capabilities
- `demo-companies`: per-visitor demo companies on a server, persona sign-in for them, guard rails, expiry.
### Modified Capabilities
- `auth`: persona sign-in (today browser-demo only) also works for a demo company, including native app sign-in.
- `access-control`: audit log immutability gets one narrow, tested exception (expiry of a demo company).

## Impact
`packages/core` (organisation flag + migration, provisioning, persona routes, guard rails, meta, expiry job), `packages/demo` (sample company seed parameterised by short name and email domain), `apps/server` (config, scheduler), `apps/web` (try page, sign-in page), `apps/demo` and `apps/docs` (links, guide), OpenAPI snapshot (new routes; v1.0 frozen contract unchanged).

**Hosting** needs Daniel's approval. Proposed: turn it on at `https://hr-demo.crow.sg` (the server the store reviewers and the demo's Singpass already use) after the App Store review of 1.0.0 is finished, since hr-demo must not be upgraded during review. The privacy policy on crow.sg gets a "Demo server" section before launch (what a demo company keeps and when it is deleted); this feeds the open "Data Not Collected" legal review (add-mobile-apps 4.3).
