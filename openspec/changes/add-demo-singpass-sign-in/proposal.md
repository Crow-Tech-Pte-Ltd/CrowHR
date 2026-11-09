## Why
The public demo shows a Singpass button that only says "not available in the demo". Daniel wants demo visitors to really log in with Singpass and then simply pick whether to look around as an HR admin or an employee: the demo does not care who they are. Separately, Singpass's button design specification (in force since 1 Sep 2026) requires the official Singpass logo, which Crow HR cannot bundle in the MIT repository.

## What Changes
- **Demo Singpass round trip.** A Crow HR server can act as the Singpass relying party for the static, in-browser demo. Its Singpass flow gets a `demo` purpose: Singpass's answer is fully validated (PAR, `private_key_jwt`, DPoP, encrypted ID token), then the identity is discarded (nothing is linked or stored) and the browser goes back to the demo with `?singpass=ok`. Off unless the server sets `DEMO_SINGPASS_PROVIDER_ID` and `DEMO_SINGPASS_RETURN_URL`; capped per network per hour and per day.
- **Demo sign-in page.** With `VITE_DEMO_SINGPASS_START_URL` set at build time, the demo's Singpass button works. Back from Singpass, the page offers "Continue as HR admin" or "Continue as Employee" (the existing seeded personas, the visitor's own in-browser copy). Google, Microsoft and OIDC stay disabled in the demo.
- **Official Singpass logo, supplied by the deployer.** A server serves `<DATA_DIR>/branding/singpass-logo.svg|png` (if present) and the sign-in page puts it in the Singpass button. The demo takes `VITE_SINGPASS_LOGO_SRC`. The repository still contains no Singpass artwork.

## Capabilities
### Modified Capabilities
- `auth`: demo-mode sign-in (Singpass works, persona choice after it), the `demo` OIDC purpose, Singpass button logo.

## Impact
`packages/core` (OIDC routes, deps, sign-in methods API, audit labels), `apps/server` (config, logo route), `apps/web` (sign-in page), `apps/demo` (build-time settings), docs (Singpass guide, demo, configuration), OpenAPI snapshot. No migration (`oidc_transactions.purpose` is plain text).

Production use needs a **production** Singpass app (Singpass reviews it, up to 2 weeks), a public demo deployment, and Daniel's approval for both.
