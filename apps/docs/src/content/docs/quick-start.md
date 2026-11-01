---
title: Quick start
description: Install Crow HR in three steps with Docker Compose, then finish setup in the browser.
---

You need a machine with Docker Engine 24+ and the Compose plugin, 2 GB of RAM and a few GB of disk. Get the repository first (`git clone https://github.com/Crow-Tech-Pte-Ltd/CrowHR.git`), then:

## 1. Copy the example settings

```sh
cp .env.example .env
```

## 2. Set the address people will open

Edit `.env` and set `PUBLIC_URL`:

```sh
PUBLIC_URL=https://hr.example.sg        # behind a reverse proxy with HTTPS
# PUBLIC_URL=http://192.168.1.20:8080   # or on your office network, no proxy
```

## 3. Start it

```sh
docker compose up -d
```

That is all that is required. The database password, the encryption key and a one-time setup code are generated on first start. Until images are published, this first start builds the image from the checkout (a few minutes).

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
