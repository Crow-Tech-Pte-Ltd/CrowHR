## 1. Core
- [x] 1.1 Tests first: `purpose=demo` 404s unless configured, for other providers and for non-Singpass; round trip redirects to the return URL with `singpass=ok`, sets no session, stores no subject, audits `sso.demo_sign_in`; failures redirect with `singpass=failed`; hourly and daily limits
- [x] 1.2 Implement the `demo` purpose in the OIDC routes; `demoSingpass` in AppDeps; audit label
- [x] 1.3 Sign-in methods response: `singpassLogoUrl`

## 2. Server
- [x] 2.1 `DEMO_SINGPASS_PROVIDER_ID` / `DEMO_SINGPASS_RETURN_URL` config with clear errors; `.env.example`
- [x] 2.2 Serve `<DATA_DIR>/branding/singpass-logo.{svg,png}` with nosniff + sandbox CSP; size limit

## 3. Web and demo
- [x] 3.1 Demo sign-in: Singpass button uses the build-time start URL; `singpass=ok` shows the HR admin / Employee chooser; `singpass=failed` explains
- [x] 3.2 Singpass button shows the deployer-supplied logo (server `singpassLogoUrl`, demo `VITE_SINGPASS_LOGO_SRC`)

## 4. Docs and verification
- [x] 4.1 Singpass guide (logo), demo docs, configuration reference, limitations
- [x] 4.2 Verify on staging: local demo build → hr-staging.crow.sg → Singpass staging test account → persona chooser — passed 9 Nov 2026 (Singpass button with the official logo, real Singpass staging password login, back with `singpass=ok`, HR admin / Employee offered, signed in as Employee). A full pg_dump of the staging database contains the test account's Singpass UUID 0 times; the audit log has one anonymous `sso.demo_sign_in` with no details. Also fixed: the demo seed's Singpass method had no keys, so the demo never listed Singpass at all
- [ ] 4.3 Production Singpass app for the demo (needs Daniel: hostname, user journey file, submission) and hr.crow.sg deploy (needs Daniel) — PARTIAL (Daniel approved all three, 9 Nov 2026): relying-party server renamed to hr-demo.crow.sg (S4); production Singpass Login app submitted for review (App ID is5qv9YDghWUqxDLTRRslO30fQOgsJYU, "up to 2 weeks"; user journey PDF from Singpass's Login template, OpenID only); its client ID is on the server's "Singpass (production)" method (switched off); hr.crow.sg deployed (Cloudflare Pages) with the Singpass button off. Verified on the live site with Singpass staging: hr.crow.sg → hr-demo.crow.sg → test account → back with singpass=ok → HR admin. Open: when Singpass approves, point DEMO_SINGPASS_PROVIDER_ID at the production method, rebuild the demo with VITE_DEMO_SINGPASS_START_URL, redeploy, and test with a real Singpass login
