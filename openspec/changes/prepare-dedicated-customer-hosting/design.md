## Context

The existing Compose stack gives an installation its own database, files, keys and backup volumes. Crow Tech can operate one instance per customer while keeping the existing self-host install and demo unchanged.

## Goals

- Use one app stack with its own network and volumes on a dedicated customer host.
- Catch configuration errors before the app can serve customer data.
- Reuse the existing encrypted backup and restore implementation.

## Decisions

- An optional Compose overlay supplies the hosted settings while the existing file owns the services and volumes. The hosted app binds to host loopback behind a configured HTTPS reverse proxy. Each customer uses a distinct Compose project and host.
- The server validates hosted-only startup constraints in the same configuration parser used by the container and CLI. Guardrails include HTTPS, a trusted proxy, scheduled encrypted backups, backup before migrations and a protected setup wizard. Demo settings are refused in hosted mode.
- The operator guide covers access handoff, monitoring, copying encrypted backups to separate storage, and rehearsal on an isolated instance. It links to the existing backup and reverse-proxy procedures.

## Risks / Trade-offs

- Backups on the database host share its failure domain. Copy encrypted archives off-host and record a restore rehearsal before onboarding.
- Independent hosts add per-customer operations. Pin releases and rehearse upgrades with a fresh encrypted backup.

## Migration Plan

Apply the overlay to a new, uniquely named project on an approved host. Existing self-host instances keep their current configuration.
