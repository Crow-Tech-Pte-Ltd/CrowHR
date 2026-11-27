## Why

HR staff need to set up pay and correct routine records from the browser. Payroll staff who approve timesheets need to carry usable hourly time into payroll without copying it by hand.

## What Changes

- Bring approved regular hourly work into payroll when the organisation opts into approved-timesheets-only payroll and the approved records contain enough information to price the full period. Keep manual entry available and make exceptions visible.
- Let authorised staff create allowance types and manage effective-dated recurring allowances at hire and on pay changes.
- Give HR browser controls for leave balance adjustments and child record corrections, and expose the existing overtime and schedule settings that are currently API-only. Let employees refile overtime when their earlier claim was rejected or withdrawn.
- Keep overdue approval escalation and concurrent decisions from waiting on each other's locks.

## Capabilities

### Modified Capabilities

- `payroll-run`: approved hourly inputs and allowance type management.
- `employees`: recurring allowances in hire and pay changes.
- `leave`: balance adjustments and child record corrections from the web.
- `attendance`: approved hourly time and overtime and lateness controls in the web app.
- `workflows`: retryable escalation with the approval decision's lock order.

## Impact

Attendance and payroll in `packages/core`, the relevant web screens, targeted unit, integration and browser tests, and the user guides.

## Non-goals

New statutory pricing rules, new payroll frequencies and pay bases, and bank and government submission integration are separate changes.
