## Why

Crow HR's audience is an SME with one technical person, not a DevOps team. If installing, upgrading or restoring needs more than a `.env` edit and `docker compose up -d`, the product fails at the first step and loses to hosted competitors. A self-hoster must also recover from a bad upgrade or a dead disk without help.

## What Changes

- **One-command install.** A root `docker-compose.yml` runs the `crowhr` app container (one multi-arch image, amd64 and arm64) and `postgres:17-alpine`, plus a one-shot `init` step using the same image that generates the database password. The user copies `.env.example` to `.env`, sets `PUBLIC_URL`, and runs `docker compose up -d`. There is no Redis or queue, and background jobs run in-process (`tick` from workflows).
- **Generated secrets.** The encryption key and the database password are generated on first boot into the data volume when not supplied. A key that does not match the database is refused with a clear message.
- **Bring your own reverse proxy.**
  - The app serves plain HTTP on one port (default 8080).
  - `X-Forwarded-*` headers are honoured only from `TRUSTED_PROXIES`.
  - A Settings → System diagnostic shows the detected client IP and scheme.
  - Copy-paste examples for Caddy, nginx, Traefik and Cloudflare Tunnel are in the docs. No proxy is bundled.
- **Automatic migrations on start** under a Postgres advisory lock, each migration in its own transaction. A backup is taken automatically before pending migrations run. A failed migration stops startup, names the migration, and leaves data intact. Starting an older image against a newer schema is refused.
- **First-run setup wizard** in the browser (`/setup`), guarded by a one-time setup code printed in the container logs. It creates the organisation and the owner, then disappears.
- **Backups.**
  - `crowhr backup` and `crowhr restore <file>` via `docker compose exec app …`.
  - A scheduled daily `pg_dump` plus uploaded files plus secrets, written to the backups volume with retention.
  - Settings → System shows the last backup, and Home warns owners when the last successful backup is older than 48 hours.
- **Upgrade path.** `docker compose pull && docker compose up -d`. Image tags are `:1`, `:1.x`, `:1.x.y` and `latest`, and the compose file pins the major version. Skipping minor versions is supported.
- **Startup errors** name the variable, the problem and the fix. The app waits for a database that is not yet up.

M1 delivers compose, the init step, secrets, trusted proxies, migrations, the setup wizard, startup errors and manual backup/restore. M3 delivers scheduled backups, the System page, proxy examples, upgrade docs, and multi-arch image build verification.

## Capabilities

### New Capabilities
- `self-hosting`: install, configuration and secrets, reverse-proxy trust, migrations on start, first-run setup, backup and restore, upgrades, startup diagnostics.

### Modified Capabilities
None.

## Non-goals

- Publishing images to GHCR or any registry, and any public deploy. Both need Daniel's explicit approval; this change builds images locally only.
- Kubernetes or Helm, high-availability Postgres, multiple app replicas.
- A bundled reverse proxy or automatic TLS.
- Off-site backup upload (S3, B2). Docs show an rclone recipe for the backups volume.
- NAS or panel one-click installers, and a SaaS control plane.

## Impact

- New: `Dockerfile`, `docker-compose.yml`, `.env.example` (self-host section), `apps/server/src/{setup,backup,proxy,secrets,migrate}/`, the `crowhr` CLI entry in `apps/server`, and `apps/docs` self-hosting pages.
- `packages/core`: a setup service (create first org and owner) using identity services; the `GET /api/v1/system/status` route for owners.
- The foundation's server config is extended with new env vars, coordinated with the foundation owner because `apps/server/src/config.ts` is theirs until `add-foundation` is archived.
- The image adds `postgresql17-client` (for `pg_dump`).
