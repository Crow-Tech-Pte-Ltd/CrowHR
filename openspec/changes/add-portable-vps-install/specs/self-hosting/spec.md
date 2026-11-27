## ADDED Requirements

### Requirement: Prepare a portable dedicated VPS installation

The operator SHALL be able to prepare a private and reusable Compose project from a hostname, project name prefix and release digest. Existing installation files SHALL be protected against replacement. The project SHALL let Caddy manage HTTPS and publish only its HTTP and HTTPS ports.

#### Scenario: Prepare an independent install

- **WHEN** an operator prepares a new installation directory with valid inputs
- **THEN** the directory contains its own configuration and operator command, its Compose project name is unique, the app and database have no published ports, and the project has persistent certificate storage

### Requirement: Operate a portable VPS installation

The operator SHALL be able to start the prepared project, check its HTTPS health, request the first-run code and export an encrypted archive. The operator command SHALL keep partial archives and plaintext out of the requested destination.

#### Scenario: Retry startup after DNS is corrected

- **WHEN** the HTTPS check fails after the containers start
- **THEN** the operator can correct DNS and rerun startup using the same project and volumes

#### Scenario: Export an encrypted backup

- **WHEN** backup creates a valid encrypted archive
- **THEN** the archive is published into the requested directory without replacing an existing file
