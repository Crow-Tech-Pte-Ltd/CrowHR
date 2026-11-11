/**
 * DEV ONLY: times the hot read paths on an in-memory PGlite organisation of ~200 employees and
 * counts the SQL statements each request runs (an N+1 shows up as a count that grows with the data).
 *
 *   node packages/core/scripts/bench-hot-paths.ts            # 200 employees
 *   BENCH_EMPLOYEES=50 node packages/core/scripts/bench-hot-paths.ts
 *
 * Seeding goes through the real services and API (hires, leave, claims, punches), so it takes a
 * minute or two. Numbers are medians of BENCH_RUNS (default 5) warm runs.
 */
import { drizzle } from "drizzle-orm/pglite";
import { createApp } from "../src/app.ts";
import { buildClaimsActor } from "../src/claims/access.ts";
import { createClaimType } from "../src/claims/types.ts";
import * as schema from "../src/db/schema/index.ts";
import type { Db } from "../src/db/types.ts";
import { singaporeToday } from "../src/employees/dates.ts";
import { ctxFor, hire } from "../src/employees/lifecycle.ts";
import { defaultPeoplePorts } from "../src/employees/ports.ts";
import { createReportingScopeResolver } from "../src/employees/reports/reporting-scope.ts";
import { createPeopleHarness, hirePayload, OWNER, seedBasicStructure } from "../src/testing/people-harness.ts";
import { clientAs, createTestDb, createTestDeps, movableClock, seedMember, type TestClient } from "../testing/index.ts";

const N = Number(process.env.BENCH_EMPLOYEES ?? 200);
const RUNS = Number(process.env.BENCH_RUNS ?? 5);
const TEAM = 10;

const out = (line: string) => process.stdout.write(`${line}\n`);
let queries = 0;
let tracing = false;
const t = await createTestDb();
// BENCH_TRACE=<ms>: print every statement slower than that during the measured requests.
const traceMs = Number(process.env.BENCH_TRACE ?? 0);
if (traceMs > 0) {
  const proto = Object.getPrototypeOf(t.pglite) as { query: (...a: unknown[]) => Promise<unknown> };
  const original = proto.query;
  proto.query = async function (this: unknown, ...args: unknown[]) {
    const t0 = performance.now();
    try {
      return await original.apply(this, args);
    } finally {
      const ms = performance.now() - t0;
      if (tracing && ms >= traceMs) out(`  slow ${ms.toFixed(0)} ms: ${String(args[0]).slice(0, 400)}`);
    }
  };
}
const db = drizzle({ client: t.pglite, schema, logger: { logQuery: () => void queries++ } }) as unknown as Db;
// Monday 2 Nov 2026, 09:00 SGT: punches for the previous week are within the 7-day window.
const clock = movableClock("2026-11-02T01:00:00.000Z");
const deps = createTestDeps(db, { clock, reportingScope: createReportingScopeResolver(db) });
const h = await createPeopleHarness(deps, { orgName: "Bench Kopi Pte. Ltd." });
delete (h.deps as { people?: unknown }).people;
const structure = await seedBasicStructure(h);
const ports = defaultPeoplePorts(deps);
const owner = h.actor(OWNER);
const started = performance.now();

const hireOne = async (i: number, managerEmployeeId: string | null) =>
  (
    await hire(
      ctxFor(deps, ports, owner),
      hirePayload(structure, {
        person: { legalName: `Bench Person ${i}` },
        job: { hireDate: "2024-01-02", jobTitle: managerEmployeeId ? "Barista" : "Outlet Manager", managerEmployeeId },
        compensation: { payBasis: "monthly", amountCents: 300_000 + i * 100 },
      }),
    )
  ).employeeId;

interface Person {
  employeeId: string;
  member: Awaited<ReturnType<typeof seedMember>>;
  managerIndex: number | null;
}
const people: Person[] = [];
const person = (i: number) => {
  const p = people[i];
  if (!p) throw new Error(`BENCH_EMPLOYEES must be at least ${i + 1}`);
  return p.member;
};
for (let i = 0; i < N; i++) {
  const isManager = i % TEAM === 0;
  const managerIndex = isManager ? null : i - (i % TEAM);
  const managerEmployeeId = managerIndex === null ? null : (people[managerIndex]?.employeeId ?? null);
  const employeeId = await hireOne(i, managerEmployeeId);
  const member = await seedMember(deps, h.orgId, {
    displayName: `Bench Person ${i}`,
    email: `bench${i}@kopi.example`,
    employeeId,
    roles: i === 1 ? ["hr_admin"] : [],
  });
  people.push({ employeeId, member, managerIndex });
}
const ownerMember = await seedMember(deps, h.orgId, {
  displayName: "Owner",
  email: "owner@kopi.example",
  roles: ["owner"],
});
await deps.db.update(schema.users).set({ mfaEnrolledAt: clock.now() });
const app = createApp(deps);
out(`hired ${N} in ${((performance.now() - started) / 1000).toFixed(1)} s`);

const as = (m: Person["member"]) => clientAs(app, deps, m);
const must = async (res: Promise<Response>, status = [200, 201]) => {
  const r = await res;
  if (!status.includes(r.status)) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<Record<string, unknown>>;
};

// Activity: every non-manager applies for two days of annual leave (pending) and files a claim.
const staffClient = await as(person(2));
const types = (await must(staffClient.get("/api/v1/leave/types"))) as { items: { id: string; code: string }[] };
const annual = types.items.find((x) => x.code === "annual")?.id as string;
const claimType = (
  await createClaimType(
    deps,
    buildClaimsActor({
      db: deps.db,
      orgId: h.orgId,
      userId: ownerMember.userId,
      requestId: null,
      roles: ["owner"],
      employeeId: null,
      today: singaporeToday(clock.now()),
      membershipId: ownerMember.membershipId,
    }),
    { code: "TAXI", name: "Taxi", category: "transport", receiptRule: "never", capPeriod: "none" },
  )
).id;
for (const [i, p] of people.entries()) {
  if (p.managerIndex === null) continue;
  const c = await as(p.member);
  const day = [16, 17, 18, 19, 20, 23, 24, 25, 26, 27][i % 10] as number;
  await must(
    c.post("/api/v1/leave/requests", {
      leaveTypeId: annual,
      startDate: `2026-11-${String(day).padStart(2, "0")}`,
      endDate: `2026-11-${String(day).padStart(2, "0")}`,
    }),
  );
  await must(
    c.post("/api/v1/claims", {
      lines: [
        {
          claimTypeId: claimType,
          expenseDate: "2026-10-30",
          merchant: "Grab",
          description: "Taxi",
          currency: "SGD",
          amountMinor: 1000 + i,
          receiptIds: [],
        },
      ],
      submit: true,
    }),
  );
  // Last week's punches (Mon–Fri 26–30 Oct, 09:00–18:00 SGT).
  for (let d = 26; d <= 30; d++) {
    for (const [kind, hour] of [
      ["in", 1],
      ["out", 10],
    ] as const) {
      const at = `2026-10-${d}T${String(hour).padStart(2, "0")}:00:00.000Z`;
      await must(
        c.post("/api/v1/attendance/punches", {
          kind,
          idempotencyKey: `bench-${i}-${d}-${kind}`,
          deviceTime: at,
          sentAt: at,
          queued: true,
          source: "web",
          location: null,
        }),
      );
    }
  }
}
// BENCH_AUDIT_ROWS=<n>: older audit history (submissions of other requests), as after a year of use.
// Inserted raw (outside the hash chain), so don't verify the chain of a bench database.
const auditRows = Number(process.env.BENCH_AUDIT_ROWS ?? 0);
for (let i = 0; i < auditRows; i += 1000) {
  await t.pglite.query(
    `insert into audit_events (id, org_id, seq, at, actor_type, actor_membership_id, action, target_type, target_id, prev_hash, hash)
     select gen_random_uuid(), $1::uuid, 1000000 + $2::int + g, now() - interval '200 days', 'member', $3::uuid,
            'approval.submitted', 'approval_request', gen_random_uuid()::text, '', ''
       from generate_series(1, least(1000, $4::int - $2::int)) g`,
    [h.orgId, i, person(2).membershipId, auditRows],
  );
}
// The same number of decided approval requests (one approved task each), as after a year of use.
for (let i = 0; i < auditRows; i += 1000) {
  await t.pglite.query(
    `with r as (
       insert into approval_requests (id, org_id, subject_type, subject_id, requester_membership_id, policy_name, status, title, submitted_at, decided_at)
       select gen_random_uuid(), $1::uuid, 'claim', gen_random_uuid(), $2::uuid, 'Default', 'approved', 'Old claim', now(), now()
         from generate_series(1, least(1000, $3::int - $4::int)) g
       returning id)
     insert into approval_tasks (id, org_id, request_id, position, assignee_membership_id, origin, status, decided_at, created_at)
     select gen_random_uuid(), $1::uuid, r.id, 1, $5::uuid, 'resolved', 'approved', now(), now() from r`,
    [h.orgId, person(2).membershipId, auditRows, i, person(0).membershipId],
  );
}
// With history: the rest of October's punches too (weekdays 1–23 Oct, 09:00–18:00 SGT), raw.
if (auditRows > 0) {
  await t.pglite.query(
    `insert into attendance_punches (id, org_id, employee_id, kind, idempotency_key, source, device_time, sent_at,
            server_time, recorded_at, work_date, skew_seconds, flags, created_by_membership_id)
     select gen_random_uuid(), $1::uuid, m.employee_id, k.kind, 'hist-' || m.id || '-' || d::date || k.kind, 'web',
            d + k.at, d + k.at, d + k.at, d + k.at, d::date, 0, '[]'::jsonb, m.id
       from memberships m
      cross join generate_series('2026-10-01'::date, '2026-10-23'::date, interval '1 day') d
      cross join (values ('in', interval '1 hour'), ('out', interval '10 hours')) k(kind, at)
      where m.org_id = $1::uuid and m.employee_id is not null and extract(isodow from d) < 6`,
    [h.orgId],
  );
}
// Planner statistics, as autovacuum keeps them on a real server (PGlite never analyzes by itself).
if (process.env.BENCH_ANALYZE !== "0") await t.pglite.exec("analyze");
out(`seeded activity in ${((performance.now() - started) / 1000).toFixed(1)} s`);

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
async function measure(label: string, client: TestClient, path: string) {
  const times: number[] = [];
  let count = 0;
  let status = 0;
  for (let r = 0; r < RUNS + 1; r++) {
    queries = 0;
    tracing = r === RUNS;
    const t0 = performance.now();
    const res = await client.get(path);
    await res.arrayBuffer();
    const ms = performance.now() - t0;
    tracing = false;
    status = res.status;
    if (status >= 500 && r === 0) {
      const last = deps.logger.entries.filter((e) => e.level === "error").at(-1);
      out(`  ${label}: ${String((last as { err?: unknown } | undefined)?.err).slice(0, 1500)}`);
    }
    if (r > 0) times.push(ms); // first run warms caches
    count = queries;
  }
  out(
    `${label.padEnd(44)} ${String(status).padEnd(4)} ${median(times).toFixed(0).padStart(6)} ms ${String(count).padStart(6)} queries`,
  );
}

const ownerC = await as(ownerMember);
const hrC = await as(person(1));
const managerC = await as(person(10));
const staffC = await as(person(12));
out(`${"request".padEnd(44)} code   median    SQL`);
await measure("GET /inbox (owner)", ownerC, "/api/v1/inbox");
await measure("GET /inbox (hr_admin)", hrC, "/api/v1/inbox");
await measure("GET /inbox (manager, 18 tasks)", managerC, "/api/v1/inbox");
await measure("GET /inbox (staff)", staffC, "/api/v1/inbox");
await measure("GET /approvals/tasks (manager)", managerC, "/api/v1/approvals/tasks");
await measure("GET /approvals/requests (hr)", hrC, "/api/v1/approvals/requests?pageSize=200");
const firstTask = ((await must(managerC.get("/api/v1/approvals/tasks"))) as { items: { requestId: string }[] })
  .items[0];
const firstClaim = ((await must(managerC.get("/api/v1/claims"))) as { items: { id: string }[] }).items[0];
await measure("GET /approvals/requests/:id (manager)", managerC, `/api/v1/approvals/requests/${firstTask?.requestId}`);
await measure("GET /claims/:id (manager)", managerC, `/api/v1/claims/${firstClaim?.id}`);
await measure("GET /employees?pageSize=200 (hr)", hrC, "/api/v1/employees?pageSize=200");
await measure("GET /employees?pageSize=50 (manager)", managerC, "/api/v1/employees?pageSize=50");
await measure("GET /leave/requests?pageSize=200 (hr)", hrC, "/api/v1/leave/requests?pageSize=200");
await measure("GET /leave/requests (manager)", managerC, "/api/v1/leave/requests");
await measure("GET /leave/calendar Nov (hr)", hrC, "/api/v1/leave/calendar?from=2026-11-01&to=2026-11-30");
await measure("GET /leave/calendar Nov (manager)", managerC, "/api/v1/leave/calendar?from=2026-11-01&to=2026-11-30");
await measure("GET /leave/balances (staff)", staffC, "/api/v1/leave/balances");
await measure("GET /claims?pageSize=200 (hr)", hrC, "/api/v1/claims?pageSize=200");
await measure("GET /claims (manager)", managerC, "/api/v1/claims");
await measure("GET /attendance/team (hr)", hrC, "/api/v1/attendance/team?from=2026-10-26&to=2026-11-01");
await measure("GET /attendance/team 31 days (hr)", hrC, "/api/v1/attendance/team?from=2026-10-02&to=2026-11-01");
await measure(
  "GET /attendance/timesheet (staff)",
  staffC,
  "/api/v1/attendance/timesheet?from=2026-10-26&to=2026-11-01",
);
await measure("GET /notifications (manager)", managerC, "/api/v1/notifications");
await measure("GET /me (staff)", staffC, "/api/v1/me");
await measure("GET /people/inbox (hr)", hrC, "/api/v1/people/inbox");
await measure("GET /reports/leave.balances (hr)", hrC, "/api/v1/reports/leave.balances?asAt=2026-11-02");
await measure(
  "GET /reports/attendance.exceptions (hr)",
  hrC,
  "/api/v1/reports/attendance.exceptions?from=2026-10-26&to=2026-10-30",
);
// BENCH_PAYROLL=1: the October regular run for everyone (create, compute twice, submit), one shot each.
if (process.env.BENCH_PAYROLL === "1") {
  const once = async (label: string, run: () => Promise<Response>) => {
    queries = 0;
    tracing = true;
    const t0 = performance.now();
    const res = await run();
    const ms = performance.now() - t0;
    tracing = false;
    const body = await res.text();
    out(
      `${label.padEnd(44)} ${String(res.status).padEnd(4)} ${ms.toFixed(0).padStart(6)} ms ${String(queries).padStart(6)} queries`,
    );
    if (res.status >= 400) out(`  ${body.slice(0, 300)}`);
    return body ? (JSON.parse(body) as { id?: string }) : {};
  };
  const run = await once("POST /payroll/runs (owner)", () =>
    ownerC.post("/api/v1/payroll/runs", { kind: "regular", month: "2026-10", payDate: "2026-10-30" }),
  );
  await once("POST /payroll/runs/:id/compute (first)", () => ownerC.post(`/api/v1/payroll/runs/${run.id}/compute`));
  // BENCH_PAYROLL_HISTORY=<months>: earlier paid regular runs, cloned raw from October's payslips
  // (figures are not meaningful; only the volume of payroll history is).
  const months = Number(process.env.BENCH_PAYROLL_HISTORY ?? 0);
  for (let i = 1; i <= months; i++) {
    const d = new Date(Date.UTC(2026, 9 - i, 1));
    const month = d.toISOString().slice(0, 7);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    await t.pglite.query(
      `with r as (
         insert into payroll_runs (id, org_id, kind, month, period_start, period_end, pay_date, status)
         values (gen_random_uuid(), $1::uuid, 'regular', $2, $3::date, $4::date, $4::date, 'paid') returning id)
       insert into payroll_payslips (id, org_id, run_id, employee_id, employee_number, employee_name, input, input_hash,
              result, result_hash, gross_cents, net_cents, net_payable_cents, cpf_employee_cents, cpf_employer_cents,
              blocking_count, warning_count)
       select gen_random_uuid(), p.org_id, r.id, p.employee_id, p.employee_number, p.employee_name, p.input, p.input_hash,
              p.result, p.result_hash, p.gross_cents, p.net_cents, p.net_payable_cents, p.cpf_employee_cents,
              p.cpf_employer_cents, p.blocking_count, p.warning_count
         from payroll_payslips p, r where p.run_id = $5::uuid`,
      [h.orgId, month, `${month}-01`, end, run.id],
    );
  }
  if (months) await t.pglite.exec("analyze");
  await once("POST /payroll/runs/:id/compute (again)", () => ownerC.post(`/api/v1/payroll/runs/${run.id}/compute`));
  await once("GET /payroll/runs/:id", () => ownerC.get(`/api/v1/payroll/runs/${run.id}`));
  await once("POST /payroll/runs/:id/submit", () => ownerC.post(`/api/v1/payroll/runs/${run.id}/submit`));
}
await t.close();
