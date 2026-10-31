---
title: Upgrades
description: Upgrade Crow HR with docker compose pull, what happens during database migrations, image tags and downgrades.
---

## Upgrading

```sh
docker compose pull
docker compose up -d
docker compose logs -f app      # watch the migrations, Ctrl-C when "Crow HR is ready"
```

While the database is being upgraded the site shows "Crow HR is starting" and `/api/health` answers 503 `starting`. A few seconds of downtime is normal.

What happens on start:

1. The app waits for the database (up to `DB_WAIT_SECONDS`).
2. It takes a Postgres advisory lock, so two app containers never migrate at once (a second one waits up to `MIGRATE_LOCK_TIMEOUT_SECONDS`).
3. If migrations are pending and the database has data, it writes a backup first (`…-pre-migrate.tar.gz`).
4. Each migration runs in its own transaction. If one fails, the app stops with the migration's name, the database error and the path of that backup; earlier migrations stay applied and nothing of the failed one does. Go back to the previous image tag and report the error.

Skipping versions is fine within a major version: an install on 1.1.0 can pull 1.6.2 directly, and every migration from 1.2 to 1.6 is applied in order on the first start.

## Image tags

Images will be tagged `:<major>`, `:<major>.<minor>`, `:<major>.<minor>.<patch>` and `latest`. `docker-compose.yml` references `:1`, so `pull` brings the newest 1.x. A major upgrade (1 → 2) means editing the tag in `docker-compose.yml` and reading the release notes, which mark any manual step.

:::caution[Images are not published yet]
The registry and publishing still need approval. Until then compose builds the image from the checkout, so upgrade with `git pull && docker compose up -d --build`.
:::

## Downgrades

Starting an older image against a database upgraded by a newer one is refused:

```
This database was upgraded by Crow HR 1.5. Run 1.5 or newer
```

To really go back, restore a backup taken before the upgrade (the pre-migrate backup is made for this): see [backups and restore](/docs/self-hosting/backups/).

## Multi-arch builds (amd64 and arm64)

The Dockerfile builds on both architectures (no native modules beyond `@node-rs/argon2`, which ships musl binaries for both). Local multi-arch build with QEMU:

```sh
docker buildx build --platform linux/amd64,linux/arm64 -t crowhr:local .
```

Building arm64 under QEMU is slow (several minutes). arm64 was verified once locally (build, argon2, start against PostgreSQL 17); CI builds amd64 only. Publishing multi-arch images to a registry is a separate step that waits for approval.
