## Context

Crow HR's direct Singpass integration derives the callback and public-key URL from each installation's `PUBLIC_URL` and provider ID. A dedicated hosted installation has its own backend and database. On 28 November 2026, the Developer Portal showed the Crow HR production app as **Active**. Its registered description covers visitors to the public demo and its callback is on `hr-demo.crow.sg`. The hosted employee journey needs its own review.

## Goals

Use one upstream Singpass integration for hosted employee sign-in. Keep membership, payroll data and app sessions inside each dedicated installation.

## Decisions

1. **One shared callback.** Use a Crow Tech-controlled HTTPS login hostname, provisionally `login.crowhr.com`. Its callback is the only one registered with Singpass for all hosted customers in that environment. The operator registers each customer's exact Crow HR callback with our service as part of provisioning. A custom domain change updates that registration while keeping the customer's internal ID stable.
2. **Use standard OIDC between the shared service and each instance.** Make the shared service a confidential Singpass relying party with Crow HR's existing FAPI 2.0 client code. Use an established OIDC provider library for the downstream authorization code flow. Each instance authenticates as its own confidential client and verifies issuer, audience, signature and nonce. Require PKCE, exact callback allowlists and short-lived one-use codes. Bind state to the client and its callback before starting upstream authentication. The instance issues the browser or native Crow HR session after applying its own access policies.
3. **Give instances tenant-specific subjects.** Derive a stable pseudonymous subject from the upstream issuer and subject and an immutable customer ID, using a protected derivation key. Keep that key backed up independently from rotatable signing keys. Send only the identity and authentication context needed by the instance. Use Crow HR's existing explicit link or invitation flows. The managed configuration permits only these linking methods and keeps just-in-time provisioning disabled.
4. **Keep upstream credentials in one place.** Store the Singpass signing and decryption keys in the shared service. Use separate credentials and registrations for staging and production. Give each instance independently rotatable credentials and an operator-controlled enable switch. Hosting provisioning controls enrollment and verifies control of the callback domain.
5. **Submit one hosted app for the employee journey.** The employee starts on their company's sign-in page, chooses Singpass, and follows the authentication flow through the Crow Tech login service. That service validates Singpass's response and returns a one-time code to the originating installation. The installation checks the existing member or invitation, offers any required MFA, and establishes the session. Submit one production registration under Crow Tech's UEN for this shared hosted flow. Show the customer-domain entry and return, the alternative sign-in method, and the identity forwarded to the installation. [Singpass user journey requirements](https://docs.developer.singpass.gov.sg/docs/getting-started/user-journey)

## Risks and trade-offs

- An outage of the shared service or Singpass affects hosted customers using the managed method. Keep an alternative sign-in option and the owner's password fallback available, and monitor the shared callback.
- A misdirected authorization response could expose one customer's identity to another. Bind the customer and callback to the originating transaction and verify the isolation with two different hosted domains.
- Losing the derivation key would change subjects and break existing links. Include encrypted key backup and restoration in the operator rehearsal.

## Rollout

Test the journey with a mock provider and two dedicated test instances. Register a staging callback, test against Singpass staging, and prepare the production submission from the tested journey. After approval, verify a real production sign-in with a test installation before enabling it for a customer. Roll back by disabling managed Singpass for the affected instances and retaining their alternate sign-in methods.
