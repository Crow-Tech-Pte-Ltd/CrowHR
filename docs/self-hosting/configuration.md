# Self-hosting: configuration reference

Draft for the docs site. Set variables in `.env` next to `docker-compose.yml`, then run `docker compose up -d` to apply them (it recreates only what changed). Empty values count as unset. At startup every variable is checked; a wrong value stops the app with a message naming the variable, what is wrong, a valid example and where to set it (exit code 78).

## Required

| Variable | Example | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | `https://hr.example.sg` | The address people open. Scheme and host (and port), no path. Cookies are `Secure` (and use the `__Host-` prefix) when this is `https`, even if a proxy talks plain HTTP to the app. Links in emails, the CSRF origin check and SSO redirect URIs use it. Crow HR must live at the root of its own (sub)domain. |

## Network

| Variable | Default | Meaning |
| --- | --- | --- |
| `HTTP_PORT` | `8080` | Host port published by compose. Inside the container the app always listens on 8080. |
| `BIND_ADDRESS` | `0.0.0.0` | Host address the port binds to. Use `127.0.0.1` when a proxy on the same machine is the only way in. |
| `TRUSTED_PROXIES` | empty | Comma-separated IPs/CIDRs (IPv4 or IPv6) whose `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` are believed. Shorthands: `private` (10/8, 172.16/12, 192.168/16, fc00::/7, loopback) and `loopback`. Empty: the TCP peer is the client and forwarded headers are ignored (the app logs a hint when it sees them). The client IP is the right-most `X-Forwarded-For` address that is not itself a trusted proxy, so clients cannot spoof it. |

## Backups

| Variable | Default | Meaning |
| --- | --- | --- |
| `BACKUP_PASSPHRASE` | empty | Encrypts every backup archive with [age](https://age-encryption.org) (scrypt). At least 12 characters. Strongly recommended: archives contain the encryption key. Keep it outside the server; restores need it. |
| `BACKUP_TIME` | `02:00` | Daily scheduled backup time (24 h) in `BACKUP_TIMEZONE`, or `off`. If the server was down at that time it catches up later the same day. Not run until setup has created an organisation. |
| `BACKUP_TIMEZONE` | `Asia/Singapore` | IANA time zone for `BACKUP_TIME`. |
| `BACKUP_KEEP` | `14` | Newest archives kept in `/backups` after each scheduled backup (manual and pre-upgrade ones count). |
| `BACKUP_BEFORE_MIGRATE` | `true` | Before applying database upgrades to a database that has data, write a backup (`…-pre-migrate.tar.gz`). If that backup fails, the upgrade does not start. |
| `BACKUP_DIR` | `/backups` | Where archives are written (the `backups` volume). |

## Secrets and data

| Variable | Default | Meaning |
| --- | --- | --- |
| `CROWHR_SECRET_KEY` | generated | 32 random bytes, base64 (44 chars) or hex (64 chars), e.g. `openssl rand -base64 32`. Encrypts NRIC/FIN, bank numbers, MFA and SSO secrets. When unset, one is generated on first start into `SECRET_KEY_FILE` (mode 600). When set, it wins over the file. The app refuses a key that does not match the database, and never generates a new key for a database that already has one. |
| `SECRET_KEY_FILE` | `/data/secrets/crowhr.key` | Generated key location. |
| `DATA_DIR` | `/data` | The data volume. |
| `FILE_STORAGE_DIR` | `/data/files` | Uploaded files. |

## Database

Compose sets these for the bundled PostgreSQL; you normally leave them alone.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | built from the parts below | Use an external PostgreSQL 17: `postgres://user:password@host:5432/db` (add `?sslmode=require` if needed). Takes precedence over the parts. |
| `DATABASE_HOST` | `db` (compose) | |
| `DATABASE_PORT` | `5432` | |
| `DATABASE_NAME` | `crowhr` | |
| `DATABASE_USER` | `crowhr` | |
| `DATABASE_PASSWORD` / `DATABASE_PASSWORD_FILE` | `/run/crowhr-secrets/db_password` (compose) | Password, or a file holding it (written by the `init` service). |
| `DB_WAIT_SECONDS` | `60` | How long to wait for the database at startup ("waiting for database" is logged every 5 s), then exit with a `docker compose ps` hint. |
| `MIGRATE_ON_START` | `true` | Apply migrations at startup under a Postgres advisory lock. With `false`, run `crowhr migrate` yourself. |
| `MIGRATE_LOCK_TIMEOUT_SECONDS` | `300` | How long a second instance waits for another one's migrations. |

## Other

| Variable | Default | Meaning |
| --- | --- | --- |
| `SETUP_CODE` | random per start | Fixed first-run setup code (16 characters from `34679ACDEFGHJKMNPQRTUVWXY`, e.g. `ACDE-FGHJ-KMNP-QRTU`) for scripted installs. Normally leave unset. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. Logs are JSON lines on stdout (compose keeps 3 × 10 MB per container). |
| `HOST` | `0.0.0.0` in the image | Listen address inside the container. |
| `PORT` | `8080` | Listen port inside the container (compose pins it to 8080). |
| `WEB_DIST_DIR` | `/app/apps/web/dist` | Built web app. |
| `SETUP_GATE` | `true` | Redirect every page to `/setup` until setup is done. Tests only. |
| `NODE_ENV` | `production` in the image | Outside the image (development) PUBLIC_URL defaults to `http://localhost:8080` and the database to `pglite:./data/pglite`. |

## Email

Optional. Without it Crow HR works fully: notifications appear in the app (the bell, top right) and invitations and password resets show a link to copy. Owners see "Email is not configured" in Settings → Notifications.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SMTP_URL` | unset (email off) | `smtps://user:password@smtp.example.sg:465` (TLS from the start) or `smtp://user:password@smtp.example.sg:587` (STARTTLS when offered). URL-encode special characters in the user and password (`@` → `%40`). |
| `MAIL_FROM` | required with `SMTP_URL` | Sender, e.g. `"Crow HR <hr@example.sg>"`. Use an address your mail provider lets you send from (SPF/DKIM). |

Notification emails go through an outbox: a failed send is retried after 1, 5, 30, 120 and 720 minutes, then marked failed; owners see failures in Settings → Notifications. Emails never contain salary or other amounts, NRIC/FIN, bank or medical details, only a short summary and a link. A wrong `SMTP_URL` or a missing `MAIL_FROM` stops startup with a message saying which one to fix.
