# Self-hosting: troubleshooting

Draft for the docs site. Start with:

```sh
docker compose ps                      # is everything up and healthy?
docker compose logs --tail=100 app     # the app says what is wrong and what to run
docker compose exec app crowhr doctor  # configuration, database, key, disk, clock, proxy headers
```

## The app exits right after starting

| Log says | Fix |
| --- | --- |
| `Crow HR cannot start: 1 setting needs fixing. - PUBLIC_URL …` | Edit `.env` as the message says (every message names the variable and gives an example), then `docker compose up -d`. Exit code 78. |
| `PUBLIC_URL is not set` | `cp .env.example .env` and set `PUBLIC_URL`. |
| `Cannot reach the database after 60 s` | `docker compose ps` and `docker compose logs db`. With an external database, check `DATABASE_URL`. |
| `DATABASE_PASSWORD_FILE points to … cannot be read` | The `init` service did not run: use `docker compose up -d` (all services), not `docker compose up app`. |
| `CROWHR_SECRET_KEY does not match this database` | The data volume (key file) was lost or `CROWHR_SECRET_KEY` changed. Put the original value back, or `docker compose run --rm app crowhr restore --secrets-only /backups/<file>`. Never delete the database to "fix" this. |
| `This database was upgraded by Crow HR X. Run X or newer` | You started an older image. Set the newer tag again in `docker-compose.yml`. |
| `Database migration 0042_… failed` | Your data is intact. Go back to the previous image tag; a pre-migration backup path is in the message. Report the error. |
| `Could not take the backup that runs before database migrations` | Usually disk space (`docker compose exec app df -h /backups`). Free space, or set `BACKUP_BEFORE_MIGRATE=false` once. |
| `Another Crow HR instance has held the migration lock` | Two app containers on one database. `docker compose down`, then `docker compose up -d`. |
| `Port 8080 is already in use` | Change `HTTP_PORT` in `.env` (the host side). |

## I lost the setup code

`docker compose logs app | grep -A3 'SETUP CODE'`, or print a new one: `docker compose exec app crowhr setup-code`. The code changes on every restart. After five wrong codes your address is blocked for 15 minutes.

## The owner is locked out

Break-glass, from the server (audited as a CLI action):

```sh
docker compose exec app crowhr create-reset-link --email owner@example.sg      # one-time password reset link, 60 minutes
docker compose exec app crowhr reset-owner-mfa --email owner@example.sg        # also clears two-step verification
```

Add `--org <slug>` when the install has several organisations.

## Behind a proxy, everyone has the same IP / sign-in limits hit the whole office

The app does not trust your proxy. Logs show `Ignoring X-Forwarded-* headers from <ip>`. Set `TRUSTED_PROXIES=<ip>` (or `private`) in `.env`, `docker compose up -d`, and check Settings → System → This request. See [reverse proxy](reverse-proxy.md).

## Signed out immediately / cookies not kept

`PUBLIC_URL` must match the address in the browser exactly (scheme, host, port). An `https` `PUBLIC_URL` sets `Secure` cookies, which browsers drop over plain `http`.

## "Restoring backup" or "A backup was restored" does not go away

A restore was interrupted. `docker compose restart app` clears the flag; the database restore itself is all-or-nothing.

## Backups fail

Settings → System shows the last error. Common causes: disk full (`docker compose exec app df -h /backups`), an external PostgreSQL newer than 17 (the bundled `pg_dump` is 17), or a wrong `BACKUP_PASSPHRASE` length (at least 12 characters).

## Disk is filling up

Container logs are capped at 3 × 10 MB per container. Backups are capped by `BACKUP_KEEP`. Old images: `docker image prune`.
