## Context

The hosted overlay already pins the app image and validates production settings. It uses a host-provided reverse proxy and needs several manual setup steps.

## Goals

- Use Docker Compose on a Linux VPS that can run the release images.
- Keep each install independent and make repeated starts use the same files, keys and volumes.

## Decisions

- Copy templates and an installer into a new private directory. Store the stable Compose project name and generated backup passphrase locally. Require an explicit app image digest and hostname.
- Add Caddy with persistent certificate state. This mode replaces the app's loopback publication with private networking. The existing operator-supplied proxy mode remains available.
- Show proxy and container health with one command and verify HTTPS using the configured hostname. Export a new encrypted archive without replacing other files. Use the existing restore procedure for recovery and require deliberate selection of the next release digest for upgrades.

## Risks / Trade-offs

DNS and inbound ports are controlled outside the VPS. The installer reports HTTPS failure and leaves the same project available for a retry. The exported backup and its passphrase belong in separate storage.
