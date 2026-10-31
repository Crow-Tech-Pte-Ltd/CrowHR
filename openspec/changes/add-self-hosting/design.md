## Context

The foundation ships `apps/server` (Node 24, env validation, node-postgres or PGlite, migrate-on-start, SPA hosting) but no Dockerfile or compose file; its proposal lists `docker-compose.yml` as a non-goal. Identity needs `CROWHR_SECRET_KEY` and `PUBLIC_URL`. Workflows provides the in-process `tick`. Disk on dev machines is tight, so the image must be small and builds must not run in parallel. Requirements are in `specs/self-hosting`.

## Goals / Non-Goals

**Goals:** `.env` with one line, then `up -d`; no data loss from any single operator mistake (wrong key, failed upgrade, wiped app volume); every failure message tells the operator the next command to run.

**Non-Goals:** zero-downtime upgrades. A few seconds of downtime during restart is fine for an SME HR tool.

## Decisions

1. **Image.**
   - Multi-stage build: bun install and Vite build in the builder stage, then a runtime on `node:24-alpine` with `postgresql17-client`, `tini` and the built web assets.
   - Server TypeScript runs with Node type stripping, so no transpile step is needed (foundation decision 1).
   - Non-root uid 10001. `/data` and `/backups` are volumes, and the root filesystem is read-only in compose.
   - Target size under 250 MB.
   - Multi-arch via `docker buildx` is verified locally for arm64 with QEMU only in M3, once, because of resource limits.

2. **Init service rather than Postgres trust auth.** `init` runs `crowhr init-secrets` (same image, exits 0), which writes `/run/crowhr-secrets/db_password` if missing. Postgres starts with `depends_on: init: condition: service_completed_successfully` and `POSTGRES_PASSWORD_FILE`. The app reads the same file and builds `DATABASE_URL` when it is not set. *Alternative:* `POSTGRES_HOST_AUTH_METHOD=trust` on the internal network. That is simpler but leaves the database open to any container joined to the network, and it breaks if someone later publishes the port.

3. **Encryption key lifecycle.** `/data/secrets/crowhr.key` is created on first boot when `CROWHR_SECRET_KEY` is unset. `system_settings.key_check` stores HMAC(key, "crowhr-key-check"). If the key file is missing but the database has `key_check`, the app refuses to generate a new key. This is the "wiped app volume" safety.

4. **Trusted proxy parsing** in `apps/server/src/proxy/`. The CIDR matcher supports IPv4, IPv6 and IPv4-mapped IPv6. It computes `clientIp` and `scheme` once per request and passes them to core through the request context; core never reads headers itself. Settings → System calls `GET /api/v1/system/status`, which echoes what the server saw.

5. **Migrations.** `pg_advisory_lock(hashtext('crowhr:migrate'))` is taken around Drizzle's migrator. Drizzle already runs each migration file in a transaction. Our wrapper records `schema_version` (the latest migration tag plus the app version) in `system_settings`. It compares the journal of the bundled migrations with the database's `__drizzle_migrations`: an unknown migration hash in the database means the database is newer, and the app refuses to start. A pre-migration backup runs only when the pending set is non-empty and the database already has an organisation.

6. **Backup format.** A `.tar` stream, gzip-compressed, containing `manifest.json`, `db.dump` (`pg_dump -Fc`), `files/`, and `secrets/crowhr.key`. When `BACKUP_PASSPHRASE` is set, the whole tar is encrypted with age-compatible scrypt and ChaCha20-Poly1305. The candidate is `age-encryption` (the JS port of age, BSD-3), to be confirmed at implementation. The secrets are included by default because a backup without the key cannot restore NRIC, bank or SSO data, and SMEs lose keys far more often than they lose backups to theft. The docs say so plainly and recommend `BACKUP_PASSPHRASE`. Scheduling uses the workflows `tick`: a sweep checks whether today's `BACKUP_TIME` has passed without a backup.

7. **Restore.** It runs from the CLI inside the running container. It sets `system_settings.maintenance = true` (HTTP returns 503 "Restoring backup", and the tick pauses), runs `pg_restore --clean --if-exists` into the database, swaps the files directory atomically by rename, writes the key, runs migrations, then clears maintenance.

8. **Setup wizard.** Code generation and hash are in `apps/server/src/setup/`. The form posts to core's `POST /api/v1/setup` with the code in a header. Core validates the code against the stored hash (an injected `SetupGuard`) and creates the org and owner through the identity services in one transaction. A setup-mode middleware redirects all other routes until done.

## Risks / Trade-offs

- [Secrets inside backups widen the blast radius of a stolen backup] → `BACKUP_PASSPHRASE` is supported, docs recommend it, and the System page shows "Backups are not encrypted" until it is set.
- [The backups volume sits on the same disk as the data] → the docs give a copy-off recipe (rclone or scp). Home shows the backup age warning, not just the backup status.
- [pg_dump of large file stores is slow] → SME file stores are small. Files are tarred streaming, not loaded into memory.
- [QEMU arm64 builds are slow and heavy on this machine] → one verification build in M3. CI builds multi-arch only when publishing is approved.

## Migration Plan

New install path. Dev setups using `DATABASE_URL=pglite:*` are unaffected.

## Open Questions

- The image name and registry (`ghcr.io/crow-tech-pte-ltd/crowhr`) need confirming with Daniel before publishing. That is not needed to build locally.
