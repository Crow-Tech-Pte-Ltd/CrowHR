---
title: Reverse proxy (or none)
description: Run Crow HR behind Caddy, nginx, Traefik or Cloudflare Tunnel, or on a LAN without a proxy, and set TRUSTED_PROXIES correctly.
---

Crow HR serves plain HTTP on one port and works behind any reverse proxy, or with none on a trusted LAN. No proxy is bundled. The app's scripts and styles are sent compressed (Brotli or gzip, prepared when the image is built), so compression in the proxy is optional; proxies leave those responses as they are.

Two settings matter:

- `PUBLIC_URL` is what people type, e.g. `https://hr.example.sg`. HTTPS cookies follow from it, so TLS can end at the proxy.
- `TRUSTED_PROXIES` lists the proxy's address so the app believes its `X-Forwarded-For/-Proto/-Host`. If it is wrong, the app logs `Ignoring X-Forwarded-* headers from 172.18.0.5 … set TRUSTED_PROXIES=172.18.0.5`. **Settings → System → This request** and `crowhr doctor` show what the app sees.

## How each example was tested

| Setup | How it was tested |
| --- | --- |
| No proxy (LAN) | Automated: the default compose install. |
| Caddy | Automated: the shipped `Caddyfile.example` (below) in a `caddy:2-alpine` container on the compose network. Caddy installed on the host was not tested. |
| nginx | Automated: the config below in `nginx:1.30-alpine` on the compose network, and the host variant below (with host networking standing in for nginx installed on the host). Only nginx 1.30. |
| Traefik | Automated: the labels below with `traefik:v3.7` on the compose network (Docker provider, `exposedByDefault=false`, entrypoint `websecure` on port 443). Also by hand behind Cloudflare Tunnel, with a file-provider route. |
| Cloudflare Tunnel | By hand: a remote-managed tunnel (token) in front of Traefik. Routing the hostname straight to `http://app:8080`, as below, was not tested. |

The automated test runs on every change to Crow HR. For each proxy it sets `.env` as below (`PUBLIC_URL=https://hr.example.sg`), sends requests in which the client adds its own `X-Forwarded-For`, `X-Forwarded-Host` and `X-Forwarded-Proto`, and checks:

- With `TRUSTED_PROXIES=private`, the app sees the client's real address (in Settings → System and in the sign-in audit entry), scheme `https` and host `hr.example.sg`. The client's own headers are ignored.
- The session cookie is `__Host-` and `Secure`, and plain `http://` redirects to `https://` (Caddy and nginx; the Traefik labels add no port 80 route).
- With `TRUSTED_PROXIES` empty, the app ignores the proxy's headers, records the proxy's own address, and logs the hint above.
- Each proxy still reaches the app after the app container is recreated with a new address, which can happen on an upgrade.

Not tested: getting or renewing a Let's Encrypt certificate, because the test machine has no public name. Instead, Caddy used its internal CA, nginx a self-signed certificate at the paths below, and Traefik (which has no `letsencrypt` resolver there) its default self-signed certificate. Also not tested: HTTP/3, IPv6, and clients on another machine (the test client is the Docker host).

If you run a setup this page does not cover, please [open an issue](https://github.com/Crow-Tech-Pte-Ltd/CrowHR/issues) saying what worked or did not.

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

Caddy installed on the host instead of in Docker: `reverse_proxy 127.0.0.1:8080` and still `TRUSTED_PROXIES=private`. Docker's port forwarding hands the app connections from the host via the Docker network's gateway address (e.g. `172.19.0.1`), not `127.0.0.1`, so `loopback` does not match (seen in the test with nginx on the host).

## nginx

nginx 1.27.3 or later in a container on the compose network, for example `nginx:1.30-alpine` with this file as `/etc/nginx/conf.d/default.conf` and the certificates mounted read-only (`/etc/letsencrypt:/etc/letsencrypt:ro` from certbot on the host):

```nginx
upstream crowhr {
    zone crowhr 64k;
    server app:8080 resolve;         # looked up again, so nginx follows a recreated app container
    resolver 127.0.0.11 valid=10s;   # Docker's DNS
}
server {
    listen 443 ssl;
    http2 on;
    server_name hr.example.sg;
    ssl_certificate     /etc/letsencrypt/live/hr.example.sg/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hr.example.sg/privkey.pem;

    client_max_body_size 25m;   # uploads (receipts, documents)

    location / {
        proxy_pass http://crowhr;
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

`.env`: `PUBLIC_URL=https://hr.example.sg`, `TRUSTED_PROXIES=private`, `BIND_ADDRESS=127.0.0.1`.

Avoid a plain `proxy_pass http://app:8080;`. nginx then looks `app` up only once, at start. When an upgrade recreates the app container with a new address, nginx answers 502 until it is restarted. The `upstream` above looks the name up again within 10 seconds.

nginx installed on the host: in the `upstream`, replace the `server` and `resolver` lines with `server 127.0.0.1:8080;`. Keep `TRUSTED_PROXIES=private`, because the app sees connections from the host as coming from the Docker network's gateway, not `127.0.0.1`. nginx before 1.25.1 (check with `nginx -v`) does not know `http2 on;`; write `listen 443 ssl http2;` instead.

## Traefik

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

The labels assume Traefik v3 with its Docker provider (`exposedByDefault=false`), an entrypoint named `websecure` on port 443 and a certificate resolver named `letsencrypt`. Rename them to match your Traefik. If Traefik logs `Router uses a nonexistent certificate resolver`, the name does not match, and Traefik serves its own self-signed certificate instead.

`.env`: `PUBLIC_URL=https://hr.example.sg`, `TRUSTED_PROXIES=private`, and stop publishing the app port to the world with `BIND_ADDRESS=127.0.0.1`. Traefik sets `X-Forwarded-*` itself; configure its entrypoint `forwardedHeaders.trustedIPs` only for proxies in front of Traefik.

## Cloudflare Tunnel

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

Using Singpass login? Cloudflare's **Bot Fight Mode** challenges Singpass's servers when they fetch your JWKS URL, and Singpass then refuses the sign-in. See [Singpass login](/docs/admin/sso/singpass/), step 2.

## Checking it

1. Open `PUBLIC_URL`, sign in as an owner, go to **Settings → System → This request**: "Your IP as seen" should be your own public or LAN address, scheme `https` behind TLS, and the badge "Trusted proxy".
2. `docker compose exec app crowhr doctor` shows the last request as the app saw it and suggests a `TRUSTED_PROXIES` value when a proxy's headers were ignored.
