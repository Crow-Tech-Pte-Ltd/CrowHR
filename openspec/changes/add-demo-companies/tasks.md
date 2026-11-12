## 1. Core
- [ ] 1.1 Tests first (PGlite): migration adds `organisations.demo_expires_at` / `demo_claimed_at`; the flag can't be set on an existing organisation or cleared; audit DELETE refused for a real organisation even with `crowhr.purge_demo_org` set, allowed only for that expired demo organisation inside the sweep; UPDATE always refused
- [ ] 1.2 Migration and triggers; schema; `deps.demoCompanies` settings
- [ ] 1.3 Tests first: `POST /api/v1/demo-companies` 404 when off; claims a pooled copy or seeds one; unique slug and emails; expiry from hand-out; per-network hourly/daily caps and `maxLive` → 429 with retry time; two copies don't see each other's data
- [ ] 1.4 Provisioning: `prepareSampleCompany({ slug, emailDomain })` (store-review script keeps its values), pool refill on tick (one seed at a time), claim
- [ ] 1.5 Tests first: persona list and sign-in for a live demo company (browser session and native code); 404 for real organisations on the same server, for expired copies, and when the mode is off; browser demo behaviour unchanged
- [ ] 1.6 Persona routes for demo companies; sign-in methods answer `demoCompany: { expiresAt }`; meta omits demo companies and answers `demo: true` for one
- [ ] 1.7 Tests first: guard rails (security settings, SSO, invitations, email/password/MFA changes refused with 403; no email sent; upload quota; device session platform name)
- [ ] 1.8 Guard rails
- [ ] 1.9 Tests first: expiry sweep deletes every org-scoped row, memberships, orphaned users, device sessions and files of expired demo companies only
- [ ] 1.10 Expiry sweep on tick; `crowhr demo-companies purge` CLI
## 2. Server
- [ ] 2.1 `DEMO_COMPANIES`, `DEMO_COMPANY_TTL_HOURS`, pool/limit settings with clear startup errors; `.env.example`; configuration docs
## 3. Web
- [ ] 3.1 Sign-in page: persona picker for a demo company (web and native), "this demo company has ended" state
- [ ] 3.2 `/try` page (phone: app link with Android Play fallback; computer: QR code; type-it-in fallback; open in browser; expiry; privacy sentence; remembers the visitor's company); 360 px, keyboard, axe clean
- [ ] 3.3 e2e: start a demo company, sign in as employee, apply for leave, sign in as manager in another context, approve
## 4. Links, docs, launch
- [ ] 4.1 Docs: mobile apps page "Try it with a demo company", configuration reference, limitations; in-browser demo links (`VITE_TRY_URL`)
- [ ] 4.2 Measure seeding time and memory on S4-sized limits; pick pool and caps
- [ ] 4.3 crow.sg: privacy policy "Demo server" section and the product page link (landing repo) — needs Daniel's review of the privacy wording
- [ ] 4.4 Turn on at hr-demo.crow.sg after the App Store review of 1.0.0 is decided — needs Daniel's approval
