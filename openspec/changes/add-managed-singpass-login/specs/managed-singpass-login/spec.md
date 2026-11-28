## Purpose

Allow Crow Tech-hosted Crow HR instances to offer Singpass using one managed registration, while each customer controls access to its own employee accounts.

## ADDED Requirements

### Requirement: Shared Singpass registration with customer domains

The managed sign-in service SHALL use one Singpass Login registration and one registered HTTPS callback per environment. A Crow Tech operator SHALL be able to enrol a dedicated customer instance using its canonical HTTPS callback, including an instance on a customer-owned domain. Only the shared service SHALL hold the upstream Singpass private keys.

#### Scenario: Enrol two distinct domains

- **WHEN** an operator enrols two hosted instances with different HTTPS domains and an employee starts Singpass sign-in on each instance
- **THEN** both journeys use the same registered Singpass callback and each employee returns to the instance where their journey began

### Requirement: Isolate authorisation by hosted instance

The service SHALL give each hosted instance a separate client identity and credentials. It SHALL bind each authorisation to the initiating client, its exact registered callback, and that attempt's state and proof of key possession. It SHALL use short-lived, single-use authorisation codes for the return to each instance. An operator SHALL be able to suspend or remove an instance's access independently.

#### Scenario: Reject a callback for a different client

- **WHEN** a request supplies another client's callback, presents another client's authorisation code, or reuses an already redeemed code
- **THEN** the service rejects the request before returning any identity or creating a session

#### Scenario: Suspend a hosted instance

- **WHEN** an operator suspends one hosted instance
- **THEN** its managed sign-in stops and other hosted instances can continue to authenticate

### Requirement: Link to existing employee accounts

Managed Singpass SHALL let a member link their identity through a valid Crow HR invitation or an authenticated account-linking flow. Ordinary sign-in SHALL require an existing identity link and an eligible membership. The customer instance SHALL continue to determine membership, permissions, MFA requirements and sessions.

#### Scenario: An unlinked person tries to sign in

- **WHEN** Singpass authenticates a person who has no identity link or valid invitation for that customer
- **THEN** Crow HR shows a sign-in error and creates neither an account nor a session

#### Scenario: A linked person signs in

- **WHEN** a member signs in using their linked managed Singpass identity
- **THEN** the customer instance applies its membership and MFA rules before issuing the session

### Requirement: Share only a tenant-specific identifier

The managed service SHALL request only the Singpass identity needed to authenticate. It SHALL give each customer instance a stable subject scoped to that instance and SHALL keep raw Singpass identifiers, keys and tokens out of URLs, audit events and application logs. Audit events SHALL record the outcome and the affected hosted instance.

#### Scenario: A person is linked in two customer instances

- **WHEN** the same person links their Singpass identity in two independently enrolled customer instances
- **THEN** each instance receives a different stable subject and neither receives the raw Singpass identifier

### Requirement: Enable managed Singpass after verification

Crow Tech SHALL obtain approval for the managed employee sign-in journey and verify a production sign-in before offering it to hosted customers. At least one alternative sign-in method SHALL remain available. Self-hosted operators SHALL be able to configure their own direct Singpass Login app.

#### Scenario: Managed sign-in is unavailable

- **WHEN** managed Singpass is disabled or unavailable for a customer
- **THEN** the customer can still use their other enabled sign-in method and the owner can use the password fallback

#### Scenario: Self-hosted company configures its own app

- **WHEN** a self-hosted company registers and configures a direct Singpass Login app
- **THEN** its sign-in uses its own registration and instance callback
