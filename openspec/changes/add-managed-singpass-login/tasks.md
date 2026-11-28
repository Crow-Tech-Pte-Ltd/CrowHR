## 1. Singpass registration

- [x] 1.1 Verify the existing Crow HR production app's status and submitted purpose in the Developer Portal. The app was Active on 28 November 2026, with a public demo journey and an `hr-demo.crow.sg` callback.
- [ ] 1.2 Confirm Singpass's process for reviewing one hosted employee sign-in app under Crow Tech's UEN. Record the response for the shared callback and the customer-owned domains.
- [x] 1.3 Prepare staging and production requirements for the shared login hostname, keys, callback and official button. Verify that the proposed journey covers customer-owned domains, explicit identity linking and the alternative sign-in method.

## 2. Shared login service

- [x] 2.1 Reuse the Singpass FAPI client in the shared service. Verify mocked PAR, DPoP, token exchange and encrypted ID token validation.
- [x] 2.2 Set up the downstream OIDC issuer and operator-managed client enrolment. Verify that each customer has independent credentials and that redirect mismatches, PKCE failures, expired or replayed codes, and suspended clients are rejected.
- [x] 2.3 Issue stable tenant-specific subjects, handle key rotation and log only the permitted audit fields. Verify subject isolation for the same Singpass identity in two instances and stability after backup restoration.

## 3. Crow HR integration

- [x] 3.1 Add the managed sign-in configuration and route the UI and native sign-in through it. Verify existing invitations and explicit account linking, eligible membership, MFA, refusal of unlinked ordinary sign-ins and the owner fallback.
- [ ] 3.2 Provision two dedicated test instances on distinct domains with the shared callback. Verify successful return to the initiating site and denial of transfers between clients. Run the direct Singpass regression tests. The local test covers two separate Crow HR databases and HTTPS origins, a real downstream OIDC exchange, an upstream Singpass simulator, and failed cross-client code redemption. Public staging domains are still pending.

## 4. Verification and rollout

- [ ] 4.1 Run the shared flow against Singpass staging. Document setup, monitoring, credential rotation, custom-domain changes, independent suspension and the fallback procedure.
- [ ] 4.2 Submit the tested journey for production review. After approval, run a real Singpass login on a hosted test instance and record the outcome before enabling a customer.
