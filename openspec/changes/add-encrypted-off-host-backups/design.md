## Approach

The app writes completed backups atomically and continues to own local scheduling and retention. An optional hourly systemd timer reads that Compose project's backups volume and uses rclone to copy finished age archives to its own remote prefix. The host job receives its storage credential through a systemd credential file. The application never needs that credential.

The uploader accepts only regular files with the Crow HR archive name and age header. It copies immutable objects, refuses conflicting same-name contents and has no remote deletion step. An operator controls remote retention through the storage provider. A nonzero exit appears as a failed unit in systemd. The timer retries on its next run and an operator can separately alert on a stale remote backup.

The restore flow downloads a specific object using a read credential and uses the existing age decryption and archive verification in `crowhr restore`. An isolated rehearsal checks sign-in, uploaded files and saved payroll data.
