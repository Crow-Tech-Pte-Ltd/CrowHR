## ADDED Requirements

### Requirement: Optional AI assistant connector

Crow HR SHALL support individually authorised, revocable, read-only access to limited self-service information on enabled company servers.

#### Scenario: Disabled server or demo

- **WHEN** a request targets the connector on a disabled instance, disabled company or demo
- **THEN** the connector exposes neither tools nor customer data

#### Scenario: Connect as a company member

- **WHEN** a member completes Crow HR sign-in and grants consent to a supported assistant
- **THEN** that assistant can request the member’s own available leave, next published shift or pending approval count in that company

#### Scenario: Disconnect or lose access

- **WHEN** the member revokes the connection, loses active membership, or the owner disables the connector
- **THEN** the connection cannot read data or obtain replacement access
