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

Images are published to `ghcr.io/crow-tech-pte-ltd/crowhr` for amd64 and arm64, tagged `:<major>`, `:<major>.<minor>`, `:<major>.<minor>.<patch>` and `latest`. `docker-compose.yml` references `:1`, so `pull` brings the newest 1.x. A major upgrade (1 → 2) means editing the tag in `docker-compose.yml` and reading the [release notes](https://github.com/Crow-Tech-Pte-Ltd/CrowHR/releases), which mark any manual step.

To stay on one release, set `CROWHR_IMAGE=ghcr.io/crow-tech-pte-ltd/crowhr:1.0.0` (for example) in `.env`. If you run your own build (`CROWHR_IMAGE=crowhr:local`, see [build the image yourself](/docs/self-hosting/install/#build-the-image-yourself)), upgrade with `git pull`, `docker build -t crowhr:local .` and `docker compose up -d`.

Each published image carries a software bill of materials (SBOM) and a signed build provenance attestation. To check that an image was built from this repository by its release workflow:

```sh
gh attestation verify oci://ghcr.io/crow-tech-pte-ltd/crowhr:1 --owner Crow-Tech-Pte-Ltd
```

## Downgrades

Starting an older image against a database upgraded by a newer one is refused:

```
This database was upgraded by Crow HR 1.5. Run 1.5 or newer
```

To really go back, restore a backup taken before the upgrade (the pre-migrate backup is made for this): see [backups and restore](/docs/self-hosting/backups/).

## Multi-arch builds (amd64 and arm64)

Published images are built natively for amd64 and arm64, and each is started against PostgreSQL 17 before it is published. The Dockerfile builds on both architectures; a local multi-arch build uses QEMU:

```sh
docker buildx build --platform linux/amd64,linux/arm64 -t crowhr:local .
```

Building arm64 under QEMU is slow (several minutes).
