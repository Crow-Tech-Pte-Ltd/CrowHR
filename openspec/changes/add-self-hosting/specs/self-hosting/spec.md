## Purpose

Defines how a single technical person installs, configures, secures, backs up, restores and upgrades a self-hosted Crow HR with Docker Compose and nothing else.

## ADDED Requirements

### Requirement: One-command install
The repository SHALL ship `docker-compose.yml` and `.env.example` such that copying `.env.example` to `.env`, setting `PUBLIC_URL`, and running `docker compose up -d` results in a working install reachable at `PUBLIC_URL` after the setup wizard. The compose file SHALL define only the app service, `postgres:17-alpine`, and a one-shot `init` service using the app image, with named volumes for app data, Postgres data and backups. Postgres SHALL NOT publish a host port. The app SHALL run as a non-root user. Every variable other than `PUBLIC_URL` SHALL have a working default.

#### Scenario: Fresh install
- **WHEN** a user on a clean Docker host sets only `PUBLIC_URL=http://192.168.1.20:8080` and runs `docker compose up -d`
- **THEN** within 2 minutes `GET /api/health` returns 200, and opening `PUBLIC_URL` shows the setup wizard

### Requirement: Generated secrets
When `CROWHR_SECRET_KEY` is not supplied, the first boot SHALL generate a 32-byte key and write it to the data volume with file mode 0600. When the database password is not supplied, the `init` service SHALL generate one into a shared secrets volume, read by both Postgres (`POSTGRES_PASSWORD_FILE`) and the app. A supplied value SHALL take precedence over a generated one. On every start the app SHALL compare the key against a check value stored in the database. On a mismatch it SHALL exit, explaining that the key does not match this database and that the original key, or the backup containing it, must be restored.

#### Scenario: Key lost after volume wipe
- **WHEN** the app data volume is deleted but the Postgres volume is kept, and the app restarts
- **THEN** the app does not generate a new key over existing data. It exits with "CROWHR_SECRET_KEY does not match this database. Restore the key from your backup (crowhr restore --secrets-only <file>)"

### Requirement: Reverse proxy trust
The app SHALL listen on plain HTTP on `PORT` (default 8080). It SHALL use `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host` only when the direct peer address is within `TRUSTED_PROXIES`, a comma-separated list of IPs and CIDRs, default empty. The client IP SHALL be the right-most address in `X-Forwarded-For` that is not a trusted proxy. Without trust, the peer address is the client IP and the headers are ignored. Cookie security and generated URLs SHALL derive from `PUBLIC_URL`, not from request headers. Owners SHALL see a System diagnostic showing their detected client IP, the scheme, and whether the request came through a trusted proxy.

#### Scenario: Spoofed header without trust
- **WHEN** `TRUSTED_PROXIES` is empty and a client sends `X-Forwarded-For: 1.2.3.4`
- **THEN** rate limits and audit events use the TCP peer address, not 1.2.3.4

#### Scenario: Behind Caddy
- **WHEN** `TRUSTED_PROXIES=172.16.0.0/12` and Caddy (at 172.18.0.5) forwards a request for client 203.0.113.9
- **THEN** audit events record 203.0.113.9

### Requirement: Migrations on start
On start the app SHALL take a Postgres advisory lock, apply pending migrations in order, each in its own transaction, release the lock, and only then accept HTTP traffic. `/api/health` SHALL return 503 `starting` meanwhile. A second instance SHALL wait up to 5 minutes for the lock. When migrations are pending and the database is not empty, a backup SHALL be written to the backups volume first, unless `BACKUP_BEFORE_MIGRATE=false`. A failing migration SHALL roll back its transaction, stop startup with a non-zero exit, and print the migration name, the database error and the path of the pre-migration backup. Starting against a database whose schema is newer than the image SHALL be refused with a message to use the newer image.

#### Scenario: Failed migration
- **WHEN** migration `0042_leave_ledger` fails during an upgrade
- **THEN** the app exits non-zero, the log names `0042_leave_ledger`, the error and the backup file, and migrations up to `0041` remain applied while none of `0042` is

#### Scenario: Downgrade refused
- **WHEN** an image at v1.3 starts against a database migrated by v1.5
- **THEN** it exits with "This database was upgraded by Crow HR 1.5. Run 1.5 or newer"

### Requirement: First-run setup wizard
When the install has no organisation, the app SHALL generate a setup code of 16 characters from an unambiguous alphabet, grouped `XXXX-XXXX-XXXX-XXXX`. It SHALL print the code in a clearly marked block in the container logs on each start until setup completes, and store only its hash. `/setup` SHALL ask for the code, then the organisation legal name, and then the owner's name, email and password, applying the identity password policy. It SHALL then offer MFA enrolment. Five wrong codes from one IP SHALL block that IP for 15 minutes. Until setup completes, every page SHALL redirect to `/setup`. Completing setup SHALL invalidate the code, and from then on `/setup` SHALL return 404.

#### Scenario: Setup code from logs
- **WHEN** the user runs `docker compose logs app` on a fresh install
- **THEN** the log shows the setup code and the URL `<PUBLIC_URL>/setup`

#### Scenario: Setup already done
- **WHEN** anyone opens `/setup` after the owner was created
- **THEN** the response is 404

### Requirement: Startup configuration errors
At startup the app SHALL validate all configuration. On any error it SHALL exit non-zero, printing for each problem the variable name, what is wrong, an example of a valid value and where to set it (`.env`). `PUBLIC_URL` must be an absolute `http` or `https` URL without a path. `TRUSTED_PROXIES` must be valid IPs or CIDRs. `CROWHR_SECRET_KEY`, when supplied, must be 32 bytes in base64 or hex. When the database is unreachable, the app SHALL retry for up to 60 seconds, logging "waiting for database" every 5 seconds, before exiting with the connection error and a hint to check `docker compose ps`.

#### Scenario: PUBLIC_URL missing scheme
- **WHEN** `PUBLIC_URL=hr.acme.sg`
- **THEN** the app exits with "PUBLIC_URL must start with http:// or https://, for example PUBLIC_URL=https://hr.acme.sg. Set it in .env"

### Requirement: Backup and restore
`crowhr backup` SHALL write one archive to the backups volume: a `pg_dump` custom-format dump, the uploaded files directory, the secrets file, and a manifest with app version, schema version, created time and SHA-256 checksums. When `BACKUP_PASSPHRASE` is set, the archive SHALL be encrypted with it. A scheduled backup SHALL run daily at `BACKUP_TIME` (default 02:00 Asia/Singapore), keeping the newest `BACKUP_KEEP` archives (default 14) and deleting older ones. `crowhr restore <file>` SHALL verify the checksums, refuse archives whose schema is newer than the image, stop background jobs, restore the database, files and secrets, run pending migrations, and resume. It SHALL refuse to overwrite a non-empty database without `--force`. Owners SHALL see the last backup time, size and result in Settings → System. When the last successful backup is older than 48 hours, Home SHALL show owners a warning.

#### Scenario: Restore onto a new host
- **WHEN** a backup archive is copied to a new host with a fresh install and `crowhr restore <file>` is run
- **THEN** sign-in works with existing accounts, NRIC values decrypt, and uploaded receipts download

#### Scenario: Corrupt archive
- **WHEN** an archive whose checksum does not match is restored
- **THEN** restore aborts before touching the database and names the corrupt part

### Requirement: Upgrades
Upgrading SHALL be `docker compose pull && docker compose up -d`. Images SHALL be tagged `:<major>`, `:<major>.<minor>`, `:<major>.<minor>.<patch>` and `latest`, and the shipped compose file SHALL reference `:<major>`. Any older version within a major version SHALL upgrade directly to the newest, without intermediate versions. Release notes SHALL mark any manual step. A major version upgrade SHALL require editing the tag in the compose file.

#### Scenario: Skip versions
- **WHEN** an install on 1.1.0 pulls 1.6.2
- **THEN** all migrations from 1.2 to 1.6 apply in order on start, and the app runs
