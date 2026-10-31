## What and why

<!-- What does this change, and why? Link the issue or OpenSpec change (openspec/changes/<name>). -->

## How it was tested

<!-- Tests added or changed, and anything checked by hand. Calculations, permissions and workflows need tests. -->

## Checklist

- [ ] `bun run check` passes (Biome, typecheck, tests, sg-rules coverage, OpenAPI snapshot, docs build)
- [ ] OpenAPI snapshot regenerated and committed if routes changed (`bun run openapi:generate`)
- [ ] Migration generated and committed if the schema changed (`bun run db:generate`)
- [ ] Statutory numbers have an effective date and a source URL
- [ ] Docs updated (`apps/docs`), and `docs/limitations.md` lists anything stubbed or not done
- [ ] Fictional data only in tests, fixtures and screenshots

## Limitations left

<!-- Anything this change does not do yet. Say so here rather than leaving it implied. -->
