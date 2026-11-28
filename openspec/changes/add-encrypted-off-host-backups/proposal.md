## Why

Crow HR stores encrypted backups on the installation's disk. A host or disk failure can take out the live database and every local backup. Operators need a supported way to copy encrypted archives to separate storage and recover from those copies.

## What changes

- Supply an optional host uploader and systemd timer for a private S3-compatible destination.
- Document the upload permissions, independent remote retention and a restore rehearsal from a downloaded archive.

## Impact

The existing backup schedule, archives and restore command remain in use. This change adds host tooling and documentation. No app dependencies or service changes are required.
