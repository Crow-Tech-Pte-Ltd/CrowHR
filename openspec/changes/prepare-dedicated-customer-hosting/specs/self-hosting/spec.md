## ADDED Requirements

### Requirement: Dedicated hosted installation

The operator SHALL be able to run a dedicated organisation instance with its own Compose project, PostgreSQL database, app files, keys and backups. The hosted overlay SHALL require an explicit release image, bind the app port to loopback and keep the database unpublished.

#### Scenario: Render the hosted deployment

- **WHEN** an operator supplies the required instance settings and renders the configuration
- **THEN** the app has one loopback binding, PostgreSQL has no published port, and each of the data volumes belongs to that Compose project

### Requirement: Hosted startup requirements

A hosted app SHALL refuse startup without an HTTPS public URL, a trusted HTTPS proxy configuration, the setup gate, encrypted scheduled backups and a pre-migration backup. It SHALL refuse demo mode.

#### Scenario: Unsafe hosted setting

- **WHEN** a hosted app starts with a non-HTTPS URL, missing backup passphrase, disabled backup schedule or enabled public demo
- **THEN** startup fails and identifies the setting to correct

#### Scenario: Existing self-host install

- **WHEN** a self-host installation runs without the hosted flag
- **THEN** its established configuration and setup remain supported
