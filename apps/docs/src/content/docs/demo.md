---
title: In-browser demo
description: How Crow HR's in-browser demo works - the real app and API running in your browser against fictional data - what differs from a self-hosted install, and where to try it (hr.crow.sg).
---

Crow HR has an in-browser demo: the same web app and the same API code that a self-hosted install runs, started inside the visitor's browser instead of on a server. Try it at **[hr.crow.sg](https://hr.crow.sg/)**, next to these docs. You can also build and open it on your own machine (see [running it locally](#running-it-locally)) or [install Crow HR](/docs/quick-start/).

![The demo's sign-in page: a banner saying it runs entirely in your browser, and five personas to sign in as with one click (fictional company)](../../assets/screens/demo-personas.webp)

## How it works

- **No backend.** The site is static files. The Crow HR API runs in a Web Worker in your tab, against PostgreSQL compiled to WebAssembly (PGlite), saved in your browser's IndexedDB. Nothing you type reaches a server, and there are no analytics or third-party requests.
- **The real code.** Payroll is calculated by the real engine with the cited Singapore rules, approvals go through the real workflow engine, and permissions are enforced by the same server code as a self-hosted install.
- **Your own copy.** Each browser gets its own database, restored from a pre-built database snapshot on the first visit; if that download is missing or corrupt, the same seed runs in your browser. **Reset** in the demo banner wipes your copy, restores the snapshot and re-anchors the clock; clearing the site's data in your browser does the same. When a new version of the demo changes its data, your next visit starts from a fresh copy automatically.
- **One tab at a time.** Two tabs writing the same local database would corrupt it, so a second tab offers to take over instead.

## The demo company

Kopi Kaki Pte. Ltd. is a fictional café group with an office, a central kitchen and three outlets. 25 people work there (one starts in November) and two left this year. They include citizens, permanent residents in their first, second and later years, Employment Pass, S Pass and Work Permit holders, every self-help group fund, part-timers and employees on each CPF age boundary. Every name, NRIC/FIN, bank account and email address is invented.

Payroll for July to September 2026 is approved and paid. October is a draft run with warnings, and it already includes the overtime that managers approved from October's clock-ins. Rosters are published for October and the following week at the three outlets.

Sign in with one click as one of five personas, or type any seeded account's email with the shared password `kopi-kaki-demo`:

| Persona | Name | What they do in the demo |
| --- | --- | --- |
| Owner | Lim Kah Hui | Managing director. Approves payroll and her direct reports' claims. |
| HR admin | Nur Aisyah binte Rahman | People records, change requests and the second claims step. |
| Payroll admin | Chloe de Souza | Prepares the monthly run, bank file and CPF file. |
| Manager | Siti Nurhaliza binte Osman | Jurong Point outlet supervisor. Approves her team's claims, leave and a pending shift swap. |
| Employee | Goh Jun Jie | Barista at Tanjong Pagar. Payslips, claims, schedule and a document to acknowledge. |

Three things to try:

- As **Payroll admin**, open the October run and pick an employee to see how their CPF was worked out, step by step, with links to CPF's rate tables.
- As **Manager**, approve the shift swap waiting in the Inbox. The two shifts then move on the Jurong Point roster in **Schedules**.
- As **Employee**, acknowledge the updated terms waiting on Home, then open a payslip.

## What differs from a self-hosted install

| Area | In the demo | Self-hosted |
| --- | --- | --- |
| Signing in | One click on a persona, or the shared password. Two-step verification is not required. | Email and password, two-step verification (required for admin roles by default), SSO. |
| Google, Microsoft, Singpass | Buttons are shown but disabled; no request is made to any identity provider. (A demo can be built with a real Singpass login that keeps nothing about the visitor, see [Singpass login](/docs/admin/sso/singpass/#public-demo); hr.crow.sg does not offer it.) | Work once an owner configures them. |
| Email | Nothing is sent. Messages appear in the **Demo outbox** (from the banner), so invitation and reset links still work. | Sent over SMTP if configured. |
| Passwords | PBKDF2 in a demo-only format that a real server refuses. | argon2id. |
| Encryption at rest | NRIC/FIN and bank numbers are encrypted with a throwaway key included with the fictional snapshot and stored next to the database. The fallback seed creates a fresh key. Fine for invented data, never a pattern for real data. | Encrypted with the server's `CROWHR_SECRET_KEY`. |
| Date | The company lives on Saturday 31 Oct 2026: every visit starts there at 11:30 Singapore time, after the outlets' morning crews have clocked in, and the clock then runs normally. Reset re-anchors it. | The real date. |
| Uploaded files | Stored in the browser database. | Stored on the server's disk volume. |
| Background jobs | Reminders, escalations and the outbox run every 30 seconds while a demo tab is open, and catch up on the next visit. | Every 60 seconds in the server process. |
| Backups and system status | Not applicable. | Daily `pg_dump` to the backups volume. |

## Known differences

- Every run shows the `YTD_BEFORE_CROWHR_MISSING` warning on purpose: the January–June opening balances are not imported, as for a company that moved to Crow HR mid-year.
- Receipt previews and PDF or CSV downloads go through a service worker. Where service workers are unavailable (some private-browsing modes), those previews and downloads fail; everything else works.
- A tab closed in the middle of a request can lose that one request.
- Nothing is filed with CPF Board, IRAS or a bank, here or in the product: Crow HR produces the files for you to upload.

The demo's own **About this demo** page (`/about-demo`) lists the same differences for visitors.

## Running it locally

From a checkout, with [Bun](https://bun.sh) installed:

```sh
bun install
# build the demo and these docs into apps/demo/dist-site
bun run demo:site
# serve them at http://127.0.0.1:5181
node apps/demo/scripts/serve.ts apps/demo/dist-site
```

The preview server applies the same headers and redirects as the static host would. Keep it on your own machine: the demo has a shared password and no real security, by design.
