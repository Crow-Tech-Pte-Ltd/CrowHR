## Context

This change depends on `add-identity-and-access` for memberships, `authorize()`, `redact()`, `SecretBox`, `audit.record()` and the `ReportingScopeResolver` interface it implements. Payroll and leave have not been specced yet. They are waiting on `research/sg-regulatory.md`, so statutory values here are references into `packages/sg-rules`, not numbers. Requirements are in `specs/organisation` and `specs/employees`.

## Goals / Non-Goals

**Goals:** a single source of truth for the employee "as at" any date; cheap as-at queries for payroll (200 employees × 12 months); history that is never overwritten.

**Non-Goals:** bitemporal history (recording both when something was true and when we learned it). The audit log answers "who changed what when". The effective-dated tables answer "what applied on date D".

## Decisions

1. **Organisation = legal entity.** Entity columns (UEN, CSN, address) live on `organisations`. *Alternative:* a `legal_entities` child table now. That forces every payroll, CPF and IR8A query and every permission check to carry an entity dimension that v1 would not use, and it creates a second isolation boundary inside the first. If multi-entity arrives, a migration can move the columns into `legal_entities` with one row per organisation, keeping today's semantics.

2. **Effective-dating convention, shared by all modules.**
   - Columns are `effective_from date NOT NULL` and `effective_to date NULL`, half-open `[from, to)`.
   - Inserting a new version closes the previous one in the same transaction.
   - Non-overlap is enforced by a service check plus a test, because PGlite's support for `btree_gist` exclusion constraints is not guaranteed.
   - `asAt(table, employeeId, date)` and `asAtMany(table, employeeIds, date)` live in `employees/effective.ts`. This convention is recorded in `docs/architecture.md`.

3. **Lifecycle events are the only write path** for employment and compensation. A service `applyEvent(event)` validates the event, writes the effective-dated rows, links them to `event_id` and records audit, all in one transaction. Cancelling a scheduled event deletes its future rows and re-opens the previous record's `effective_to`. Only `scheduled` events can be cancelled. Effective events are corrected by a new event.

4. **Status is derived, never stored.** "Active", "Leaving on X", "Former" and "Not started" come from tenures and today's date (Asia/Singapore, from the injected `Clock`). A future-dated event therefore needs no cron. The one side effect, the `former` membership transition, runs in the `tick(now)` sweep introduced by `add-approvals-and-notifications`, and runs idempotently.

5. **Manager scope with a recursive CTE** over the current `employment_records` (`manager_employee_id`), capped at depth 20. Cycle prevention happens on write: walk up from the proposed manager and reject if the employee is reached.

6. **Sensitive storage.**
   - `id_number_enc` holds the ciphertext. `id_number_hmac` is unique per organisation and drives duplicate and rehire detection. `id_number_last4` holds the last 3 digits plus the check letter, for the mask.
   - Bank numbers follow the same scheme.
   - The NRIC/FIN checksum is reimplemented from the public algorithm. The research notes `singapore-nric` as MIT, and we vendor or reimplement it with notice. Test vectors cover all five prefixes, including M.

7. **Import pipeline.**
   - Steps: parse (RFC 4180, `papaparse` or a small hand-written parser; it must be runtime-agnostic) → map headers → validate each row with the same zod schemas and services the API uses, in dry-run mode → store the preview in `import_jobs` (rows as JSON, 24-hour TTL) → commit re-validates and applies all rows in one transaction.
   - Re-validating at commit catches anything that changed since the preview.
   - The 2 000-row cap keeps the transaction small.

8. **Change requests reuse workflows.** `profile_change_requests` holds the proposed values (sensitive values encrypted) and is a `workflows` subject of type `profile_change`. The workflow callback `onApproved` applies the change through the normal service with the approver as actor.

9. **Checklists stay simple.** Templates and instances are four tables. Inbox items come from open checklist items through the inbox source interface in `workflows`, not from copies.

## Data model sketch

Every table has `org_id`, and FKs are composite `(org_id, id)`.

| Table | Key columns |
| --- | --- |
| `organisations` (extend) | `slug` unique, `legal_name`, `trading_name`, `uen`, `csn`, `address_*`, `postal_code`, `logo_file_id` |
| `departments` / `teams` / `locations` / `cost_centres` | `id`, `org_id`, `name`, (`code`), (`department_id` for teams), `archived_at` |
| `work_schedules` | `id`, `org_id`, `name`, `kind` (fixed, shift), `is_default` |
| `work_schedule_versions` | `schedule_id`, `effective_from`, `effective_to`, `days jsonb` (7 × {type, minutes}), `weekly_minutes` |
| `employees` | `id`, `org_id`, `employee_number`, `legal_name`, `preferred_name`, `id_type`, `id_number_enc`, `id_number_hmac`, `id_number_last4`, `dob`, `gender`, `nationality`, `residency_status`, `pr_start_date`, `race`, `religion`, `shg_opt_out_on`, `work_email`, `personal_email`, `mobile_e164`, `address jsonb`, `photo_file_id` |
| `emergency_contacts` | `id`, `org_id`, `employee_id`, `name`, `relationship`, `phone_e164`, `position` |
| `bank_accounts` | `id`, `org_id`, `employee_id`, `bank_code`, `account_number_enc`, `account_number_hmac`, `account_last4`, `holder_name`, `effective_from`, `effective_to` |
| `work_passes` | `id`, `org_id`, `employee_id`, `pass_type`, `pass_number_enc`, `issued_on`, `expires_on`, `notes` |
| `tenures` | `id`, `org_id`, `employee_id`, `hire_date`, `last_working_day?`, `notice_given_on?`, `notice_days?`, `cessation_reason?` |
| `employment_records` | `id`, `org_id`, `employee_id`, `tenure_id`, `event_id`, `effective_from`, `effective_to`, `job_title`, `department_id`, `team_id?`, `location_id`, `cost_centre_id?`, `manager_employee_id?`, `employment_type`, `work_schedule_id`, `probation_end`, `ea_covered`, `is_workman` |
| `compensation_records` | `id`, `org_id`, `employee_id`, `event_id`, `effective_from`, `effective_to`, `pay_basis`, `amount_cents`, `reason`, `retroactive` |
| `allowance_types` | `id`, `org_id`, `code`, `name` (payroll adds treatment columns) |
| `recurring_allowances` | `id`, `org_id`, `employee_id`, `allowance_type_id`, `amount_cents`, `effective_from`, `effective_to` |
| `lifecycle_events` | `id`, `org_id`, `employee_id`, `type`, `effective_date`, `payload jsonb`, `cancelled_at`, `created_by` |
| `ytd_opening_balances` | `org_id`, `employee_id`, `year`, `through_month`, `ow_cents`, `aw_cents`, `cpf_ee_cents`, `cpf_er_cents`, `shg_cents` (payroll may add columns) |
| `import_jobs` | `id`, `org_id`, `kind`, `status`, `preview jsonb`, `errors jsonb`, `expires_at`, `created_by` |
| `checklist_templates` / `checklist_template_items` | `kind`, `is_default` / `title`, `assignee_role`, `due_offset_days`, `position` |
| `checklists` / `checklist_items` | `employee_id`, `event_id`, `kind` / `title`, `assignee_role`, `due_on`, `status` (open, done, skipped), `done_by`, `done_at`, `skip_reason` |
| `profile_change_requests` | `id`, `org_id`, `employee_id`, `fields jsonb` (sensitive values encrypted), `attachment_file_id?`, `approval_request_id`, `status` |

## Risks / Trade-offs

- [Effective-dated overlaps from concurrent edits] → `applyEvent` takes `SELECT … FOR UPDATE` on the employee row. A property test generates random event sequences and asserts no overlaps.
- [Race and religion are sensitive personal data] → read access is limited to owner, hr_admin and payroll_admin (who need it for SHG). They are excluded from manager and directory views and from exports unless explicitly selected.
- [YTD fields may be insufficient for IR8A] → `ytd_opening_balances` is owned here but documented as extensible by the payroll change. Import templates are versioned.
- [Statutory TODOs (rest day, minimum age, default notice, CSN payment types) block "done"] → those tasks stay unchecked until `sg-rules` has cited values. The checks call `sg-rules` functions that are clearly marked `// NOT IMPLEMENTED:` until then.

## Migration Plan

Additive. `memberships.employee_id` gets its FK in this change's migration.

## Open Questions

- Should the employee number format be configurable (prefix and padding)? The default is `E0001`. Making it configurable is a settings addition only.
