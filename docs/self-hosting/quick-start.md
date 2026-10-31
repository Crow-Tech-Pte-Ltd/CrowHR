# Self-hosting: quick start

Draft for the docs site (WS8 moves it into `apps/docs`). Verified by `e2e/self-host.sh`, which follows these steps in a throwaway compose project.

You need a machine with Docker Engine 24+ and the Compose plugin (`docker compose version`), 2 GB of RAM and a few GB of disk. Crow HR runs as two containers, the app and PostgreSQL 17. There is no Redis and no queue.

## 1. Get the files

```sh
git clone https://github.com/crow-tech-pte-ltd/crowhr.git    # repository name to be confirmed
cd crowhr
```

The image is not published to a registry yet, so the first `docker compose up` builds it from the checkout. That takes a few minutes. Once images are published you will only need `docker-compose.yml` and `.env.example`.

## 2. Configure

```sh
cp .env.example .env
```

Open `.env` and set one line, the address people will type in the browser:

```sh
PUBLIC_URL=https://hr.example.sg          # behind a reverse proxy with HTTPS
# or
PUBLIC_URL=http://192.168.1.20:8080       # on your office network, no proxy
```

Everything else has a working default. Recommended before you store real data:

- `BACKUP_PASSPHRASE`: encrypts backups. Without it, a backup file includes your encryption key in the clear. See [backups](backups.md).
- `TRUSTED_PROXIES`: set it when you use a reverse proxy. See [reverse proxy](reverse-proxy.md).

## 3. Start

```sh
docker compose up -d
docker compose ps          # app and db should become "healthy" within a minute or two
```

On first start Crow HR:

- creates a random database password in the `secrets` volume (the one-shot `init` service);
- applies the database migrations;
- generates the encryption key into the data volume (`/data/secrets/crowhr.key`, mode 600) and logs where it is;
- prints a one-time setup code.

## 4. Finish setup in the browser

```sh
docker compose logs app | grep -A3 'SETUP CODE'
```

Open `PUBLIC_URL` (every page redirects to `/setup` until setup is done). Enter the code, your company's registered name, and the owner's name, email and password. You are then signed in as the owner and asked to set up two-step verification. Afterwards `/setup` no longer exists.

The code changes on every restart; `docker compose exec app crowhr setup-code` prints a fresh one. Five wrong codes from one address block it for 15 minutes.

## 5. Check it

```sh
docker compose exec app crowhr doctor
```

`doctor` checks the configuration, database, migrations, encryption key, disk space, clock and the proxy headers the app sees, and says what to fix. Owners see the same facts in **Settings → System**.

Then make your first backup and copy it somewhere else:

```sh
docker compose exec app crowhr backup
```

## What is where

| Volume | Holds | Back up? |
| --- | --- | --- |
| `data` (`/data`) | uploaded files, `secrets/crowhr.key` | yes (backups include it) |
| `db` | PostgreSQL data | yes (backups include a `pg_dump`) |
| `backups` (`/backups`) | backup archives | copy them off this machine |
| `secrets` (`/run/crowhr-secrets`) | generated database password | no: a restore works with a fresh one |

Only the app's port is published (`HTTP_PORT`, default 8080, on `BIND_ADDRESS`, default all interfaces). PostgreSQL has no host port. The app runs as uid 10001 on a read-only root filesystem.

Next: [configuration reference](configuration.md) · [reverse proxy](reverse-proxy.md) · [backups and restore](backups.md) · [upgrades](upgrades.md) · [troubleshooting](troubleshooting.md)
