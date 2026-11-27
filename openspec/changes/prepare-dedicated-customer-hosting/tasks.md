## 1. Dedicated deployment

- [x] 1.1 In apps/server, enforce the hosted startup requirements. Test valid hosted settings, unsafe inputs and unchanged self-host defaults in config tests.
- [x] 1.2 In deploy/hosted, add the opt-in overlay and validate its rendered ports, environment and separate Compose volumes with two fictitious project names.

## 2. Operations

- [x] 2.1 In deploy/hosted, document dedicated setup, off-host encrypted backups, monitoring, upgrade and recovery rehearsal using the existing app tools. Check the commands against the local Compose config and run the existing backup/restore tests.
