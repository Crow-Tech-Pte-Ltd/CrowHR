---
title: crowhr CLI reference
description: Every command of the crowhr server administration CLI, run inside the app container with docker compose exec.
---

The image ships a `crowhr` command for server administration. Run it inside the app container:

```sh
docker compose exec app crowhr <command>
docker compose exec app crowhr help        # the same list, from the installed version
docker compose exec app crowhr --version
```

Commands that change data are recorded in the audit log as CLI actions. Use `docker compose run --rm app crowhr …` when the app container is not running (for example to restore the key before first start).

:::note[Kept in sync with the code]
`apps/docs/tests/cli.test.ts` fails when the CLI gains a command that is not documented on this page.
:::

## Backups

### backup

```sh
crowhr backup [--passphrase-file <file> | --passphrase <text>] [--without-key]
```

Writes a backup archive (database dump, uploaded files and the encryption key) to the backups directory (`/backups`). It is encrypted when `BACKUP_PASSPHRASE` is set or a passphrase option is given; otherwise it prints a warning. `--passphrase` is visible in `ps`, so prefer `--passphrase-file`. `--without-key` leaves the encryption key out: keep the key somewhere else, or the backup cannot restore NRIC, bank and SSO data. See [backups and restore](/docs/self-hosting/backups/).

### restore

```sh
crowhr restore <file> [--force] [--secrets-only] [--passphrase-file <file>] [--no-restart]
```

Restores a backup archive. It verifies every checksum and refuses archives made by a newer Crow HR before changing anything, then restores the database in one transaction.

- `--force` is required when the database already has data.
- `--secrets-only` restores just the encryption key, after losing the data volume while the database survived.
- `--passphrase-file` reads the passphrase for an encrypted archive (otherwise `BACKUP_PASSPHRASE` is used).
- `--no-restart` skips restarting the app afterwards. Inside the container the app restarts itself; elsewhere the command tells you to restart it.

## Database

### migrate

```sh
crowhr migrate
```

Applies pending database migrations under the same advisory lock the app uses on start. You only need it with `MIGRATE_ON_START=false`.

### init-secrets

```sh
crowhr init-secrets
```

Creates the random database password in the shared secrets volume (`DATABASE_PASSWORD_FILE`). The compose `init` service runs it on every `up`; it does nothing when the password already exists.

## Setup and health

### setup-code

```sh
crowhr setup-code
```

Prints a new first-run setup code; the previous one stops working. After setup is complete it says so and prints the sign-in address.

### doctor

```sh
crowhr doctor
```

Checks the configuration, database connection, migrations, encryption key, disk space, backups, clock skew and the proxy headers of the last request the app saw, and says what to fix. It suggests a `TRUSTED_PROXIES` value when a proxy's headers were ignored.

## Owner recovery (break-glass)

### create-reset-link

```sh
crowhr create-reset-link --email <owner email> [--org <slug>]
```

Prints a one-time password reset link for an owner, valid for 60 minutes. Add `--org` when the install has several organisations.

### reset-owner-mfa

```sh
crowhr reset-owner-mfa --email <owner email> [--org <slug>]
```

Clears the owner's two-step verification and prints a reset link. The owner sets a new password and enrols again.

### admin

```sh
crowhr admin verify-audit [--org <slug>]
crowhr admin reset-owner-password --org <slug> --email <email> [--reset-mfa]
```

`verify-audit` checks that the audit log's SHA-256 hash chain is intact and reports the first broken link: an altered event or a gap in the sequence. It does not detect events removed from the end of the log. `reset-owner-password` is the same as `create-reset-link` (with `--reset-mfa`, the same as `reset-owner-mfa`).

## Demo companies

### demo-companies purge

```sh
crowhr demo-companies purge [--expired]
```

Only on a public demo server ([`DEMO_COMPANIES`](/docs/self-hosting/configuration/#demo-companies)). Deletes every demo company with everything in it, including the ones visitors are still using; with `--expired`, only those past their expiry (the scheduler does this every minute anyway). Use it after turning `DEMO_COMPANIES` off. Real organisations are never touched: the database refuses to delete their audit events, and an organisation can't be made a demo company after it is created.

### help and version

```sh
crowhr help        # also --help, -h
crowhr version     # also --version
```
