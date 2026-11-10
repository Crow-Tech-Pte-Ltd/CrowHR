# Self-hosting docs have moved

The self-hosting guides now live in the documentation site, `apps/docs`:

| Topic | Source file | Published page |
| --- | --- | --- |
| Install (quick start) | `apps/docs/src/content/docs/self-hosting/install.md` | https://hr.crow.sg/docs/self-hosting/install/ |
| Configuration reference | `apps/docs/src/content/docs/self-hosting/configuration.md` | https://hr.crow.sg/docs/self-hosting/configuration/ |
| Reverse proxy | `apps/docs/src/content/docs/self-hosting/reverse-proxy.md` | https://hr.crow.sg/docs/self-hosting/reverse-proxy/ |
| Backups and restore | `apps/docs/src/content/docs/self-hosting/backups.md` | https://hr.crow.sg/docs/self-hosting/backups/ |
| Upgrades | `apps/docs/src/content/docs/self-hosting/upgrades.md` | https://hr.crow.sg/docs/self-hosting/upgrades/ |
| `crowhr` CLI | `apps/docs/src/content/docs/self-hosting/cli.md` | https://hr.crow.sg/docs/self-hosting/cli/ |
| Troubleshooting | `apps/docs/src/content/docs/self-hosting/troubleshooting.md` | https://hr.crow.sg/docs/self-hosting/troubleshooting/ |

The site is live at https://hr.crow.sg/docs/. To build it locally, run `bun run --cwd apps/docs build` and open `apps/docs/dist/index.html` through `bun run --cwd apps/docs preview`.
