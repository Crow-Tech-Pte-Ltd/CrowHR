## Context

Builds on people (employment records, work schedules, compensation for Part 4 coverage), workflows (`overtime` subject type), leave (approved leave days and the employee's holiday calendar from `leave/calendar.ts`) and `sg-rules` (`isPart4Covered`, `checkOvertimeLimits`). See proposal.md for scope.

## Goals / Non-Goals

**Goals:** never lose or duplicate a punch; one timesheet computation shared by screens, OT and reports; OT output identical in shape to payroll's port.

**Non-Goals:** storing derived day records (computed on read); roster matching.

## Decisions

1. **Recorded time = tap time + measured offset.** The client sends `deviceTime` (tap) and `sentAt` (device time when sending). The server's `offset = serverTime − sentAt` estimates the device clock error (network latency is small next to the threshold). `recordedAt = deviceTime + offset`. Skew is `|offset|`; lateness of sync is `serverTime − recordedAt`. This handles a queued punch on a device with a wrong clock, which device time alone cannot. *Alternative:* trusting device time for queued punches; rejected because a wrong device clock then goes unnoticed.

2. **Idempotency at the database.** `unique (org_id, employee_id, idempotency_key)`; insert `on conflict do nothing`, then read back. A replay returns the stored row (200) and a first insert returns 201.

3. **Timesheets are computed.** `timesheet.ts` takes punches (not voided, ordered by recorded time), the schedule day, holiday and leave data, and attendance settings (default start `09:00`, break 60 minutes deducted when the span exceeds 6 hours, grace in/out, OT block and minimum) and returns day records. Work date is the SGT date of the recorded time; an `out` before 04:00 with an open `in` from the previous day closes that day (overnight work).

4. **Corrections are punches.** A correction adds a punch with source `correction`, `created_by` and a reason, or sets `voided_at`/`voided_by`/`void_reason` on an existing one. Original rows are never edited. Each is audited in its transaction.

5. **OT claims per date.** `overtime_claims` holds date, computed and claimed minutes, statutory flag, status and approval request id; one open or approved claim per employee and date. The adapter snapshots the month's OT in the summary context; `onApproved` sets `approved_minutes`. The feed reads approved claims only.

6. **Location and IP.** Settings in `attendance_settings` (one row per org, defaults on read). Haversine distance against each office; CIDR matching for IPv4 and IPv6 in `attendance/network.ts` (no dependency). Coordinates and accuracy are dropped before insert when collection is off. The client IP comes from `deps.resolveClient` (trusted proxies only).

7. **Browser queue.** `localStorage` key `crowhr.punchQueue.v1`: FIFO, up to 200, each item keeps its key and both times; drained on load, on `online`, and after each tap; failed sends stay queued with the last error; a server rejection is shown and moved to the history list, never dropped silently.

## Risks / Trade-offs

- [`sentAt` latency inflates skew on slow networks] → threshold default 2 minutes; flags never block.
- [Overnight shifts beyond 04:00 split across two days] → documented; scheduling (M3) will provide shift bounds.
- [No manager/executive flag on employment records] → Part 4 assumes not a manager/executive; noted in `docs/limitations.md` for the people workstream.

## Migration Plan

Tables ship in the WS5 migration together with leave. Rollback = drop the tables.
