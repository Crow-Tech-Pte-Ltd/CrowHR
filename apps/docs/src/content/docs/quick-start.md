---
title: Quick start
description: Install Crow HR with Docker Compose, then finish setup in the browser.
---

You need a machine with Docker Engine 24+ and the Compose plugin, 2 GB of RAM and a few GB of disk.

Using an AI coding agent such as Claude Code or Codex? **Copy for my AI** under the title copies a prompt that lets it do this install with you; see [set up with an AI agent](/docs/self-hosting/ai-agent/).

## 1. Get the files

```sh
git clone https://github.com/Crow-Tech-Pte-Ltd/CrowHR.git && cd CrowHR
```

Only `docker-compose.yml` and `.env.example` are needed from the checkout.

## 2. Copy the example settings

```sh
cp .env.example .env
```

## 3. Set the address people will open

Edit `.env` and set `PUBLIC_URL`:

```sh
PUBLIC_URL=https://hr.example.sg        # behind a reverse proxy with HTTPS
# PUBLIC_URL=http://192.168.1.20:8080   # or on your office network, no proxy
```

## 4. Start it

```sh
docker compose up -d
```

That is all that is required. Compose pulls the published image (`ghcr.io/crow-tech-pte-ltd/crowhr:1`, amd64 or arm64), and the database password, the encryption key and a one-time setup code are generated on first start.

## Then finish in the browser

1. Print the setup code: `docker compose logs app | grep -A3 'SETUP CODE'`.
2. Open `PUBLIC_URL`. You land on `/setup`.
3. Enter the code, the company's registered name and the owner's name, email and password. You are signed in as the owner.
4. Run `docker compose exec app crowhr backup` and copy the archive somewhere safe.

Before you store real data, set `BACKUP_PASSPHRASE` in `.env` (backups contain the encryption key) and, behind a proxy, `TRUSTED_PROXIES`. The full walkthrough is [install with Docker Compose](/docs/self-hosting/install/).

## What next

- Put it behind HTTPS: [reverse proxy](/docs/self-hosting/reverse-proxy/).
- Fill in the company profile and structure: [company and structure](/docs/admin/company-and-structure/).
- Add or import employees: [adding employees](/docs/people/adding-employees/), [importing from CSV](/docs/people/importing/).
- Turn on single sign-on: [sign-in methods](/docs/admin/sign-in-methods/).
