## 1. Approved hourly payroll

- [x] 1.1 In packages/core, save daily payroll facts on timesheet approval. Test reopening, incomplete punches and backward compatibility using timesheet fixtures.
- [x] 1.2 In packages/core, feed dated hourly items into regular and final-pay computation with full approval coverage. Test rate changes, zero hours, manual overrides, exceptional days, stale computations and organisation isolation.
- [x] 1.3 In apps/web, identify timesheet-derived hours in payroll and explain manual fallback. Verify the view against local payroll fixtures.

## 2. Allowance setup

- [x] 2.1 In packages/core, support effective-dated recurring allowance ends through the lifecycle API. Test historical reads, cancel, authorised roles and finalised pay.
- [x] 2.2 In apps/web, add allowance type creation, assignment on hire and add, change and end on Pay. Verify a browser journey through the three screens.

## 3. Leave and attendance controls

- [x] 3.1 In apps/web, add signed leave balance adjustments and existing child record editing. Verify changes persist from the browser under allowed roles.
- [x] 3.2 In apps/web, enable schedule-specific lateness starts, overtime on behalf and replacement claims. Verify a browser journey through settings and the overtime flow.

## 4. Integration

- [x] 4.1 Update the OpenAPI snapshot, user guides and limitations. Run the relevant browser suites, repository checks and OpenSpec validation.

## 5. Approval concurrency

- [x] 5.1 In packages/core, lock the parent request first when escalating and retry failed escalations on the next sweep. Exercise the existing escalation suite and a PostgreSQL contention test in apps/server.
