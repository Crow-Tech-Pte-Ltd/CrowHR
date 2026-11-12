## 1. Tests first
- [x] 1.1 `packages/core` auth: no SMTP refuses; recent sign-in required; confirm changes the address in every organisation and tells the old address; replaced, cancelled and expired links fail; current or taken addresses refused (`auth/email-change.http.test.ts`).

## 2. Implementation
- [x] 2.1 `packages/core`: `email_changes` table and migration 0021; `/me/email-change` and `/auth/email-change/confirm` (`auth/email-change.http.test.ts`, `testing/schema.auth.test.ts`).
- [x] 2.2 `apps/web`: Sign-in email card and the `/email/<token>` page (`e2e/email-change.spec.ts`, axe clean).

## 3. Documentation
- [x] 3.1 Sign-in methods guide, limitations (docs build link check).
