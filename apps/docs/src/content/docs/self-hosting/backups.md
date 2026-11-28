---
title: Backups and restore
description: What a Crow HR backup contains, how scheduled and manual backups work, how to copy them off the server and how to restore.
---

The self-hosting smoke test runs on `main` and on pull requests that affect self-hosting. It creates an encrypted backup, removes the disposable installation, restores the archive into a fresh install and checks that the organisation, uploaded files, encryption key and owner sign-in are back.

## What a backup contains

One file in the `backups` volume, `crowhr-backup-<UTC time>[-scheduled|-pre-migrate].tar.gz` (`.tar.gz.age` when encrypted):

- `manifest.json`: app version, database schema version, time, SHA-256 of every part;
- `db.dump`: `pg_dump --format=custom` of the whole database;
- `files/…`: every uploaded file;
- `secrets/crowhr.key`: the encryption key.

**The key is included by default**, because a backup without it cannot restore NRIC, bank or SSO data, and losing the key is far more common than losing a backup to theft. That means an unencrypted backup file is as sensitive as the live system. Set `BACKUP_PASSPHRASE` in `.env` (at least 12 characters, kept outside the server). Then every archive is encrypted with [age](https://age-encryption.org); you can also decrypt it with the standard tool: `age -d backup.tar.gz.age > backup.tar.gz`. Scheduled backups refuse to run until a passphrase is set. A manual backup without a passphrase still works, with a warning.

## Automatic backups

**Scheduled backups need `BACKUP_PASSPHRASE`.** Set it in `.env` (at least 12 characters), keep a copy outside this server and run `docker compose up -d`. Without it, each scheduled backup is recorded as failed and nothing is written.

Daily at `BACKUP_TIME` (default 02:00 Singapore time), keeping the newest `BACKUP_KEEP` (default 14). A backup is also taken before any database upgrade (`BACKUP_BEFORE_MIGRATE`). Results, sizes and failures appear in Settings → System; owners see a warning on Home when the last successful backup is more than 48 hours old, and when scheduled backups are disabled because `BACKUP_PASSPHRASE` is not set (both, if both apply).

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

### Send encrypted backups to S3-compatible storage

On a Linux host with systemd and rootful Docker, the optional upload timer copies completed, encrypted archives from your existing Compose backup volume to a private bucket. It runs hourly, so it can pick up scheduled backups even if the app missed its usual backup time. The app continues to make and rotate its local backups as before.

1. Create a private bucket and dedicate a bucket or prefix to each installation. In the bucket, configure expiry to match your off-host retention needs. Crow HR's local `BACKUP_KEEP` applies only to the local volume. The uploader copies missing files without overwriting existing backups or deleting remote objects.
2. Install [rclone](https://rclone.org/install/) on the Docker host. In `rclone config`, choose **Amazon S3 Compliant Storage Providers**, then AWS or your provider. For R2, use the Cloudflare provider and the account's HTTPS S3 API endpoint. See [AWS-compatible rclone settings](https://rclone.org/s3/) and [Cloudflare R2 configuration](https://developers.cloudflare.com/r2/examples/rclone/). Use a credential scoped to this bucket or prefix. The upload job needs to list the prefix, read object metadata and upload objects. For multipart uploads, permit aborting its own incomplete uploads. Keep the credentials and archive passphrase in your operations vault. Configure the uploader with a root-readable rclone config supplied through the service's credential file.
3. From a Crow HR checkout on the Docker host, install the optional files and prepare the job's configuration. Use your installation's Compose project name throughout. The standard volume name is `<compose project>_backups`. Verify it on the host with `docker volume ls`.

   ```sh
   sudo install -d -m 0700 /etc/crowhr/backups
   sudo install -m 0755 deploy/hosted/backup/crowhr-backup-upload /usr/local/bin/
   sudo install -m 0644 deploy/hosted/backup/crowhr-backup-upload@.service /etc/systemd/system/
   sudo install -m 0644 deploy/hosted/backup/crowhr-backup-upload@.timer /etc/systemd/system/
   ```

   Put the rclone config at `/etc/crowhr/backups/client-a.rclone.conf`, owned by root with mode `0600`. Put these settings in `/etc/crowhr/backups/client-a.env`, substituting the actual volume, rclone remote and destination.

   ```ini
   BACKUP_VOLUME=crowhr-client-a_backups
   BACKUP_DESTINATION=r2:private-hr-backups/client-a
   ```

4. Create an encrypted archive with `docker compose exec app crowhr backup` from the installation directory. Then run the upload once and check the object in storage before enabling the timer.

   ```sh
   sudo systemctl daemon-reload
   sudo systemctl start crowhr-backup-upload@client-a.service
   sudo journalctl -u crowhr-backup-upload@client-a.service -n 30
   sudo rclone --config /etc/crowhr/backups/client-a.rclone.conf lsf r2:private-hr-backups/client-a
   sudo systemctl enable --now crowhr-backup-upload@client-a.timer
   ```

   Use the same Compose arguments as the installation for every Crow HR command. **Settings → System** reports local backup creation. Monitor the upload service for failures and alert if the bucket's latest scheduled archive is past your recovery target. A local backup job can succeed while its off-host copy is delayed.

### Rehearse a restore from the bucket

Use a fresh isolated Compose project on a separate machine or network, with the version recorded when you took the backup and the matching passphrase from your vault. Keep external email, SSO and integrations isolated during the rehearsal. Download a specific encrypted object with a separate read credential, then follow the restore steps below with that file.

```sh
umask 077
rclone copyto r2:private-hr-backups/client-a/crowhr-backup-20261031T020000Z-scheduled.tar.gz.age ./restore.tar.gz.age
```

Check that the restored owner can sign in, read a known uploaded file and retrieve the expected payroll data. Record the timestamp of the recovered backup and how long recovery took. Repeat the rehearsal after changing the bucket, credentials or restore procedure.

## Restore

Restore replaces the database, uploaded files and key with the backup. It first extracts and verifies every checksum, and refuses archives made by a newer Crow HR, before changing anything. The database is restored in a single transaction: if it fails, nothing changed. During the restore the site answers "Restoring backup" (503) and background jobs pause; afterwards the app restarts itself.

Onto a new machine (or after `docker compose down -v`):

```sh
cp .env.example .env            # set PUBLIC_URL (and BACKUP_PASSPHRASE if the backup is encrypted)
docker compose up -d
docker compose exec -T app sh -c 'umask 077; cat > /backups/restore.tar.gz.age' < ./restore.tar.gz.age
docker compose exec app crowhr restore /backups/restore.tar.gz.age
docker compose ps               # app restarts and becomes healthy
```

The commands show an encrypted archive. For a plain archive, use `.tar.gz` in both commands. Using `exec … cat` gives the app's user ownership of the imported file so the restore process can read it.

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
