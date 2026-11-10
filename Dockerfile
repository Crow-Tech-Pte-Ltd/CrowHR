# syntax=docker/dockerfile:1
#
# Crow HR: one image for the app, the `crowhr` CLI and the compose `init` step.
#
#   docker build -t crowhr:local .
#   docker buildx build --platform linux/amd64,linux/arm64 -t crowhr:local .   # multi-arch (see apps/docs/src/content/docs/self-hosting/upgrades.md)
#
# Builder: bun installs the workspace and Vite builds the web app. Runtime: Node 24 runs the
# server's TypeScript directly (type stripping, no transpile step), as a non-root user, with
# the PostgreSQL 17 client for pg_dump/pg_restore/psql and tini as PID 1.

ARG NODE_VERSION=24
ARG BUN_VERSION=1.3.9

# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
ARG BUN_VERSION
RUN npm install --global --no-audit --no-fund "bun@${BUN_VERSION}"
WORKDIR /src
# Manifests first so the dependency layer is cached until bun.lock changes.
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# Every workspace manifest must be present for --frozen-lockfile; docs and demo are not built here.
COPY apps/docs/package.json apps/docs/
COPY apps/demo/package.json apps/demo/
COPY packages/core/package.json packages/core/
COPY packages/demo/package.json packages/demo/
COPY packages/sg-rules/package.json packages/sg-rules/
COPY packages/ui/package.json packages/ui/
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run --cwd apps/web build

# ---------------------------------------------------------------------------------------------
# Production dependencies of the server only (no Vite, React, test tools).
FROM node:${NODE_VERSION}-alpine AS deps
ARG BUN_VERSION
RUN npm install --global --no-audit --no-fund "bun@${BUN_VERSION}"
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# Every workspace manifest must be present for --frozen-lockfile; docs and demo are not built here.
COPY apps/docs/package.json apps/docs/
COPY apps/demo/package.json apps/demo/
COPY packages/core/package.json packages/core/
COPY packages/demo/package.json packages/demo/
COPY packages/sg-rules/package.json packages/sg-rules/
COPY packages/ui/package.json packages/ui/
RUN bun install --frozen-lockfile --production --ignore-scripts --filter @crowhr/server \
 && rm -rf /root/.bun

# Application files: server and core sources, migrations, built web app. Tests stay out.
COPY apps/server/src apps/server/src
COPY packages/core/src packages/core/src
COPY packages/core/drizzle packages/core/drizzle
COPY packages/core/testing/migrations-folder.ts packages/core/testing/migrations-folder.ts
COPY packages/sg-rules/src packages/sg-rules/src
COPY --from=build /src/apps/web/dist apps/web/dist
COPY LICENSE THIRD-PARTY-NOTICES.md ./
# PGlite is only loaded for pglite: development URLs (dynamic import); type packages are unused.
# The Sentry SDK's bundler plugins and CLI are build-time tools (the runtime hook has its own parser).
RUN find apps packages -name '*.test.ts' -delete \
 && rm -rf node_modules/.bun/@electric-sql+pglite@* node_modules/.bun/@types+* \
      node_modules/.bun/@node-rs+argon2-linux-*-gnu@* \
      node_modules/.bun/@sentry+bundler-plugins@* node_modules/.bun/sentry@* \
      node_modules/.bun/oxc-parser@* node_modules/.bun/@oxc-parser+* node_modules/.bun/@oxc-project+* \
 && find apps/server/src -name 'test-helpers.ts' -delete \
 && find apps/web/dist -name '*.map' -delete

# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
# postgresql17-client: pg_dump/pg_restore/psql matching the postgres:17-alpine server.
# npm, npx, corepack and yarn are not needed at runtime: removing them saves ~20 MB.
RUN apk add --no-cache postgresql17-client tini \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && addgroup -S -g 10001 crowhr \
 && adduser -S -D -H -u 10001 -G crowhr -s /sbin/nologin crowhr \
 # Named volumes copy the owner and mode of these directories on first use.
 && mkdir -p /data /backups /run/crowhr-secrets \
 && chown 10001:10001 /data /backups /run/crowhr-secrets \
 && chmod 700 /data /backups /run/crowhr-secrets \
 && printf '#!/bin/sh\nexec node /app/apps/server/src/cli/main.ts "$@"\n' > /usr/local/bin/crowhr \
 && chmod 755 /usr/local/bin/crowhr

WORKDIR /app
COPY --from=deps --chown=root:root /app /app

# Commit the image is built from, for error-monitoring releases (crowhr@<version>+<commit>):
#   docker build --build-arg CROWHR_GIT_SHA=$(git rev-parse HEAD) -t crowhr:local .   (release.yml passes it)
# Declared here, after the slow layers, so a new commit only rebuilds the ones below.
ARG CROWHR_GIT_SHA=""
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    BACKUP_DIR=/backups \
    WEB_DIST_DIR=/app/apps/web/dist \
    CROWHR_CONTAINER=1 \
    CROWHR_GIT_SHA=${CROWHR_GIT_SHA} \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=4 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
# instrument.ts starts optional error monitoring (SENTRY_DSN) before the app loads; without it, it does nothing.
CMD ["node", "--import", "./apps/server/src/instrument.ts", "apps/server/src/main.ts"]

LABEL org.opencontainers.image.title="Crow HR" \
      org.opencontainers.image.description="Self-hostable HR and payroll for Singapore SMEs" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="Crow Tech Pte. Ltd."
