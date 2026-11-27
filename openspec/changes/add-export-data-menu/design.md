## Context

The report registry already owns report parameters, scope, column redaction, audit and spreadsheet generation. Individual files are usually tied to a run, roster, employee or filing year.

## Decisions

- Use the existing report catalogue in Export data. Each exportable report offers direct downloads using current defaults and a link to filter the report.
- Add JSON to the report exporter. Project each row onto its visible columns, include column types and parameters, and retain integer cents for money.
- Register the payroll, leave, and attendance datasets with existing permissions. Payroll rows keep the run status and revision information. Native downloads are reached through the relevant workflows and retain their required formats and access checks.

## Risks / Trade-offs

- Payroll revisions and original runs may both be needed for review. Record the run state and distinguish net pay from net payable on an adjustment.
- Some downloads require recent sign-in. The menu uses the existing reauthentication prompt and retries once.
