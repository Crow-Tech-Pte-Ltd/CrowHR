## ADDED Requirements
### Requirement: Change my sign-in email
A member SHALL be able to change their own sign-in email after a recent sign-in. The change SHALL take effect only when the new address confirms it through a one-time link valid for 24 hours, SHALL apply in every organisation the person belongs to, SHALL mark the address verified, and SHALL be audited. Both addresses SHALL be told. When the server cannot send email the change SHALL be refused with a message saying why.

#### Scenario: Confirmed by the new address
- **WHEN** Aisyah asks to change aisyah@example.sg to aisyah.rahman@example.sg and opens the link sent there
- **THEN** she signs in with the new address in both her organisations, the old address no longer signs in, and the old address is told

#### Scenario: No SMTP
- **WHEN** a member asks to change their email on a server without SMTP
- **THEN** the request answers 409 with reason `email_unavailable` and nothing changes
