---
title: Security
description: How to report a vulnerability in Crow HR, and the security measures operators should know about.
---

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

- Use GitHub's private vulnerability reporting on the repository (**Security → Report a vulnerability**) once the repository is public, or
- email **security@crow.sg** (address to be confirmed by Crow Tech before the repository is public).

Include what you found, the version or commit, steps to reproduce and the impact you expect. Do not include real personal data. We aim to acknowledge reports within 5 working days and will tell you when a fix is released. Please give us reasonable time to fix the issue before disclosing it. The same policy is in `SECURITY.md` in the repository.

Only the latest release is supported with security fixes while the project is pre-1.0.

## Built-in protections

| Area | What Crow HR does |
| --- | --- |
| Passwords | argon2id (19 MiB, 2 iterations), 12 to 128 characters, common-password list, no composition rules. Failures give one generic message; verification runs even for unknown emails. |
| Brute force | Account lockout after 10 failures in 15 minutes; 30 sign-in attempts per minute per IP; 5 wrong setup codes block an IP for 15 minutes. |
| Two-step verification | TOTP with replay protection, hashed single-use recovery codes, required for owners, HR and payroll admins by default. |
| Sessions | 256-bit random tokens stored as SHA-256 hashes; `__Host-` HttpOnly, Secure, SameSite=Lax cookies over HTTPS; idle and absolute timeouts; rotation on sign-in; revocation. |
| CSRF | State-changing requests must come from `PUBLIC_URL`'s origin. |
| Re-authentication | Sensitive actions need a sign-in within 10 minutes. |
| Encryption at rest | NRIC/FIN, passport and work pass numbers, bank numbers, TOTP secrets, SSO secrets and keys: AES-256-GCM under `CROWHR_SECRET_KEY`. Backups can be encrypted with age. |
| Authorisation | One permission matrix enforced on the server for every route; other organisations' records answer 404; field-level redaction. |
| Audit | Append-only audit log with a SHA-256 hash chain; `crowhr admin verify-audit` checks it. |
| Container | Runs as uid 10001 on a read-only root filesystem; the database has no host port. |

## Operator checklist

- Serve Crow HR over **HTTPS** ([reverse proxy](/docs/self-hosting/reverse-proxy/)) and set `TRUSTED_PROXIES` correctly.
- Set `BACKUP_PASSPHRASE` and copy backups off the server. An unencrypted backup contains the encryption key.
- Keep the server and Docker updated, and [upgrade](/docs/self-hosting/upgrades/) Crow HR when releases come out.
- Keep `PUBLIC_URL` and the encryption key stable; never delete the database to "fix" a key mismatch.
- Enforce MFA at your identity provider when staff use SSO.
- Review **Settings → Audit log** and **Settings → System** regularly.

## Known gaps

See [limitations](/docs/payroll/limitations/#platform-and-sign-in): security notification emails are not all sent yet, there is no row-level security in the database (isolation is in the application, with tests), and the common-password list is curated rather than a breach corpus.
