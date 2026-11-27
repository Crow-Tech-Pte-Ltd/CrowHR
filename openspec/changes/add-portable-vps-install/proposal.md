## Why

An operator needs to bring up the same dedicated Crow HR stack on different VPS providers with a small set of inputs and a repeatable health and backup workflow.

## What Changes

- Add a portable installer that prepares a private, independent copy of the hosted Compose setup.
- Include Caddy for automatic HTTPS and keep the app and PostgreSQL off host ports.
- Provide operator commands to start, check and export an encrypted backup.

## Capabilities

### Modified Capabilities

- `self-hosting`: portable VPS install with HTTPS and consistent operator commands.

## Impact

Hosted deployment files, the operator guide and the Docker smoke tests.

## Non-goals

VPS provisioning, DNS management, automatic upgrades, off-host storage credentials and customer onboarding.
