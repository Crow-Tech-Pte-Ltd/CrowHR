---
title: Configuration reference
description: Every environment variable Crow HR reads, with defaults, valid values and what each one does.
---

Set variables in `.env` next to `docker-compose.yml`, then run `docker compose up -d` to apply them (it recreates only what changed). Empty values count as unset.

At startup every variable is checked. A wrong value stops the app with a message naming the variable, what is wrong, a valid example and where to set it (exit code 78). All problems are reported in one run, so you fix them once.

:::note[Kept in sync with the code]
This page is checked by a test (`apps/docs/tests/env-vars.test.ts`) that reads every environment variable the server, the CLI, the Dockerfile and `docker-compose.yml` use. The test fails when a variable is missing here, or when this page lists one the code no longer reads.
:::

## Required

| Variable | Example | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | `https://hr.example.sg` | The address people open: scheme and host (and port), no path. Cookies are `Secure` (and use the `__Host-` prefix) when this is `https`, even if a proxy talks plain HTTP to the app. Links in emails, the CSRF origin check and SSO redirect URIs use it. Crow HR must live at the root of its own (sub)domain. Required in production; in development it defaults to `http://localhost:8080`. |

## Network

| Variable | Default | Meaning |
| --- | --- | --- |
| `HTTP_PORT` | `8080` | Host port published by compose. Inside the container the app always listens on 8080. |
| `BIND_ADDRESS` | `0.0.0.0` | Host address the port binds to. Use `127.0.0.1` when a proxy on the same machine is the only way in. |
| `TRUSTED_PROXIES` | empty | Comma-separated IPs/CIDRs (IPv4 or IPv6) whose `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` are believed. Shorthands: `private` (10/8, 172.16/12, 192.168/16, fc00::/7, loopback) and `loopback`. Empty: the TCP peer is the client and forwarded headers are ignored (the app logs a hint when it sees them). The client IP is the right-most `X-Forwarded-For` address that is not itself a trusted proxy, so clients cannot spoof it. |

## Backups

| Variable | Default | Meaning |
| --- | --- | --- |
| `BACKUP_PASSPHRASE` | empty | Encrypts every backup archive with [age](https://age-encryption.org) (scrypt). At least 12 characters. Required for scheduled backups: they refuse to run without it because archives contain the encryption key. Keep it outside the server; restores need it. |
| `BACKUP_TIME` | `02:00` | Daily scheduled backup time (24 h) in `BACKUP_TIMEZONE`, or `off`. If the server was down at that time it catches up later the same day. Not run until setup has created an organisation. |
| `BACKUP_TIMEZONE` | `Asia/Singapore` | IANA time zone for `BACKUP_TIME`. |
| `BACKUP_KEEP` | `14` | Newest archives kept in the backups directory after each scheduled backup (manual and pre-upgrade ones count). 1 to 3650. |
| `BACKUP_BEFORE_MIGRATE` | `true` | Before applying database upgrades to a database that has data, write a backup (`…-pre-migrate.tar.gz`). If that backup fails, the upgrade does not start. |
| `BACKUP_DIR` | `/backups` in the image | Where archives are written (the `backups` volume). In development: `<DATA_DIR>/backups`. |

## Secrets and data

| Variable | Default | Meaning |
| --- | --- | --- |
| `CROWHR_SECRET_KEY` | generated | 32 random bytes, base64 (44 characters) or hex (64 characters), for example from `openssl rand -base64 32`. Encrypts NRIC/FIN, bank account numbers, MFA and SSO secrets. When unset, one is generated on first start into `SECRET_KEY_FILE` (mode 600). When set, it wins over the file. The app refuses a key that does not match the database, and never generates a new key for a database that already has one. |
| `SECRET_KEY_FILE` | `<DATA_DIR>/secrets/crowhr.key` | Generated key location (`/data/secrets/crowhr.key` in the image). |
| `DATA_DIR` | `/data` in the image, `./data` otherwise | The data volume. |
| `FILE_STORAGE_DIR` | `<DATA_DIR>/files` | Uploaded files. |

## Database

Compose sets these for the bundled PostgreSQL; you normally leave them alone.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | built from the parts below | Use an external PostgreSQL 17: `postgres://user:password@host:5432/db` (add `?sslmode=require` if needed). Takes precedence over the parts. In development without it, the server uses in-process PGlite in `./data/pglite` (`pglite:memory` for a throwaway database); PGlite is for development and tests only. |
| `DATABASE_HOST` | `db` (compose) | Host of the bundled database. |
| `DATABASE_PORT` | `5432` | |
| `DATABASE_NAME` | `crowhr` | |
| `DATABASE_USER` | `crowhr` | |
| `DATABASE_PASSWORD` | unset | Database password, if you do not use a password file. |
| `DATABASE_PASSWORD_FILE` | `/run/crowhr-secrets/db_password` (compose) | File holding the password, written by the compose `init` service (`crowhr init-secrets`). |
| `DB_WAIT_SECONDS` | `60` | How long to wait for the database at startup ("waiting for database" is logged every 5 s), then exit with a `docker compose ps` hint. 0 to 3600. |
| `MIGRATE_ON_START` | `true` | Apply migrations at startup under a Postgres advisory lock. With `false`, run `crowhr migrate` yourself. |
| `MIGRATE_LOCK_TIMEOUT_SECONDS` | `300` | How long a second instance waits for another one's migrations. |

## Email

Optional. Without it Crow HR works fully: notifications appear in the app (the bell, top right) and invitations and password resets show a link to copy. Owners see "Email is not configured" in **Settings → Notifications**.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SMTP_URL` | unset (email off) | `smtps://user:password@smtp.example.sg:465` (TLS from the start) or `smtp://user:password@smtp.example.sg:587` (STARTTLS required by default). URL-encode special characters in the user and password (`@` → `%40`). |
| `SMTP_REQUIRE_TLS` | `true` on SMTP port 587; otherwise `false` | Require STARTTLS on an SMTP connection. Set `true` for a relay on another port, or explicitly `false` for a relay without STARTTLS. `smtps://` always uses implicit TLS. Only `true` and `false` are accepted. |
| `MAIL_FROM` | required with `SMTP_URL` | Sender, for example `"Crow HR <hr@example.sg>"`. Use an address your mail provider lets you send from (SPF/DKIM). Setting it without `SMTP_URL` is an error. |

Notification emails go through an outbox: a failed send is retried after 1, 5, 30, 120 and 720 minutes, then marked failed; owners see failures in **Settings → Notifications**. Emails never contain salary or other amounts, NRIC/FIN, bank or medical details, only a short summary and a link. A wrong `SMTP_URL` or a missing `MAIL_FROM` stops startup with a message saying which one to fix.

Invitations and password-reset emails are currently sent directly by the sign-in code, without the outbox's retries (see [limitations](/docs/payroll/limitations/#platform-and-sign-in)).

## Other

| Variable | Default | Meaning |
| --- | --- | --- |
| `SETUP_CODE` | random per start | Fixed first-run setup code (16 characters from `34679ACDEFGHJKMNPQRTUVWXY`, for example `ACDE-FGHJ-KMNP-QRTU`) for scripted installs. Normally leave unset. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. Logs are JSON lines on stdout (compose keeps 3 × 10 MB per container). |
| `HOST` | `0.0.0.0` in the image, `127.0.0.1` otherwise | Listen address inside the container. |
| `PORT` | `8080` | Listen port inside the container (compose pins it to 8080). |
| `WEB_DIST_DIR` | `/app/apps/web/dist` in the image | Built web app. |
| `SETUP_GATE` | `true` | Redirect every page to `/setup` until setup is done. Tests only. |
| `NODE_ENV` | `production` in the image | Outside the image (development) `PUBLIC_URL` defaults to `http://localhost:8080` and the database to `pglite:./data/pglite`. |
| `DEMO_SINGPASS_PROVIDER_ID` | unset | Only for hosting the public demo's Singpass login: the id of this server's Singpass method (as in its redirect URI). Set together with `DEMO_SINGPASS_RETURN_URL`. Nobody is signed in on this server and nothing about the person is kept. See [Singpass login](/docs/admin/sso/singpass/#public-demo). |
| `DEMO_SINGPASS_RETURN_URL` | unset | The demo sign-in page (full `https://` address, for example `https://hr.crow.sg/sign-in/kopi-kaki`) that demo visitors return to after Singpass. Set together with `DEMO_SINGPASS_PROVIDER_ID`. |

## Set by the image or compose file

You do not set these in `.env`; they are listed so nothing the app reads is undocumented.

| Variable | Set by | Meaning |
| --- | --- | --- |
| `CROWHR_IMAGE` | `docker-compose.yml` | Image to run, default `ghcr.io/crow-tech-pte-ltd/crowhr:1` (the newest 1.x release). The one exception to this table: set it in `.env` to stay on one release (`…:1.0.0`) or to run your own build (`crowhr:local`, see [build the image yourself](/docs/self-hosting/install/#build-the-image-yourself)). |
| `CROWHR_CONTAINER` | Dockerfile (`1`) | Tells `crowhr restore` it runs inside the container, so it can restart the app afterwards by signalling PID 1. Outside Docker it prints "restart the app" instead. |
| `NODE_OPTIONS` | Dockerfile | Silences Node's experimental-feature warnings in the logs. |
| `CROWHR_GIT_SHA` | build argument (Dockerfile) | Commit the image was built from, added to the error-monitoring release (`crowhr@<version>+<commit>`). Set in the published images; empty in your own build unless you run `docker build --build-arg CROWHR_GIT_SHA=$(git rev-parse HEAD) -t crowhr:local .`. |

## Optional virus scanning

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLAMAV_HOST` | unset (scanning off) | Private hostname/IP of your own clamd server. Enables the shared upload scan pipeline; no third-party service is contacted. |
| `CLAMAV_PORT` | `3310` | clamd TCP port, 1–65535. Uses INSTREAM, a 15-second deadline and 64 KB chunks. |

Configure these on the **app container** (for example an `environment` entry in a local compose override), then recreate it. Keep clamd on a private network: this protocol has no authentication or TLS. Crow HR does not install or operate clamd. Keep its signatures current with your own FreshClam service. No scanner is required to run Crow HR.

Receipt, document and medical certificate uploads are initially `pending_scan`; the existing background sweep scans them and records `clean` or `infected`. Infected bytes are removed, the uploader is notified, and an audit event is written. Transport errors never mark a file clean: three failed attempts produce `scan_failed`. Medical certificates are unavailable until a configured scanner returns clean. Without configuration, files remain explicitly `unscanned` and the scanning-off notice remains visible.

Requests default to a 1 MB body limit. Dedicated receipt/document uploads, CSV import previews, company logos and leave attachment requests have explicit larger limits, with each file's own size validation still enforced.

## Optional error monitoring

Off by default: without a DSN no monitoring code is loaded and nothing is sent anywhere. Set a DSN to report errors and slow requests to **your own** [GlitchTip](https://glitchtip.com) or Sentry project (any Sentry-compatible service). Crow Tech receives nothing.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SENTRY_DSN` | empty (off) | The server project's DSN (GlitchTip: project settings, *Client keys (DSN)*). Reports unhandled errors and every `error` log entry (for example a failed scheduled backup) as issues, traces API requests, and forwards the app's log entries. |
| `SENTRY_BROWSER_DSN` | empty (off) | DSN for the web app; may be the same project or a separate browser project. Browsers can read it (that is how browser reporting works), so use a DSN whose only right is sending events. The server puts it in the page at runtime (no rebuild) and allows its origin in the page's Content-Security-Policy. |
| `SENTRY_ENVIRONMENT` | `production` in the image | Environment name shown in the monitoring service, for example `staging`. At most 64 characters, no spaces or slashes. |
| `SENTRY_RELEASE` | `crowhr@<version>` (`+<commit>` with `CROWHR_GIT_SHA`) | Release name for both server and browser events. |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.2` | Share of API requests and page loads traced, `0` to `1`. `0` turns tracing off. Health checks and static files are never traced. |
| `SENTRY_ENABLE_LOGS` | `true` | Forward the app's log entries (at `LOG_LEVEL` and above) as logs. The console output does not change. |

Crow HR holds NRIC/FIN, salaries, bank and medical details, so events carry no request or response bodies, cookies, query strings, IP addresses, user details, database query values or local variables, and no session replay. Request headers are limited to `User-Agent`, `Accept`, `Content-Type`, `Content-Length` and `X-Request-Id` (the ID shown to users with an error, also in the app's logs). Before anything is sent, error messages, log entries and breadcrumbs lose the values of a failed database query, and NRIC/FIN numbers and email addresses in them are masked; invitation and password-reset tokens are removed from page addresses, and element labels from click records. Console output is not attached. Expected failures (validation, permission, not found) are not reported; 4xx answers in the browser are not either. Error messages and log entries can still name records (IDs, file names, names of categories or shifts), so keep the monitoring service as private as the app.

Set the variables in `.env` and run `docker compose up -d`: a restart applies them, no rebuild is needed. A wrong value stops the app with a message, like every other setting.
