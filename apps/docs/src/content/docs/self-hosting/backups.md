---
title: Backups and restore
description: What a Crow HR backup contains, how scheduled and manual backups work, how to copy them off the server and how to restore.
---

Verified by `e2e/self-host.sh`: backup, delete everything (`docker compose down -v`), fresh install, restore, then the organisation, uploaded files, encryption key and owner sign-in are back.

## What a backup contains

One file in the `backups` volume, `crowhr-backup-<UTC time>[-scheduled|-pre-migrate].tar.gz` (`.tar.gz.age` when encrypted):

- `manifest.json`: app version, database schema version, time, SHA-256 of every part;
- `db.dump`: `pg_dump --format=custom` of the whole database;
- `files/…`: every uploaded file;
- `secrets/crowhr.key`: the encryption key.

**The key is included by default**, because a backup without it cannot restore NRIC, bank or SSO data, and losing the key is far more common than losing a backup to theft. That means an unencrypted backup file is as sensitive as the live system. Set `BACKUP_PASSPHRASE` in `.env` (at least 12 characters, kept outside the server). Then every archive is encrypted with [age](https://age-encryption.org); you can also decrypt it with the standard tool: `age -d backup.tar.gz.age > backup.tar.gz`. Scheduled backups refuse to run until a passphrase is set. Home and Settings → System explain that encryption is required. Manual unencrypted backups remain available with a prominent warning.

## Automatic backups

**First set `BACKUP_PASSPHRASE` (at least 12 characters) in `.env`, save it outside this server, and restart Crow HR.** The scheduler records an actionable failure without dumping data when it is unset. This keeps a restore-ready archive, including the master key, encrypted as one unit.

Daily at `BACKUP_TIME` (default 02:00 Singapore time), keeping the newest `BACKUP_KEEP` (default 14). A backup is also taken before any database upgrade (`BACKUP_BEFORE_MIGRATE`). Results, sizes and failures appear in Settings → System; Owners see a warning on Home when the last successful scheduled backup is more than 48 hours old.

## Manual backup

```sh
docker compose exec app crowhr backup
docker compose exec app crowhr backup --passphrase-file /run/secrets/pp   # or --passphrase '…' (visible in `ps`)
docker compose exec app crowhr backup --without-key                       # key not included: keep it separately!
```

## Copy backups off the machine

The backups volume sits on the same disk as the data. Copy archives elsewhere regularly:

```sh
docker compose cp app:/backups/crowhr-backup-20261031T020000Z-scheduled.tar.gz.age ./
```

Nightly copy with rclone (any S3/B2/Drive remote, configured with `rclone config`), from the host's crontab:

```sh
30 3 * * * docker run --rm -v crowhr_backups:/backups:ro -v $HOME/.config/rclone:/config/rclone rclone/rclone copy /backups remote:crowhr-backups
```

(`crowhr_backups` is `<compose project>_backups`; check with `docker volume ls`. The rclone line is an example and is not part of the tested script.)

## Restore

Restore replaces the database, uploaded files and key with the backup. It first extracts and verifies every checksum, and refuses archives made by a newer Crow HR, before changing anything. The database is restored in a single transaction: if it fails, nothing changed. During the restore the site answers "Restoring backup" (503) and background jobs pause; afterwards the app restarts itself.

Onto a new machine (or after `docker compose down -v`):

```sh
cp .env.example .env            # set PUBLIC_URL (and BACKUP_PASSPHRASE if the backup is encrypted)
docker compose up -d
docker compose exec -T app sh -c 'cat > /backups/restore.tar.gz' < crowhr-backup-….tar.gz
docker compose exec app crowhr restore /backups/restore.tar.gz
docker compose ps               # app restarts and becomes healthy
```

(Copy the file in with `exec … cat`, not `docker compose cp`: `cp` creates it owned by root, which the app user cannot read.)

Over an install that already has data, add `--force`; without it the restore stops and explains. Encrypted archives need `BACKUP_PASSPHRASE` in `.env` or `--passphrase-file <file>`.

## Lost the data volume (key gone, database intact)

The app refuses to start rather than generate a new key over existing encrypted data:

```
CROWHR_SECRET_KEY does not match this database. Restore the key from your backup (crowhr restore --secrets-only <file>)
```

Recover just the key from any backup of this install:

```sh
docker compose run --rm app crowhr restore --secrets-only /backups/<file>
docker compose up -d
```

Uploaded files that were only in the lost volume come back with a full restore of the latest backup.
