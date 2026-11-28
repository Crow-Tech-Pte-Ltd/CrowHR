## Context

Crow HR already has role checks, status and backup facts, workflows for account recovery, and product docs. Employees need plain diagnostic language and direct actions to reach these workflows.

## Decisions

- Offer help in the signed-in account menu and add contextual links on failure and system screens. Use the configured product documentation for signed-out recovery.
- Use existing member and health queries to show relevant checks. Show owner-only system shortcuts only to owners and keep access enforcement on the existing API.
- Build shareable diagnostics from an explicit allowlist of feature, app version, timestamp and server request reference. The owner system screen can also include fixed health categories. Let users review the text before copying or opening their email app.
- Use the configured Crow HR email alias and the shared product subject. HR policy decisions, access changes and employee record corrections belong to the company.

## Risks and trade-offs

Visibility helps people reach the right workflow. Application and organisation permissions still decide who can perform each action. Diagnostic text collects no employee data, hostnames, URLs or error text.
