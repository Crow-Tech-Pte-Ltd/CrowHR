## ADDED Requirements

### Requirement: Encrypted off-host backups

An operator SHALL be able to schedule uploads of completed encrypted backup archives from an existing installation to a private S3-compatible bucket and prefix. The upload process SHALL leave local archives intact, SHALL refuse to replace a different archive at the same destination key and SHALL NOT delete remote objects.

#### Scenario: Local and remote retention are independent

- **WHEN** the operator runs the upload job after a completed encrypted backup and later allows local retention to remove that archive
- **THEN** the first run copies the archive to the configured bucket prefix and future runs leave the retained remote copy unchanged

#### Scenario: Only completed encrypted archives are eligible for transfer

- **WHEN** the backup volume contains plaintext archives, incomplete writes or files outside the expected archive naming pattern
- **THEN** the uploader skips those files and fails visibly if no eligible archives exist
- **AND** it rejects an archive carrying the encrypted suffix if its age header is invalid

#### Scenario: Recover from a remote archive

- **WHEN** the operator downloads an encrypted archive into an isolated recovery environment with the matching passphrase
- **THEN** the existing restore command can decrypt and verify the archive before recovery
