## Context
The demo (`apps/demo`) runs the web app and `packages/core` in the visitor's browser on PGlite: per-visitor, fictional, no server. Singpass needs a relying party with private keys and a registered callback, so it cannot run in the browser. The S4 staging server (`hr-staging.crow.sg`) already passes a real Singpass staging test.

## Decisions
1. **Round trip through a server, personas stay in the browser.** The server proves the Singpass flow works and then forgets the person; the demo keeps its per-visitor isolation. A server-side shared demo org was rejected: visitors would see each other's edits and the server would hold demo data.
2. **New OIDC purpose `demo`**, accepted only for the provider named by `DEMO_SINGPASS_PROVIDER_ID`, only for Singpass, only when `DEMO_SINGPASS_RETURN_URL` is set. No session, no identity row, no invitation, no link. The provider need not be *enabled* (so the hosting org's own sign-in page does not show it). The return URL is fixed by configuration, never taken from the request (no open redirect).
3. **Nothing about the person is kept.** The callback validates the tokens (so a broken integration shows as `?singpass=failed`), then drops the claims. The audit event `sso.demo_sign_in` has no subject. Standard request logging (IP) is unchanged.
4. **Limits**: 20 demo starts per network per hour and 1,000 per day overall (fixed windows in `auth_throttle`), well inside Singpass's free 50,000 logins per month per UEN.
5. **`?singpass=ok` is not a credential.** Anyone can type it; it only reveals a persona chooser that the demo already offers to everyone.
6. **Logo**: deployer-supplied file in the data volume, served with `nosniff` and a sandboxing CSP (an SVG cannot run script when opened directly). PNG or SVG, at most 200 KB.

## Risks
- Singpass may not approve a production app whose purpose is a product demo. The use case must say exactly that.
- If the hosting server is down, the visitor sees an error page instead of coming back to the demo. Acceptable for a demo; the persona picker on the sign-in page still works without Singpass.
