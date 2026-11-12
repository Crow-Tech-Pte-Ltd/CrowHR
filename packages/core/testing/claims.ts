import { and, eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { buildClaimsActor, type ClaimsActor } from "../src/claims/access.ts";
import { type ClaimTypeInput, createClaimType } from "../src/claims/types.ts";
import { claimLineFiles, claimLines, claims, claimTypes } from "../src/db/schema/claims.ts";
import { files } from "../src/db/schema/files.ts";
import { approvalRequests, approvalTasks } from "../src/db/schema/workflows.ts";
import type { AppDeps } from "../src/deps.ts";
import { singaporeToday } from "../src/employees/dates.ts";
import { ctxFor, hire } from "../src/employees/lifecycle.ts";
import { defaultPeoplePorts } from "../src/employees/ports.ts";
import { createReportingScopeResolver } from "../src/employees/reports/reporting-scope.ts";
import type { FileScanner } from "../src/files/scanner.ts";
import { createPeopleHarness, hirePayload, OWNER, seedBasicStructure } from "../src/testing/people-harness.ts";
import { type SeededMember, seedEmployee, seedMember, seedOrg } from "./fixtures.ts";
import { clientAs, movableClock, type TestClient } from "./http.ts";
import { createTestDb, createTestDeps, type TestDb } from "./index.ts";

/** Smallest byte strings that carry each accepted signature (the sniffer checks the header only). */
export const RECEIPT_BYTES = {
  png: new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4,
  ]),
  jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 9, 8, 7, 6, 5, 4]),
  pdf: new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n"),
  webp: new Uint8Array([
    ...new TextEncoder().encode("RIFF"),
    32,
    0,
    0,
    0,
    ...new TextEncoder().encode("WEBPVP8 "),
    1,
    2,
    3,
  ]),
  heic: new Uint8Array([
    0,
    0,
    0,
    24,
    ...new TextEncoder().encode("ftypheic"),
    0,
    0,
    0,
    0,
    ...new TextEncoder().encode("mif1heic"),
  ]),
};

/** A PNG with some distinguishing bytes (different SHA-256 per `seed`). */
export function pngBytes(seed: number): Uint8Array {
  const out = new Uint8Array(RECEIPT_BYTES.png.length + 4);
  out.set(RECEIPT_BYTES.png);
  out.set([seed & 255, (seed >> 8) & 255, 7, 7], RECEIPT_BYTES.png.length);
  return out;
}

export interface ClaimsWorld {
  t: TestDb;
  deps: AppDeps;
  clock: ReturnType<typeof movableClock>;
  app: ReturnType<typeof createApp>;
  orgId: string;
  emp: { boss: string; manager: string; staff: string; other: string; intern: string };
  m: Record<"owner" | "hr" | "payroll" | "boss" | "manager" | "staff" | "other" | "intern", SeededMember>;
  as(who: keyof ClaimsWorld["m"]): Promise<TestClient>;
  actor(who: keyof ClaimsWorld["m"]): ClaimsActor;
  type(input: Partial<ClaimTypeInput> & { code: string }): Promise<string>;
  department: { sales: string; ops: string; finance: string };
}

/**
 * An organisation with real people records and real workflows wiring:
 * boss ← manager ← staff, other (Sales) and intern (Operations, intern, on probation).
 * Members: owner, hr_admin, payroll_admin (no employee), and one per employee.
 */
export async function createClaimsWorld(
  opts: { now?: string; scanner?: FileScanner; deps?: Partial<AppDeps> } = {},
): Promise<ClaimsWorld> {
  const clock = movableClock(opts.now ?? "2026-10-31T01:00:00.000Z");
  const t = await createTestDb();
  const deps = createTestDeps(t.db, {
    clock,
    reportingScope: createReportingScopeResolver(t.db),
    ...(opts.deps ?? {}),
  }) as AppDeps;
  if (opts.scanner) Object.assign(deps, { fileScanner: opts.scanner });
  const h = await createPeopleHarness(deps, { orgName: "Kopi Kaki Pte. Ltd." });
  delete (h.deps as { people?: unknown }).people;
  const structure = await seedBasicStructure(h);
  const ports = defaultPeoplePorts(deps);
  const owner = h.actor(OWNER);
  const hireOne = async (name: string, job: Record<string, unknown> = {}) =>
    (await hire(ctxFor(deps, ports, owner), hirePayload(structure, { person: { legalName: name }, job }))).employeeId;
  const boss = await hireOne("Rajesh Kumar");
  const manager = await hireOne("Wong Kai Wen", { managerEmployeeId: boss });
  const staff = await hireOne("Ravi Kumar", { managerEmployeeId: manager });
  const other = await hireOne("Siti Rahmah", { managerEmployeeId: manager });
  const intern = await hireOne("Lee Jun Jie", {
    managerEmployeeId: manager,
    employmentType: "intern",
    departmentId: structure.departments.ops,
    probationEnd: "2027-01-31",
  });
  const emp = { boss, manager, staff, other, intern };
  const seed = (name: string, roles: ("owner" | "hr_admin" | "payroll_admin")[], employeeId: string | null) =>
    seedMember(deps, h.orgId, {
      displayName: name,
      roles,
      employeeId,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@kopi.example`,
    });
  const m = {
    owner: await seed("Nur Aisyah", ["owner"], null),
    hr: await seed("Tan Mei Ling", ["hr_admin"], null),
    payroll: await seed("Lim Jia Hui", ["payroll_admin"], null),
    boss: await seed("Rajesh Kumar", [], boss),
    manager: await seed("Wong Kai Wen", [], manager),
    staff: await seed("Ravi Kumar", [], staff),
    other: await seed("Siti Rahmah", [], other),
    intern: await seed("Lee Jun Jie", [], intern),
  };
  const app = createApp(deps);
  const clients = new Map<string, Promise<TestClient>>();
  const roleOf: Record<string, string[]> = { owner: ["owner"], hr: ["hr_admin"], payroll: ["payroll_admin"] };
  return {
    t,
    deps,
    clock,
    app,
    orgId: h.orgId,
    emp,
    m,
    department: structure.departments,
    as(who) {
      // A fresh session whenever the clock has moved (sessions expire after inactivity).
      const key = `${who}:${clock.now().getTime()}`;
      let c = clients.get(key);
      if (!c) {
        c = clientAs(app, deps, m[who]);
        clients.set(key, c);
      }
      return c;
    },
    actor(who) {
      const member = m[who];
      return buildClaimsActor({
        db: deps.db,
        orgId: h.orgId,
        userId: member.userId,
        requestId: null,
        roles: roleOf[who] ?? [],
        employeeId: member.employeeId,
        today: singaporeToday(clock.now()),
        membershipId: member.membershipId,
      });
    },
    async type(input) {
      const row = await createClaimType(
        deps,
        buildClaimsActor({
          db: deps.db,
          orgId: h.orgId,
          userId: m.owner.userId,
          requestId: null,
          roles: ["owner"],
          employeeId: null,
          today: singaporeToday(clock.now()),
          membershipId: m.owner.membershipId,
        }),
        {
          name: input.code.charAt(0) + input.code.slice(1).toLowerCase(),
          category: "transport",
          receiptRule: "never",
          capPeriod: "none",
          ...input,
        },
      );
      return row.id;
    },
  };
}

/** JSON helper: `await json(res)`. */
// biome-ignore lint/suspicious/noExplicitAny: test convenience.
export async function json(res: Response): Promise<any> {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Uploads raw bytes as a receipt; returns the response. */
export function uploadAs(client: TestClient, bytes: Uint8Array, fileName = "receipt.png", query = "") {
  return client.request(`/api/v1/claims/receipts?fileName=${encodeURIComponent(fileName)}${query}`, {
    method: "POST",
    body: bytes as BodyInit,
    headers: { "content-type": "application/octet-stream" },
  });
}

export function line(typeId: string, overrides: Record<string, unknown> = {}) {
  return {
    claimTypeId: typeId,
    expenseDate: "2026-10-30",
    merchant: "Grab",
    description: "Taxi to client meeting",
    currency: "SGD",
    amountMinor: 1850,
    receiptIds: [] as string[],
    ...overrides,
  };
}

export async function pendingTask(w: ClaimsWorld, claimId: string, membershipId: string) {
  const [req] = await w.deps.db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, claimId));
  if (!req) return undefined;
  const tasks = await w.deps.db
    .select()
    .from(approvalTasks)
    .where(and(eq(approvalTasks.requestId, req.id), eq(approvalTasks.status, "pending")));
  return tasks.find((t) => t.assigneeMembershipId === membershipId);
}

/** Decides `who`'s pending task on the claim through the Inbox route. */
export async function decide(
  w: ClaimsWorld,
  who: keyof ClaimsWorld["m"],
  claimId: string,
  decision: "approve" | "reject",
  comment?: string,
) {
  const task = await pendingTask(w, claimId, w.m[who].membershipId);
  if (!task) throw new Error(`${who} has no pending task on ${claimId}`);
  return (await w.as(who)).post(`/api/v1/approvals/tasks/${task.id}/decision`, { decision, comment });
}

/** Claims policy: manager only (the built-in chain is manager then hr_admin), plus `extra` policies. */
export async function managerOnlyPolicy(w: ClaimsWorld, extra: unknown[] = []) {
  const res = await (await w.as("owner")).put("/api/v1/approvals/policies/claim", {
    policies: [{ name: "Claims", condition: null, steps: [{ approverRule: "manager" }] }, ...extra],
  });
  if (res.status !== 200) throw new Error(`policy update failed: ${res.status} ${await res.text()}`);
}

/**
 * A second organisation in the same database (one employee, their member and a Transport type),
 * for cross-organisation checks. Its claims and receipts are inserted directly.
 */
export async function seedOtherClaimsOrg(w: ClaimsWorld) {
  const org = await seedOrg(w.deps, { name: "Teh Tarik Trading Pte. Ltd." });
  const employeeId = await seedEmployee(w.deps, org.id, { legalName: "Aminah Ali" });
  const member = await seedMember(w.deps, org.id, { employeeId, email: "aminah@tehtarik.example" });
  const typeId = w.deps.ids.newId();
  await w.deps.db.insert(claimTypes).values({
    id: typeId,
    orgId: org.id,
    code: "TRANSPORT",
    name: "Transport",
    category: "transport",
    receiptRule: "never",
    capPeriod: "none",
  });
  return { orgId: org.id, employeeId, membershipId: member.membershipId, typeId };
}

type OtherOrg = Awaited<ReturnType<typeof seedOtherClaimsOrg>>;

/** Inserts a claim with its lines directly (no validation, no workflow). Returns the claim and line IDs. */
export async function insertClaim(
  deps: AppDeps,
  org: OtherOrg,
  input: {
    status: "draft" | "submitted" | "approved" | "paid" | "rejected" | "withdrawn";
    submittedAt: Date | null;
    lines: {
      currency: string;
      amountMinor: number;
      rateMicros: number | null;
      sgdCents: number;
      receiptIds?: string[];
    }[];
  },
) {
  const claimId = deps.ids.newId();
  await deps.db.insert(claims).values({
    id: claimId,
    orgId: org.orgId,
    employeeId: org.employeeId,
    status: input.status,
    totalCents: input.lines.reduce((s, l) => s + l.sgdCents, 0),
    createdByMembershipId: org.membershipId,
    submittedAt: input.submittedAt,
    ...(input.status === "paid" ? { paidOn: "2026-11-01", paidVia: "outside" as const } : {}),
  });
  const lineIds: string[] = [];
  let position = 0;
  for (const l of input.lines) {
    const id = deps.ids.newId();
    lineIds.push(id);
    await deps.db.insert(claimLines).values({
      id,
      orgId: org.orgId,
      claimId,
      position: ++position,
      claimTypeId: org.typeId,
      expenseDate: "2026-10-30",
      merchant: "Kedai Kopi",
      description: "Teh tarik",
      currency: l.currency,
      currencyExponent: 2,
      amountMinor: l.amountMinor,
      rateMicros: l.rateMicros,
      sgdCents: l.sgdCents,
    });
    let fp = 0;
    for (const fileId of l.receiptIds ?? [])
      await deps.db.insert(claimLineFiles).values({ orgId: org.orgId, claimLineId: id, fileId, position: ++fp });
  }
  return { claimId, lineIds };
}

/** Stores a PNG in the file store and inserts its `files` row directly, uploaded at `createdAt`. */
export async function insertUpload(
  deps: AppDeps,
  org: { orgId: string; employeeId: string; membershipId: string },
  input: { createdAt: Date; purpose?: string; seed?: number },
) {
  const id = deps.ids.newId();
  const storageKey = `org/${org.orgId}/files/${id}.png`;
  const bytes = pngBytes(input.seed ?? 1);
  await deps.fileStore.put(storageKey, bytes, { contentType: "image/png" });
  await deps.db.insert(files).values({
    id,
    orgId: org.orgId,
    purpose: input.purpose ?? "claim_receipt",
    sha256: id.replace(/-/g, "").padEnd(64, "0"),
    mime: "image/png",
    sizeBytes: bytes.byteLength,
    storageKey,
    originalName: "receipt.png",
    scanStatus: "unscanned",
    ownerEmployeeId: org.employeeId,
    uploadedByMembershipId: org.membershipId,
    createdAt: input.createdAt,
  });
  return { id, storageKey };
}
