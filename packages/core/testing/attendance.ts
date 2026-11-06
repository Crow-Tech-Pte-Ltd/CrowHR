import { attendancePunches, overtimeClaims } from "../src/db/schema/attendance.ts";
import type { TestClient } from "./http.ts";
import type { createTestDeps } from "./index.ts";

/** Attendance test helpers (WS5). The world itself is `createLeaveWorld` (testing/leave.ts). */

let seq = 0;

/** Sends a punch tapped at `at` (ISO); `sentAt` defaults to the tap time (sent immediately). */
export function punch(
  client: TestClient,
  kind: "in" | "out",
  at: string,
  opts: {
    sentAt?: string;
    queued?: boolean;
    key?: string;
    location?: { latitude: number; longitude: number; accuracyMetres?: number } | null;
    headers?: Record<string, string>;
    /** Milliseconds between the tap and sending, from the device's monotonic clock (native apps). */
    elapsedMs?: number;
    source?: "web" | "mobile_web" | "ios" | "android";
  } = {},
) {
  seq += 1;
  return client.post(
    "/api/v1/attendance/punches",
    {
      kind,
      idempotencyKey: opts.key ?? `test-${seq}-${kind}-${at}`,
      deviceTime: at,
      sentAt: opts.sentAt ?? at,
      queued: opts.queued ?? false,
      source: opts.source ?? "web",
      location: opts.location ?? null,
      ...(opts.elapsedMs === undefined ? {} : { elapsedMs: opts.elapsedMs }),
    },
    { headers: opts.headers },
  );
}

/** One row in every attendance table for `orgId` (cross-organisation sweep). */
export async function seedAttendanceOnePerTable(
  deps: ReturnType<typeof createTestDeps>,
  orgId: string,
  employeeId: string,
  membershipId: string,
): Promise<void> {
  const at = new Date("2026-10-29T01:00:00.000Z");
  await deps.db.insert(attendancePunches).values({
    id: deps.ids.newId(),
    orgId,
    employeeId,
    kind: "in",
    idempotencyKey: "sweep-punch",
    source: "web",
    deviceTime: at,
    sentAt: at,
    serverTime: at,
    recordedAt: at,
    workDate: "2026-10-29",
    skewSeconds: 0,
    flags: [],
    createdByMembershipId: membershipId,
  });
  await deps.db.insert(overtimeClaims).values({
    id: deps.ids.newId(),
    orgId,
    employeeId,
    workDate: "2026-10-29",
    computedMinutes: 60,
    claimedMinutes: 60,
    statutory: true,
    status: "pending",
    createdByMembershipId: membershipId,
  });
}
