You are helping me set up Crow HR for my company: the free, open-source (MIT) HR and payroll software for Singapore SMEs, https://github.com/Crow-Tech-Pte-Ltd/CrowHR. Goal: Crow HR running on my server with Docker Compose at an address my staff can reach (over HTTPS, unless it stays on our office network), my owner account created with two-step verification, encrypted backups running and copied off the machine, and my people able to sign in on the web and in the Crow HR phone app.

Work one step at a time. Before you run a command, tell me what it does and why, and show me the output when something fails. Follow the Crow HR docs at https://hr.crow.sg/docs/. If what you see doesn't match these instructions, read the matching page before you improvise: every page is also available as Markdown (add `.md` to its address, for example https://hr.crow.sg/docs/self-hosting/install.md), and https://hr.crow.sg/docs/llms-full.txt has all of them in one file. Don't invent settings: every variable is in https://hr.crow.sg/docs/self-hosting/configuration.md.

## Before you start, ask me

1. Where will it run: a VPS or cloud server with a public IP, a machine on our office network only, or a server that already runs Docker or a web server? Are you on that machine, or do you reach it over SSH (which host and user)?
2. The address people will type: a domain or subdomain such as `hr.example.sg` (and who manages its DNS), or an office-network address such as `http://192.168.1.20:8080`.
3. How HTTPS should work: Caddy in Docker (needs ports 80 and 443 open and a DNS record pointing at the server), an nginx or Traefik that already runs there, a Cloudflare Tunnel (no open ports; the domain's DNS must be on Cloudflare), or none (office network only).
4. Whether Crow HR should send email (invitations, password resets, notifications) through an SMTP server, and which one. Without email everything still works: invitations show a link to copy.
5. Where backups should be copied to: another computer, or a remote that rclone supports (S3, B2, Google Drive and others).

## Prerequisites

- A Linux server (amd64 or arm64) with Docker Engine 24 or later and the Compose plugin (`docker compose version`), 2 GB of RAM and a few GB of disk.
- Crow HR runs as two containers, the app and PostgreSQL 17. There is no Redis and no queue.

## Steps

1. **Get the files.** `git clone https://github.com/Crow-Tech-Pte-Ltd/CrowHR.git`, then `cd CrowHR`. Compose pulls the published image `ghcr.io/crow-tech-pte-ltd/crowhr:1`, which follows the newest 1.x release.
2. **Configure.** `cp .env.example .env`, then set:
   - `PUBLIC_URL`: exactly the address people will type, with scheme, host and port. An `https` address sets secure cookies, which browsers drop over plain `http`.
   - `BACKUP_PASSPHRASE`: at least 12 characters. Ask me to type it into `.env` myself rather than into this chat, and remind me to keep a copy outside this server. Scheduled backups don't run without it, and an encrypted backup can't be restored without it.
   - With a proxy or tunnel on this machine: `TRUSTED_PROXIES=private` and `BIND_ADDRESS=127.0.0.1`. On the office network with no proxy: leave `TRUSTED_PROXIES` empty.
   - Email, only if I want it: `SMTP_URL` (`smtps://user:password@smtp.example.sg:465`, or `smtp://user:password@smtp.example.sg:587`; URL-encode special characters, `@` becomes `%40`) and `MAIL_FROM` (for example `"Crow HR <hr@example.sg>"`, an address my mail provider lets me send from). I type the SMTP password myself.
   - Leave everything else at its default unless the configuration reference says my setup needs it.
3. **HTTPS**, following https://hr.crow.sg/docs/self-hosting/reverse-proxy.md for my choice:
   - Caddy: `cp deploy/caddy/docker-compose.override.example.yml docker-compose.override.yml` and `cp deploy/caddy/Caddyfile.example Caddyfile`, then set my domain in `Caddyfile`. DNS: an `A` record for the domain pointing at the server (DNS only, not proxied, if it's on Cloudflare), and ports 80 and 443 open in the server's and the provider's firewall.
   - nginx or Traefik: use that page's example as written. For nginx keep the `upstream` block with its `resolver`, `client_max_body_size 25m`, and `proxy_set_header X-Forwarded-For $remote_addr` (replace the header, don't append to it).
   - Cloudflare Tunnel: add the `cloudflared` service from that page to `docker-compose.override.yml`. I create the tunnel in the Cloudflare Zero Trust dashboard, route the hostname to `http://app:8080` and put `CLOUDFLARE_TUNNEL_TOKEN` into `.env` myself. If we'll use Singpass login, I must not turn on Bot Fight Mode for that hostname.
4. **Start.** `docker compose up -d` (always all services, never `docker compose up app`), then `docker compose ps` until `app` and `db` are healthy, usually within a minute or two.
5. **Owner account.** I run `docker compose logs app | grep -A3 'SETUP CODE'` myself, so the code stays out of this chat (a fresh one: `docker compose exec app crowhr setup-code`; the code changes on every restart). Then stop and wait: I open `PUBLIC_URL`, enter the code, the company's registered name and the owner's name, email and password, and turn on two-step verification.
6. **Check it.** Run `docker compose exec app crowhr doctor` and fix whatever it reports. Then I open **Settings → System → This request**: it should show my own IP address, `https` behind TLS, and "Trusted proxy" when there is a proxy.
7. **Backups.** Take the first one with `docker compose exec app crowhr backup`. Then set up a nightly copy off the machine, for example `docker compose cp app:/backups/<file> ./` to another computer, or the rclone line on https://hr.crow.sg/docs/self-hosting/backups.md in the host's crontab (the volume is `<compose project>_backups`; check with `docker volume ls`). Scheduled backups run daily at 02:00 Singapore time (`BACKUP_TIME`) once `BACKUP_PASSPHRASE` is set. If I want, help me test a restore on another machine with the steps on that page.
8. **My people.** Tell me what comes next in Crow HR: the company profile and payroll settings, then adding employees in **People**, one by one or by importing a CSV. Hiring someone sends their invitation; without email, I copy the invitation link from the app. Each person finds the code that connects the Crow HR phone app (App Store and Google Play) in **My profile → Mobile app**. The app needs HTTPS; on the office network it connects over plain HTTP only to a private address, after a warning.

## Verify at the end

- `docker compose ps` shows `app` and `db` healthy, and `PUBLIC_URL` opens the sign-in page over HTTPS with a valid certificate (or over HTTP on the office network).
- `<PUBLIC_URL>/api/health` answers with the Crow HR version.
- `crowhr doctor` reports nothing to fix, and **Settings → System** shows the last backup.
- I'm signed in as the owner with two-step verification on, and a backup archive exists outside the server.

## Upgrading later

`docker compose pull`, `docker compose up -d`, then `docker compose logs -f app` until it says "Crow HR is ready". A backup is taken before every database upgrade. To decide when to upgrade, pin a release with `CROWHR_IMAGE=ghcr.io/crow-tech-pte-ltd/crowhr:<version>` in `.env`. Read the release notes (https://github.com/Crow-Tech-Pte-Ltd/CrowHR/releases) before a major upgrade.

## Common pitfalls

- `Crow HR cannot start: … PUBLIC_URL …` or another named setting: fix `.env` as the message says, then `docker compose up -d`.
- Everyone gets the same IP address and sign-in limits hit the whole office: `TRUSTED_PROXIES` doesn't match the proxy. The log says `Ignoring X-Forwarded-* headers from <ip>`, and `crowhr doctor` suggests a value.
- Signed out right after signing in: `PUBLIC_URL` doesn't match the address in the browser exactly.
- `Port 8080 is already in use`: change `HTTP_PORT` in `.env`.
- Caddy can't get a certificate: the DNS record is proxied (orange cloud), or ports 80 and 443 aren't reachable from the internet.
- `CROWHR_SECRET_KEY does not match this database`: the data volume or the key was lost. Restore the key from a backup with `crowhr restore --secrets-only`; never delete the database to "fix" it.

## Rules for you

- Never run `docker compose down -v`, delete Docker volumes, or remove `/data/secrets/crowhr.key`. That destroys the database, or the key that decrypts NRIC, bank and single sign-on data.
- Keep secrets out of this chat: setup codes, passwords, `BACKUP_PASSPHRASE`, SMTP passwords and tunnel tokens. Ask me to type them where they belong.
- Don't put Crow HR on the internet without HTTPS, don't publish the database port, and don't switch off two-step verification or other security settings to make something work.
- I make DNS, Cloudflare and other dashboard changes in my own browser. Tell me exactly what to set.
- Don't enter real employee data while testing. To try things first, the in-browser demo at https://hr.crow.sg uses a fictional company.
- When we're done, give me a short summary: the address, where `.env` and the backups are, and the commands to back up, restore and upgrade.
