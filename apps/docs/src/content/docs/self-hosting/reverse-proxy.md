---
title: Reverse proxy (or none)
description: Run Crow HR behind Caddy, nginx, Traefik or Cloudflare Tunnel, or on a LAN without a proxy, and set TRUSTED_PROXIES correctly.
---

Crow HR serves plain HTTP on one port and works behind any reverse proxy, or with none on a trusted LAN. No proxy is bundled.

Two settings matter:

- `PUBLIC_URL` is what people type, e.g. `https://hr.example.sg`. HTTPS cookies follow from it, so TLS can end at the proxy.
- `TRUSTED_PROXIES` lists the proxy's address so the app believes its `X-Forwarded-For/-Proto/-Host`. If it is wrong, the app logs `Ignoring X-Forwarded-* headers from 172.18.0.5 … set TRUSTED_PROXIES=172.18.0.5`. **Settings → System → This request** and `crowhr doctor` show what the app sees.

## Which examples were tested

| Setup | Status | How |
| --- | --- | --- |
| No proxy (LAN) | <span class="crow-pill crow-pill--tested">Tested</span> | The default compose install in `e2e/self-host.sh`. |
| Caddy | <span class="crow-pill crow-pill--tested">Tested</span> | `e2e/self-host.sh` runs a Caddy container on the compose network, over HTTP only: trusted versus untrusted proxy, spoofed `X-Forwarded-For` ignored. Caddy's automatic HTTPS itself was not exercised. |
| nginx | <span class="crow-pill crow-pill--untested">Not tested</span> | A standard configuration that has not been run against Crow HR yet. |
| Traefik | <span class="crow-pill crow-pill--untested">Not tested</span> | Same. |
| Cloudflare Tunnel | <span class="crow-pill crow-pill--untested">Not tested</span> | Same. |

If you run one of the untested setups, please report what worked (or did not) so this table can be updated.

## No proxy (LAN)

```sh
PUBLIC_URL=http://192.168.1.20:8080
TRUSTED_PROXIES=
```

Fine on an office network you trust. Passwords travel unencrypted over the LAN, and Settings → Security shows a "Not using HTTPS" warning. Do not expose this to the internet.

## Caddy (automatic HTTPS)

Easiest when the machine has a public DNS name. The repository ships an optional override:

```sh
cp deploy/caddy/docker-compose.override.example.yml docker-compose.override.yml
cp deploy/caddy/Caddyfile.example Caddyfile      # set your domain
```

`.env`:

```sh
PUBLIC_URL=https://hr.example.sg
TRUSTED_PROXIES=private
BIND_ADDRESS=127.0.0.1
```

`Caddyfile`:

```txt
hr.example.sg {
	encode zstd gzip
	reverse_proxy app:8080
}
```

`docker compose up -d` starts Caddy too. Caddy replaces any client-supplied `X-Forwarded-For` with the real client address.

Caddy installed on the host instead of in Docker: `reverse_proxy 127.0.0.1:8080` and `TRUSTED_PROXIES=loopback`. Docker's port forwarding may present host connections as the bridge gateway (e.g. `172.17.0.1`); if Settings → System shows that as the peer, use `TRUSTED_PROXIES=private`.

## nginx (not tested)

```nginx
server {
    listen 443 ssl http2;
    server_name hr.example.sg;
    ssl_certificate     /etc/letsencrypt/live/hr.example.sg/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hr.example.sg/privkey.pem;

    client_max_body_size 25m;   # uploads (receipts, documents)

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $remote_addr;   # replace, don't append a client's value
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_read_timeout 120s;
    }
}
server {
    listen 80;
    server_name hr.example.sg;
    return 301 https://$host$request_uri;
}
```

`.env`: `PUBLIC_URL=https://hr.example.sg`, `BIND_ADDRESS=127.0.0.1`, `TRUSTED_PROXIES=loopback` (or `private` if the peer shows as the Docker gateway). nginx in a container on the compose network: `proxy_pass http://app:8080;` and `TRUSTED_PROXIES=private`.

## Traefik (not tested)

Add labels to the `app` service in `docker-compose.override.yml`, with Traefik on the same Docker network:

```yaml
services:
  app:
    labels:
      - traefik.enable=true
      - traefik.http.routers.crowhr.rule=Host(`hr.example.sg`)
      - traefik.http.routers.crowhr.entrypoints=websecure
      - traefik.http.routers.crowhr.tls.certresolver=letsencrypt
      - traefik.http.services.crowhr.loadbalancer.server.port=8080
```

`.env`: `PUBLIC_URL=https://hr.example.sg`, `TRUSTED_PROXIES=private`, and stop publishing the app port to the world with `BIND_ADDRESS=127.0.0.1`. Traefik sets `X-Forwarded-*` itself; configure its entrypoint `forwardedHeaders.trustedIPs` only for proxies in front of Traefik.

## Cloudflare Tunnel (not tested)

No open ports needed. Add `cloudflared` to `docker-compose.override.yml`:

```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
    restart: unless-stopped
```

In the Cloudflare Zero Trust dashboard, route the public hostname `hr.example.sg` to `http://app:8080`. `.env`:

```sh
PUBLIC_URL=https://hr.example.sg
TRUSTED_PROXIES=private
BIND_ADDRESS=127.0.0.1
CLOUDFLARE_TUNNEL_TOKEN=…
```

cloudflared sends `X-Forwarded-For` with the visitor's address (Cloudflare also sends `CF-Connecting-IP`, which Crow HR does not read) and `X-Forwarded-Proto: https`.

## Checking it

1. Open `PUBLIC_URL`, sign in as an owner, go to **Settings → System → This request**: "Your IP as seen" should be your own public or LAN address, scheme `https` behind TLS, and the badge "Trusted proxy".
2. `docker compose exec app crowhr doctor` shows the last request as the app saw it and suggests a `TRUSTED_PROXIES` value when a proxy's headers were ignored.
