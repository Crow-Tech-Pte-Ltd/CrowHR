## Why

Crow Tech needs one Singpass Login registration for the Crow HR installations it operates. A shared callback lets customers use their own domains without adding a Singpass app or callback for each customer.

## What Changes

- Add a Crow Tech-operated sign-in service that handles one Singpass Login registration and returns employees to their own Crow HR instance.
- Give each hosted instance its own trusted connection to the sign-in service. Use the same process for Crow HR subdomains and customer-owned domains.
- Link Singpass to existing Crow HR members through the invitation and account-linking flows. Keep employee access, roles and sessions in the customer instance.
- Prepare one hosted employee sign-in journey for Singpass review and verify it before offering managed Singpass to customers.

## Capabilities

### New Capabilities

- `managed-singpass-login`: shared Singpass authentication for dedicated Crow Tech-hosted installations, including custom domains and per-customer isolation.

### Modified Capabilities

## Impact

Crow HR sign-in and identity linking, a shared authentication service, hosted provisioning and operations, and the Singpass Developer Portal registration. The hosted sign-in proposal covers one service under Crow Tech's UEN.
