## Why

Crow Tech wants to operate Crow HR for an initial customer. An operator needs a repeatable deployment and recovery procedure with a dedicated database and storage for each customer.

## What Changes

- Add an opt-in Compose overlay for a dedicated installation with a version-pinned image, loopback-only app port, HTTPS, disabled demo features, and scheduled encrypted backups.
- Add hosted startup validation and an operator runbook for setup, monitoring, off-host backup transfer, and restore rehearsal.

## Capabilities

### Modified Capabilities

- `self-hosting`: repeatable dedicated hosting deployment and recovery.

## Impact

`apps/server` configuration, an optional deployment overlay, fixture-based configuration validation, and operator documentation.

## Non-goals

Shared application or database hosting, self-service customer provisioning, billing, provider purchases, production deployment, and DNS changes.
