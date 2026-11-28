# Managed Singpass for Crow HR

Each Crow Tech-hosted Crow HR instance keeps its own employees, invitations, linked sign-in methods
and sessions. The shared service validates Singpass and issues a short-lived OIDC code to the
instance that requested it. The instance receives an opaque subject unique to that installation,
with no NRIC, name or email. The owner retains password access, and employees need an alternative
sign-in method.

Singpass staging verification and production review for hosted employee sign-in are pending.

## Set up staging

1. Use a staging-only HTTPS hostname, an isolated PostgreSQL database and two fresh Crow HR instances
   with different HTTPS origins. Set `CROWHR_HOSTED=1` and `MANAGED_SINGPASS_ISSUER` to the staging
   issuer origin on both instances. Set each `PUBLIC_URL` to its own external address.
2. Generate two P-256 key sets with `generateRpKeys` from `@crowhr/core/singpass` in an operator-only
   process. Save the first set's private signing and encryption keys as `singpass.keys`. Save only
   the second set's private signing key as `signingKeys`. Register the first set's public keys with
   Singpass. Generate independent random 32-byte values for `subjectKey` and `attemptKey`, plus
   independent random secrets for `cookieKeys` and for each client. Store the private configuration
   in the secrets store and mount it read-only for the service.
3. Create a staging Singpass **Login** application for general authentication with OpenID scope.
   Register exactly `<issuer>/singpass/login` and `<issuer>/singpass/jwks.json`. The portal can also
   accept the upstream public JWKS as a pasted object if a proxy challenges the Singpass fetcher.
   Use the staging App ID as `singpass.clientId`.
4. Start the service with Node 24 and Bun-installed dependencies. Set `MANAGED_LOGIN_CONFIG_FILE`
   to the secured JSON config path and run `bun run --cwd apps/managed-login start` under a
   service manager. Start with an empty client list if the Crow HR provider IDs are pending. The listener binds to loopback. Connect it to a trusted HTTPS reverse proxy
   on the same host, set the external host, and overwrite the forwarded host and protocol headers.
   Configure the proxy and any logging pipeline to omit query strings, cookies, request bodies and
   response bodies for authentication endpoints. Allow the OIDC discovery and public JWKS
   endpoints to be fetched by the Crow HR servers and the Singpass JWKS endpoint by Singpass.
5. In each instance's **Settings → Security**, add **Managed Singpass** with a distinct client ID
   and secret. Copy the exact callback shown on the provider card to that client's registry entry
   and restart the login service. Use a durable client ID tied to the installation. Verify control
   of the HTTPS domain before adding its callback. Install the official Singpass logo as described
   in the [Crow HR Singpass guide](https://hr.crow.sg/docs/admin/sso/singpass/).
6. Run **Test sign-in** with a portal staging account. Invite and link a fictional employee in
   each instance, then test ordinary sign-in from both domains. Verify the browser returns to the
   initiating domain and the two employee accounts have distinct linked subjects. Repeat with an
   unlinked employee, an MFA-required employee and a disabled client. Check the alternate sign-in
   method and owner password access.

The configuration file needs the following fields:

| Field | Value |
| --- | --- |
| `issuer` | Canonical HTTPS origin with no trailing slash |
| `databaseUrl` | Connection to a dedicated PostgreSQL database where the service can initialise and use its tables |
| `port` | Loopback listener port, defaults to 8081 |
| `subjectKey` | Stable, backed-up 32-byte key in hex or base64 |
| `attemptKey` | Independent 32-byte key in hex or base64 for short-lived upstream transaction data |
| `cookieKeys` | List of random secrets at least 43 characters long, newest first |
| `signingKeys` | Private ES256 JWKS for the managed issuer |
| `singpass` | Object with `environment` (`staging` or `production`), `clientId` and private `keys` JWKS |
| `clients` | Array of objects with `id`, `secret` (at least 43 characters), exact HTTPS `callback` and optional `suspended` |

## Production journey and operation

Record the actual staging journey for Singpass review. Show the company-branded entry on each domain,
the Singpass button and alternate sign-in, first-time identity linking, return to the correct company
and any Crow HR MFA prompt. Describe the opaque per-installation subject and the one shared callback
on a Crow Tech domain. Use separate production keys, credentials, database and hostname. Submit one
hosted employee Login app under Crow Tech and confirm the use of company-owned domains in the review.
Test with a real Singpass account on a dedicated hosted test instance after approval and before enabling
it for customers. [Singpass user journey requirements](https://docs.developer.singpass.gov.sg/docs/getting-started/user-journey)

- Monitor the public discovery and health endpoints and alert on a sustained rise in failed
  authentications. The service logs the client ID and outcome for completed upstream attempts.
- Back up and rehearse restoration of `subjectKey` independently of the protocol state and signing
  keys. Changing it would require employees to link again. Keep client IDs stable across host and
  domain changes.
- Rotate managed issuer signing keys by publishing old and new keys together during the transition.
  Keep the retiring keys published until outstanding ID tokens and verifier caches have expired.
  Replace Singpass keys through the portal's separate upstream rotation procedure. An attempt key
  change invalidates in-flight sign-ins. Keep the previous cookie secret behind the new one while
  outstanding interactions drain.
- For a new company domain, verify its ownership and coordinate the new `PUBLIC_URL` and exact
  callback allowlist entry. The upstream Singpass registration keeps the shared callback.
- For client credential rotation, coordinate updating the secret in the service and the Crow HR
  instance. Use the client's alternative sign-in method during the change.
- To suspend one company, set `suspended` for its registry entry and restart the service. Disable the
  method in that Crow HR instance so the sign-in button is hidden. Existing Crow HR sessions can
  be revoked locally if necessary. For a service-wide outage, each instance retains its alternate
  sign-in method and the owner's password fallback.
