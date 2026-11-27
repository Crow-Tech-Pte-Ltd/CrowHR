# Dedicated Crow HR hosting

Run one Crow HR installation per customer on a dedicated host. Each installation owns its Compose network, PostgreSQL database, uploaded files, encryption key and backup volume.

## Start on a VPS with Caddy

Use a Linux VPS that supports the Crow HR release image (amd64 or arm64) with Docker Engine, the Compose plugin, Bash, GNU coreutils, OpenSSL and curl. Point the hostname at the VPS, allow incoming TCP ports 80 and 443, and leave those ports free for Caddy. If you publish an IPv6 address, it needs to reach the VPS too. [Caddy automatic HTTPS requirements](https://caddyserver.com/docs/automatic-https#overview).

From the Crow HR source checkout, choose a project name prefix and substitute the 64-character digest of the approved Crow HR release image.

```sh
./deploy/hosted/crowhr-vps prepare ./customer-hr crowhr-customer hr.example.sg IMAGE_SHA256
./customer-hr/crowhr-vps up
./customer-hr/crowhr-vps setup-code
```

Preparation writes a new private installation directory with its own `.env`, backup passphrase and a project name with a unique suffix. Keep that project name and volume data when updating the installation. Save the generated `BACKUP_PASSPHRASE` in the operator vault before the first backup. Give the setup code to the company owner privately so they can complete the browser wizard.

Caddy provisions and renews the certificate. Its state lives in the project's Caddy volumes. The app and database are reachable only on the Compose network. If startup reaches Docker but HTTPS fails, check the DNS records, firewall and Caddy logs, then retry the same `up` command.

```sh
./customer-hr/crowhr-vps check
./customer-hr/crowhr-vps backup /path/to/private-backup-directory
```

The backup command exports an encrypted archive into an existing directory on a filesystem that supports hard links. Copy the `.tar.gz.age` archive off the VPS and verify the transfer. For uninterrupted nightly copies, configure a transfer using the [backup guide](../../apps/docs/src/content/docs/self-hosting/backups.md#copy-backups-off-the-machine). The installer uses the local Docker context. Run it on the intended VPS.

For direct Compose access to a prepared installation, run from its directory:

```sh
crowhr_compose() {
  docker compose -p "$(cat project)" -f docker-compose.yml -f compose.hosted.yml -f compose.caddy.yml "$@"
}
crowhr_compose logs caddy
```

Use this function in the recovery steps below. For ordinary upgrades, export an encrypted backup first, replace `CROWHR_IMAGE_SHA256` in the installation's `.env` with the approved digest, and run `./crowhr-vps up`.

## Use a reverse proxy already on the host

Use a Docker Compose plugin with support for [`!override`](https://docs.docker.com/reference/compose-file/merge/#replace-value). The overlay replaces the base port binding so the proxy is the only public path to the app.

1. Create a private installation directory containing this repository's `docker-compose.yml`, `.env.example` and `deploy/hosted/compose.yml`. Choose a unique Compose project name for the customer. Keep the configuration and credentials accessible only to the operators of that instance.
2. Copy `.env.example` to `.env` with mode 600. Set the customer's HTTPS `PUBLIC_URL`, the app's local `HTTP_PORT`, and `CROWHR_IMAGE_SHA256` to the 64-character digest of the approved Crow HR release that supports this overlay. Store a unique `BACKUP_PASSPHRASE` in the operator vault and configure it on the host. Keep scheduled backups and backup before migrations enabled. The overlay uses the bundled database and a generated key in the customer project's own volumes.
3. Configure a reverse proxy on the host using the [host proxy instructions](../../apps/docs/src/content/docs/self-hosting/reverse-proxy.md#nginx). Use a certificate for the customer's hostname and set `TRUSTED_PROXIES` to the Docker bridge gateway address the app receives from the host proxy. Allow HTTPS access only to the onboarding operators until the setup wizard is complete. The overlay publishes the app on loopback and PostgreSQL remains on the Compose network.

Run these commands from the installation directory. Replace `crowhr-example` with the customer's project name.

```sh
crowhr_compose() {
  docker compose -p crowhr-example -f docker-compose.yml -f deploy/hosted/compose.yml "$@"
}

crowhr_compose config --quiet
crowhr_compose pull
crowhr_compose up -d --wait
crowhr_compose exec app crowhr setup-code
```

If the bridge gateway is unknown, `crowhr_compose create db` creates the project's network before the app starts. Read its gateway from `docker network inspect crowhr-example_default` and put that address in `TRUSTED_PROXIES` before starting.

Open the setup wizard over HTTPS, give the code to the authorised company owner through a private channel, and verify the owner can sign in with two-step verification. Check **Settings → System** and `crowhr_compose exec app crowhr doctor` for the forwarded scheme, client address, database and backup status. Test invitations and password recovery with the pilot account before importing staff. Leave demo features disabled.

## Back up and rehearse recovery

1. Run `crowhr_compose exec app crowhr backup` and verify the archive ends in `.tar.gz.age` and **Settings → System** shows a successful backup.
2. Use [off-host backup copying](../../apps/docs/src/content/docs/self-hosting/backups.md#copy-backups-off-the-machine) to transfer encrypted archives to dedicated storage outside the app host. Verify the latest backup exists in both places. Configure alerts for missing copies, instance health and low disk space using the operator's monitoring service. The customer and operator should agree how much data loss and downtime they can tolerate.
3. Use the [restore procedure](../../apps/docs/src/content/docs/self-hosting/backups.md#restore) on a fresh, isolated Compose project using the same release and backup passphrase. Keep external mail and integration routing disabled in the rehearsal. Verify owner sign-in, a known document and saved payroll data. Record the backup timestamp and the recovery time. Use fictional data for the initial rehearsal.

Use the same Compose file arguments for every command, including backup and restore. The original install retains its own database and volumes.

## Upgrade

Rehearse the upgrade in the recovery environment first. Copy a fresh encrypted backup off-host, record the old image digest, then update the digest, pull, and run `crowhr_compose up -d --wait`. Check HTTPS, sign-in and the system page. If a schema change needs to be rolled back, restore the pre-upgrade backup on the matching app version in an isolated project before redirecting users.
