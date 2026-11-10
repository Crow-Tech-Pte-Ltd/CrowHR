# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately:

- through GitHub's private vulnerability reporting on this repository: **Security → [Report a vulnerability](https://github.com/Crow-Tech-Pte-Ltd/CrowHR/security/advisories/new)**; or
- by email to **hello@crow.sg**.

Please include:

- what you found and the impact you expect;
- the version (`docker compose exec app crowhr --version`, or Settings → System) or commit, and how Crow HR was configured (reverse proxy, SSO providers, etc.);
- steps to reproduce, ideally with a minimal example.

Do not include real personal data (NRIC numbers, salaries, bank details) in a report. Use fictional data.

## What to expect

- We aim to acknowledge your report within 5 working days.
- We will keep you informed while we investigate and fix it, and tell you when a fix is released.
- Please give us reasonable time to release a fix before disclosing the issue publicly. We are happy to credit you in the release notes unless you prefer otherwise.

## Supported versions

| Version | Supported |
| --- | --- |
| 1.x (latest release) | Yes |
| Older releases | No: upgrade to the latest 1.x |

Security fixes are released as a new 1.x version. The `ghcr.io/crow-tech-pte-ltd/crowhr:1` image tag that `docker-compose.yml` uses always points to the latest one, so self-hosters upgrade with `docker compose pull && docker compose up -d`.

## Scope

In scope: the code in this repository (server, web app, statutory engine, CLI, Docker image and compose file).

Out of scope: vulnerabilities in third-party services you connect (identity providers, SMTP servers), issues that need a compromised server or administrator account, and the configuration of an individual self-hosted install. Operators' security guidance is in the documentation site (`apps/docs/src/content/docs/help/security.md`, published at https://hr.crow.sg/docs/help/security/).
