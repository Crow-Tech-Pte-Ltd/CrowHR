## 1. Configuration and secrets (M1)

- [x] 1.1 apps/server: write `src/config.self-host.test.ts` (PUBLIC_URL scheme/path errors with fix text, TRUSTED_PROXIES parse errors, key format, every other variable defaulted, all problems reported in one run) then extend env validation — coordinate edits to `src/config.ts` with the foundation owner
- [x] 1.2 apps/server: write `src/secrets/secrets.test.ts` (generate key 0600 on first boot, env value wins, key check stored, mismatch → exit with restore hint, missing key file + existing key_check → refuse to generate) then implement — key check value via identity's `secret_key_checks` (`verifySecretKeyAgainstDb`), not a separate `system_settings.key_check`
- [x] 1.3 apps/server: write `src/cli/init-secrets.test.ts` (writes db_password once, idempotent, exit 0) then implement `crowhr init-secrets`
- [x] 1.4 apps/server: write `src/db/wait.test.ts` (retries 60 s with 5-s progress logs using fake timers, then exits with `docker compose ps` hint) then implement database wait

## 2. Proxy trust (M1)

- [x] 2.1 apps/server: write `src/proxy/trust.test.ts` (IPv4/IPv6/mapped CIDRs; untrusted peer ignores headers; right-most untrusted XFF hop; scheme from trusted XFP only) then implement and pass `clientIp`/`scheme` into the core request context
- [x] 2.2 packages/core: write `system/status.http.test.ts` (owner only; echoes client IP, scheme, proxy trusted, version, schema version, last backup) then implement `GET /api/v1/system/status` — owner-only is enforced in the service and tested there; the HTTP test covers 401 (no install-level row in the permission matrix)

## 3. Migrations (M1)

- [x] 3.1 apps/server: write `src/migrate/migrate.test.ts` on PGlite (advisory lock serialises two runners, health 503 `starting` until done, failure exits non-zero naming migration with prior migrations intact, newer-schema database refused) then implement the wrapper — the two-runner test runs on PGlite with an in-process lock and, with `CROWHR_TEST_POSTGRES_URL`, on real Postgres with `pg_try_advisory_lock` (CI self-host job, and locally against a throwaway postgres:17-alpine)
- [x] 3.2 apps/server: write `src/migrate/pre-backup.test.ts` (backup only when pending and an org exists; `BACKUP_BEFORE_MIGRATE=false` skips; path printed on failure) then implement

## 4. Setup wizard (M1)

- [x] 4.1 apps/server: write `src/setup/code.test.ts` (16-char unambiguous alphabet, grouped, printed each start until done, hash stored only) then implement code generation
- [x] 4.2 packages/core: write `setup/setup.http.test.ts` (wrong code ×5 → IP blocked 15 min, creates org + owner in one transaction with identity password policy, code invalidated, `/setup` 404 afterwards, other routes redirect while in setup mode) then implement — owner is created through the identity model (users, memberships, owner role, org security settings, `setup.completed` audit) and signed in; the page redirect is tested in `apps/server/src/http.self-host.test.ts`
- [ ] 4.3 apps/web: write `e2e/setup.spec.ts` (enter code, org name, owner, offered MFA, lands on Home with setup checklist) then build the wizard — PARTIAL: wizard, MFA offer (links to identity's `/me/sessions?enrol=1`) and landing on Home are tested; Home has no setup checklist yet (Home/organisation checklist belong to WS3/WS2)

## 5. Compose and image (M1)

- [x] 5.1 root: `Dockerfile` (multi-stage, node:24-alpine runtime, postgresql17-client, non-root 10001, <250 MB) — verified by `docker build` locally once and `docker image inspect` size check — 210 MB (amd64)
- [x] 5.2 root: `docker-compose.yml` + `.env.example` self-host section (app, postgres:17-alpine without host port, init service, volumes, healthcheck on `/api/health`, read-only rootfs) — verified by `e2e/self-host.sh`: clean `up -d` with only `PUBLIC_URL`, health 200 within 2 min, setup page served, then `down -v`; run once, sequentially, removing only containers/volumes it created — `e2e/self-host.sh` also runs the wizard in Playwright, backup → `down -v` → restore, lost-data-volume recovery and Caddy

## 6. Backup and restore (M1 manual, M3 scheduled)

- [x] 6.1 apps/server: write `src/backup/backup.test.ts` (archive contains manifest, dump, files, key; checksums; passphrase encryption round-trip) then implement `crowhr backup`
- [x] 6.2 apps/server: write `src/backup/restore.test.ts` (corrupt archive aborts before DB changes; newer schema refused; non-empty DB needs `--force`; maintenance mode 503 during restore; NRIC decrypts and files download after restore onto fresh DB) then implement `crowhr restore` and `--secrets-only` — the real pg_dump/pg_restore round trip runs with `CROWHR_TEST_POSTGRES_URL` and in `e2e/self-host.sh`; "NRIC decrypts" is a SecretBox ciphertext round trip (no employee records exist yet)
- [x] 6.3 (M3) apps/server: write `src/backup/schedule.test.ts` (daily at BACKUP_TIME SGT via tick with injected clock, retention BACKUP_KEEP, failure recorded) then implement scheduled backups — in-process timer in `apps/server` until the workflows `tick` exists; skips while no organisation exists
- [ ] 6.4 (M3) apps/web: write `e2e/system-page.spec.ts` (last backup shown, "Backups are not encrypted" notice, Home warning when last success > 48 h, proxy diagnostic) then build Settings → System and the Home warning source — PARTIAL: Settings → System is built and covered by `e2e/setup.spec.ts` (no-backup + "Backups are not encrypted" notices, proxy diagnostic, database); the Home warning needs the workflows `InboxSource` (not landed); a "last backup shown" e2e with a real backup is covered only by `e2e/self-host.sh` via the API

## 7. Upgrades and docs (M3)

- [x] 7.1 apps/server: write `src/migrate/skip-versions.test.ts` (database at an older migration tag upgrades through all later migrations in one start) then fix any gaps
- [x] 7.2 apps/docs: install, reverse proxy examples (Caddy, nginx, Traefik, Cloudflare Tunnel with TRUSTED_PROXIES values), backup/restore, copying backups off-host, upgrade and troubleshooting pages — verified by following the install page verbatim in `e2e/self-host.sh` — drafts in `docs/self-hosting/` (the docs site does not exist yet; WS8 moves them); only the Caddy example is exercised
- [x] 7.3 root: multi-arch buildx verification for amd64 + arm64 — verified once locally under resource limits; publishing to GHCR is NOT part of this task and needs Daniel's approval — arm64 built once with buildx + QEMU, argon2 loads and the server starts against PostgreSQL 17; CI builds amd64 only; nothing published

## 8. Break-glass CLI (added during implementation)

- [x] 8.1 apps/server: `crowhr create-reset-link` / `crowhr reset-owner-mfa` (and `crowhr admin reset-owner-password|verify-audit`) wrap identity's audited owner-recovery and audit-chain commands — `src/cli/break-glass.test.ts`
- [x] 8.2 apps/server: `crowhr doctor` (config, database, clock skew, migrations, key, disk, backups, proxy headers as seen) and `crowhr setup-code` — exercised in `e2e/self-host.sh`
