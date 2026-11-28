## Context

The report runner already resolves filters, applies tenant and employee scope, and handles redaction and audit logging. The core PDF renderer uses embedded fonts on both the self-hosted server and the browser demo.

## Goals / Non-Goals

Add a print layout for every report and use the company profile logo. Keep the existing employee directory exports.

## Decisions

- Extend the report export endpoint with `format=pdf` so all formats pass through the same export checks.
- Read branding for the caller's organisation only. Use the organisation name when the company profile is absent.
- Use portrait for narrow tables and landscape for wider tables. Wrap headers and cells, repeat headers as rows continue across pages, and include numbered pages.

## Risks / Trade-offs

Wide reports such as the payroll register use landscape A3 to keep all columns together. Individual columns wrap when their content exceeds their available width.
