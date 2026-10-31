---
title: The OpenSpec process
description: How requirements, change proposals and task lists are kept in openspec/ and how a change moves from proposal to archive.
---

Crow HR keeps its requirements in the repository with [OpenSpec](https://github.com/Fission-AI/OpenSpec). The rule: substantial work starts as a change proposal; trivial fixes do not need one.

## Layout

```
openspec/
  config.yaml            # project context and rules for artefacts
  project-roadmap.md     # milestones, dependencies, workstream ownership
  specs/                 # current requirements (filled as changes are archived)
  changes/<name>/
    proposal.md          # why, what changes, non-goals (under 600 words)
    design.md            # decisions and trade-offs
    specs/<capability>/spec.md   # requirements as SHALL statements with scenarios
    tasks.md             # numbered tasks, each naming its package and the test that proves it
```

## How a change moves

1. **Propose**: write the proposal, design, spec deltas and tasks. Requirements are testable: each has at least one `WHEN … THEN …` scenario.
2. **Apply**: implement task by task, writing the named test first. Tick a task only when its test passes. A stub stays unticked, is marked `// NOT IMPLEMENTED:` in the code and is listed in `docs/limitations.md`.
3. **Archive**: when every task is done, the spec deltas are merged into `openspec/specs/` and the change moves to the archive.

Changing a cell of the permission matrix, the API contract or a statutory rule is a spec change and goes through this process.

## Changes today

Built (some with open tasks): `add-foundation`, `add-api-platform`, `add-identity-and-access`, `add-organisation-and-people`, `add-approvals-and-notifications`, `add-self-hosting`, `add-sg-statutory-engine`, `add-payroll`.

Specified, not built: `add-claims`, `add-scheduling`, `add-documents`, `add-reporting`, `add-mobile-apps`. Leave and attendance are still to be specified. See [project status](/docs/status/).

## Ground rules

From the project's working agreement (`AGENTS.md`):

- Nothing is marked done if it is stubbed or mocked.
- Statutory numbers come from cited sources, with an effective date and a source URL.
- Money is integer cents; rounding is explicit and named.
- Permissions are enforced on the server; hiding UI is cosmetic.
- Every tenant table has `org_id`, and cross-organisation access has a test proving it fails.
