/**
 * iOS UI-test seed, run AFTER e2e/seed.ts against the same database: releases last month's payroll
 * for the fictional Kampong Kopi organisation through the real payroll services, so the ESS
 * journey has a payslip to open. Idempotent (skips when the run exists). Test data only.
 *
 *   DATABASE_URL=pglite:<dir> node scripts/ios-ui-seed.ts
 */
import { openDatabase } from "../apps/server/src/db.ts";
import { E2E } from "../e2e/fixtures.ts";
import { systemAuditContext } from "../packages/core/src/audit/audit.ts";
import { createUuidV7Generator, schema, systemClock } from "../packages/core/src/index.ts";
import {
  computeRun,
  createRun,
  markPaid,
  type PayrollActor,
  releaseRun,
  submitRun,
} from "../packages/core/src/payroll/service.ts";
import { approveThroughEngine } from "../packages/core/src/testing/seed-payroll.ts";
import { createTestDeps } from "../packages/core/testing/index.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const database = await openDatabase(url);
const db = database.db;
const ids = createUuidV7Generator(systemClock);
const deps = createTestDeps(db, {
  ids,
  clock: systemClock,
  publicUrl: process.env.PUBLIC_URL ?? "http://127.0.0.1:3100",
});

const org = (await db.select().from(schema.organisations)).find((o) => o.slug === E2E.org.slug);
if (!org) throw new Error("Run e2e/seed.ts first");
const now = new Date(Date.now() + 8 * 3_600_000);
const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const month = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;

const existing = (await db.select().from(schema.payrollRuns)).filter((r) => r.orgId === org.id && r.month === month);
if (existing.length) {
  console.error(`iOS seed: ${month} payroll already exists.`);
} else {
  const users = await db.select().from(schema.users);
  const members = await db.select().from(schema.memberships);
  const actor = (email: string, isOwner: boolean): PayrollActor => {
    const u = users.find((x) => x.email === email);
    const m = members.find((x) => x.userId === u?.id && x.orgId === org.id);
    if (!u || !m) throw new Error(`iOS seed: no member ${email}`);
    return {
      orgId: org.id,
      userId: u.id,
      membershipId: m.id,
      employeeId: null,
      isOwner,
      audit: { ...systemAuditContext(org.id, "system", "ios seed"), actorType: "member", actorMembershipId: m.id },
    };
  };
  // Payroll needs a complete company profile (fictional values).
  const profile = {
    legalName: E2E.org.name,
    uen: "202600001K",
    csn: "202600001KPTE01",
    addressBlock: "1",
    addressStreet: "Kampong Kopi Street",
    postalCode: "018956",
  };
  const profiles = await db.select().from(schema.companyProfiles);
  if (profiles.some((p) => p.orgId === org.id)) {
    const { eq } = await import("../packages/core/node_modules/drizzle-orm/index.js");
    await db.update(schema.companyProfiles).set(profile).where(eq(schema.companyProfiles.orgId, org.id));
  } else {
    await db.insert(schema.companyProfiles).values({ orgId: org.id, ...profile });
  }
  const prep = actor(E2E.members.payroll.email, false);
  const boss = actor(E2E.members.owner.email, true);
  const run = await createRun(deps, prep, { kind: "regular", month });
  await computeRun(deps, prep, run.id);
  await submitRun(deps, prep, run.id);
  await approveThroughEngine(deps, org.id, run.id, boss);
  await releaseRun(deps, prep, run.id);
  await markPaid(deps, prep, run.id);
  console.error(`iOS seed: released ${month} payslips for ${E2E.org.name}.`);
}
await database.close();
