## 1. Schema and settings (packages/core)

- [x] 1.1 packages/core: add `db/schema/attendance.ts` (settings, punches, overtime claims; composite org FKs; unique idempotency key) in the WS5 migration; `attendance/schema.test.ts` proves org_id and cross-org FK rejection
- [x] 1.2 packages/core: write `attendance/network.test.ts` (IPv4/IPv6 CIDR, haversine radius) then implement

## 2. Punches

- [x] 2.1 packages/core: write `attendance/punch.http.test.ts` (recorded time from offset; skew and late-sync flags; idempotent replay; ±7-day rejection; location dropped when off; geofence and IP flag vs block; PDPA notice in status) then implement punches and status

## 3. Timesheets and corrections

- [x] 3.1 packages/core: write `attendance/timesheet.test.ts` (pairs, break, late and early-out with grace, missing punch, rest/off/PH/leave days, overnight out) then implement the computation
- [x] 3.2 packages/core: write `attendance/corrections.http.test.ts` (manager team only, HR all, void and add with reason, audit, employee cannot correct) then implement

## 4. Overtime

- [x] 4.1 packages/core: write `attendance/overtime.http.test.ts` (computed OT block/minimum; claim ≤ computed; Part 4 flag via sg-rules; 72-hour warning; approval through the engine; withdraw) then implement claims and the `overtime` adapter
- [x] 4.2 packages/core: write `attendance/overtime-source.test.ts` (approved only, by date in period, stable sourceId) then implement `attendanceOvertimeSource`

## 5. Reports and access

- [x] 5.1 packages/core: write `attendance/reports.http.test.ts` (summary JSON and CSV; manager team scope) then implement
- [x] 5.2 packages/core: matrix row `attendance:update` and one org-B row per attendance table in `access/cross-org.test.ts`; both pass

## 6. Web (apps/web)

- [ ] 6.1 apps/web: clock-in screen with offline queue, My timesheet, Team timesheet with corrections, OT claims, Settings → Attendance
- [ ] 6.2 e2e: write `e2e/attendance.spec.ts` (clock in offline → queued → back online → replayed once with device and server times) and capture 1440/390 screenshots
