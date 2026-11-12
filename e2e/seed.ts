/**
 * Seeds the e2e database before the server starts (run by playwright.config.ts). Uses the same
 * migrations, schema and argon2id hasher as the server, so the app under test has no seeding
 * backdoor. Idempotent: CI retries reuse the database.
 */
// Relative imports: the repo root has no workspace links (bun's isolated installs).

import { createArgon2Hasher } from "../apps/server/src/argon2-hasher.ts";
import { backupFileName } from "../apps/server/src/backup/backup.ts";
import { openDatabase } from "../apps/server/src/db.ts";
import { singaporeDate } from "../packages/core/src/access/scope.ts";
import { systemAuditContext } from "../packages/core/src/audit/audit.ts";
import { generateRpKeys } from "../packages/core/src/auth/oidc/keys.ts";
import { buildClaimsActor } from "../packages/core/src/claims/access.ts";
import { createStarterTypes } from "../packages/core/src/claims/types.ts";
import { buildActor } from "../packages/core/src/employees/access.ts";
import { submitChangeRequest } from "../packages/core/src/employees/change-requests.ts";
import { ctxFor, hire } from "../packages/core/src/employees/lifecycle.ts";
import { defaultPeoplePorts } from "../packages/core/src/employees/ports.ts";
import { addWorkPass } from "../packages/core/src/employees/work-pass.ts";
import {
  createSecretBox,
  createUuidV7Generator,
  fixedClock,
  orgScope,
  parseSecretKey,
  SECRET_PURPOSES,
  schema,
  systemClock,
} from "../packages/core/src/index.ts";
import { hirePayload, seedBasicStructure } from "../packages/core/src/testing/people-harness.ts";
import { replacePolicies } from "../packages/core/src/workflows/policies.ts";
import { seedMember } from "../packages/core/testing/fixtures.ts";
import { createTestDeps } from "../packages/core/testing/index.ts";
import { E2E } from "./fixtures.ts";
import { seedLeave } from "./seed-leave.ts";
import { seedSchedules } from "./seed-schedules.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const database = await openDatabase(url);
await database.migrate();
const db = database.db;
const ids = createUuidV7Generator(systemClock);
const deps = { db, ids, clock: systemClock, passwordHasher: createArgon2Hasher({ memoryCost: 4096, timeCost: 1 }) };

const existing = (await db.select().from(schema.organisations)).find((o) => o.slug === E2E.org.slug);
if (!existing) {
  const orgId = ids.newId();
  await db
    .insert(schema.organisations)
    .values({ id: orgId, name: E2E.org.name, slug: E2E.org.slug, uen: "202600001K" });
  await db.insert(schema.orgSecuritySettings).values({ orgId });
  for (const m of Object.values(E2E.members)) {
    // biome-ignore lint/suspicious/noExplicitAny: seedMember only needs db/ids/clock/passwordHasher.
    await seedMember(deps as any, orgId, {
      email: m.email,
      displayName: m.name,
      password: E2E.password,
      roles: [...m.roles],
    });
  }
  const people = await seedApprovals(orgId);
  await seedLeave(orgId, people);
  await seedSchedules(orgId, people);
  console.error(`Seeded ${E2E.org.name} with ${Object.keys(E2E.members).length} members.`);
}

// A second organisation with every single sign-on preset enabled, so the sign-in page can be
// reviewed with all methods. Client IDs and secrets are fictional; no IdP is contacted unless a
// button is pressed.
const ssoOrg = (await db.select().from(schema.organisations)).find((o) => o.slug === E2E.ssoOrg.slug);
if (!ssoOrg) {
  const box = createSecretBox(parseSecretKey(process.env.CROWHR_SECRET_KEY ?? ""));
  const orgId = ids.newId();
  await db.insert(schema.organisations).values({ id: orgId, name: E2E.ssoOrg.name, slug: E2E.ssoOrg.slug });
  await db.insert(schema.orgSecuritySettings).values({ orgId });
  // biome-ignore lint/suspicious/noExplicitAny: seedMember only needs db/ids/clock/passwordHasher.
  await seedMember(deps as any, orgId, {
    email: E2E.ssoOrg.owner.email,
    displayName: E2E.ssoOrg.owner.name,
    password: E2E.password,
    roles: ["owner"],
  });
  const now = new Date();
  const secret = await box.encrypt(SECRET_PURPOSES.ssoClientSecret, "fictional-secret");
  const keys = await generateRpKeys();
  const base = { orgId, createdAt: now, updatedAt: now, enabled: true };
  await db.insert(schema.ssoProviders).values([
    {
      ...base,
      id: ids.newId(),
      kind: "singpass",
      displayName: "Singpass",
      issuer: "https://stg-id.singpass.gov.sg/fapi",
      clientId: "fictional-singpass-client",
      environment: "staging",
      privateJwksEnc: await box.encrypt(SECRET_PURPOSES.ssoPrivateJwks, JSON.stringify(keys.privateJwks)),
      publicJwks: keys.publicJwks,
    },
    {
      ...base,
      id: ids.newId(),
      kind: "google",
      displayName: "Google",
      issuer: "https://accounts.google.com",
      clientId: "fictional.apps.googleusercontent.com",
      clientSecretEnc: secret,
      allowedDomains: ["tanjongtech.example"],
      lastTestOkAt: now,
    },
    {
      ...base,
      id: ids.newId(),
      kind: "entra",
      displayName: "Microsoft",
      issuer: "https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0",
      clientId: "fictional-entra-client",
      clientSecretEnc: secret,
      tenantId: "00000000-0000-0000-0000-000000000000",
    },
    {
      ...base,
      id: ids.newId(),
      kind: "oidc",
      displayName: "Okta",
      issuer: "https://tanjongtech.okta.example",
      clientId: "fictional-okta-client",
      clientSecretEnc: secret,
      enabled: false,
    },
  ]);
  console.error(`Seeded ${E2E.ssoOrg.name} with every sign-in method.`);
}

// A third organisation with only its owner, like a company straight after the setup wizard.
const freshOrg = (await db.select().from(schema.organisations)).find((o) => o.slug === E2E.freshOrg.slug);
if (!freshOrg) {
  const orgId = ids.newId();
  await db.insert(schema.organisations).values({ id: orgId, name: E2E.freshOrg.name, slug: E2E.freshOrg.slug });
  await db.insert(schema.orgSecuritySettings).values({ orgId });
  // biome-ignore lint/suspicious/noExplicitAny: seedMember only needs db/ids/clock/passwordHasher.
  await seedMember(deps as any, orgId, {
    email: E2E.freshOrg.owner.email,
    displayName: E2E.freshOrg.owner.name,
    password: E2E.password,
    roles: ["owner"],
  });
  console.error(`Seeded ${E2E.freshOrg.name} with its owner only.`);
}

// A fourth organisation for the generic-OIDC round trip (e2e/security-settings.spec.ts).
const oidcOrg = (await db.select().from(schema.organisations)).find((o) => o.slug === E2E.oidcOrg.slug);
if (!oidcOrg) {
  const orgId = ids.newId();
  await db.insert(schema.organisations).values({ id: orgId, name: E2E.oidcOrg.name, slug: E2E.oidcOrg.slug });
  await db.insert(schema.orgSecuritySettings).values({ orgId });
  for (const [m, roles] of [
    [E2E.oidcOrg.owner, ["owner"]],
    [E2E.oidcOrg.hr, ["hr_admin"]],
    [E2E.oidcOrg.staff, []],
  ] as const) {
    // biome-ignore lint/suspicious/noExplicitAny: seedMember only needs db/ids/clock/passwordHasher.
    await seedMember(deps as any, orgId, { email: m.email, displayName: m.name, password: E2E.password, roles });
  }
  console.error(`Seeded ${E2E.oidcOrg.name} for the OIDC round trip.`);
}

// A fifth organisation where the main organisation's staff member also works (org-switcher spec).
const sisterOrg = (await db.select().from(schema.organisations)).find((o) => o.slug === E2E.sisterOrg.slug);
if (!sisterOrg) {
  const orgId = ids.newId();
  await db.insert(schema.organisations).values({ id: orgId, name: E2E.sisterOrg.name, slug: E2E.sisterOrg.slug });
  await db.insert(schema.orgSecuritySettings).values({ orgId });
  // biome-ignore lint/suspicious/noExplicitAny: seedMember only needs db/ids/clock/passwordHasher.
  await seedMember(deps as any, orgId, { email: E2E.members.staff.email, displayName: E2E.members.staff.name });
  console.error(`Seeded ${E2E.sisterOrg.name} with ${E2E.members.staff.name} as a member.`);
}

// Backups (e2e/system-page.spec.ts): the last successful backup ran three days ago, so Home warns
// owners that it is more than 48 hours old. No archive file exists; only the run is recorded.
if (!(await db.select().from(schema.backupRuns)).length) {
  const started = new Date(Date.now() - 3 * 86_400_000);
  await db.insert(schema.backupRuns).values({
    id: ids.newId(),
    trigger: "scheduled",
    status: "succeeded",
    startedAt: started,
    finishedAt: new Date(started.getTime() + 42_000),
    fileName: backupFileName(started, "scheduled", false),
    sizeBytes: 18_734_592,
    encrypted: false,
    includesKey: true,
  });
}
await database.close();

/**
 * People and approvals (WS3 integration): Kai Wen manages Ahmad and Farah (real employee records,
 * linked to their memberships); Kai Wen is also an HR/payroll admin so he is eligible for
 * personal/bank decisions. Profile changes go manager → HR admin (bank: manager → payroll
 * admin); Farah's personal-details change was sent five days ago and is still with Kai Wen, so
 * the server's first sweep escalates it to HR ("Escalated" in the inbox). Farah's S Pass expires
 * in 40 days and Ahmad's probation ends in 10 (Home cards).
 */
async function seedApprovals(orgId: string) {
  const key = parseSecretKey(process.env.CROWHR_SECRET_KEY ?? "");
  const publicUrl = process.env.PUBLIC_URL ?? "http://127.0.0.1:3100";
  const full = (clock = systemClock) =>
    createTestDeps(db, { clock, ids, secretBox: createSecretBox(key), publicUrl, passwordHasher: deps.passwordHasher });
  const now = full();
  const today = singaporeDate(new Date());
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const users = await db.select().from(schema.users);
  const members = await db.select().from(schema.memberships);
  const member = (email: string) => {
    const u = users.find((x) => x.email === email);
    const m = members.find((x) => x.userId === u?.id && x.orgId === orgId);
    if (!u || !m) throw new Error(`seed: no member ${email}`);
    return { userId: u.id, membershipId: m.id };
  };
  const owner = buildActor({
    db,
    orgId,
    userId: member(E2E.members.owner.email).userId,
    requestId: null,
    roles: ["owner"],
    employeeId: null,
    today,
  });
  const ports = defaultPeoplePorts(now);
  const structure = await seedBasicStructure({ orgId, ports, deps: now, actor: () => owner } as never);
  const hireOne = async (name: string, job: Record<string, unknown> = {}, person: Record<string, unknown> = {}) =>
    (
      await hire(
        ctxFor(now, ports, owner),
        hirePayload(structure, { person: { legalName: name, ...person }, job: { hireDate: day(-10), ...job } }),
      )
    ).employeeId;
  const kaiWen = await hireOne(E2E.members.approver.name, { jobTitle: "Outlet Manager" });
  const ahmad = await hireOne(
    E2E.members.requester.name,
    {
      jobTitle: "Barista",
      managerEmployeeId: kaiWen,
      probationEnd: day(10),
    },
    { preferredName: "Ahmad" },
  );
  const farah = await hireOne(E2E.members.shots.name, { jobTitle: "Barista", managerEmployeeId: kaiWen });
  const link = async (email: string, employeeId: string) =>
    db
      .update(schema.memberships)
      .set({ employeeId })
      .where(orgScope(db, orgId).whereId(schema.memberships, member(email).membershipId));
  await link(E2E.members.approver.email, kaiWen);
  await link(E2E.members.requester.email, ahmad);
  await link(E2E.members.shots.email, farah);
  await addWorkPass(now, ports, buildActor({ ...owner, db, roles: ["hr_admin"], today }), farah, {
    passType: "S_PASS",
    passNumber: "G1234567X",
    issuedOn: "2025-01-02",
    expiresOn: day(40),
  });

  await replacePolicies(db, now, systemAuditContext(orgId, "system", "e2e seed"), orgId, "profile_change", [
    {
      name: "Default",
      condition: null,
      priority: 0,
      steps: [
        { approverRule: "manager", escalateAfterDays: 3 },
        { approverRule: "role:hr_admin", escalateAfterDays: 3 },
      ],
    },
    {
      name: "Bank details",
      condition: { typeCodes: ["bank"] },
      priority: 10,
      steps: [
        { approverRule: "manager", escalateAfterDays: 3 },
        { approverRule: "role:payroll_admin", escalateAfterDays: 3 },
      ],
    },
  ]);

  // Five days ago: Farah asks to correct her religion; Kai Wen hasn't acted.
  const past = full(fixedClock(new Date(Date.now() - 5 * 86_400_000)));
  const farahActor = buildActor({
    db,
    orgId,
    userId: member(E2E.members.shots.email).userId,
    requestId: null,
    roles: [],
    employeeId: farah,
    today,
  });
  await submitChangeRequest(past, defaultPeoplePorts(past), farahActor, { personal: { religion: "islam" } });
  await seedClaims(orgId, member(E2E.members.owner.email), today);
  return { structure, kaiWen, owner, member, deps: now, ports };
}

/**
 * Claims (WS6): the starter claim types (Transport, Meals, Client entertainment, Medical, Dental,
 * Phone) and a manager-only approval policy, so a claim goes employee → manager → approved.
 */
async function seedClaims(orgId: string, owner: { userId: string; membershipId: string }, today: string) {
  const actor = buildClaimsActor({
    db,
    orgId,
    userId: owner.userId,
    requestId: null,
    roles: ["owner"],
    employeeId: null,
    today,
    membershipId: owner.membershipId,
  });
  const claimDeps = createTestDeps(db, { ids, clock: systemClock, passwordHasher: deps.passwordHasher });
  await createStarterTypes(claimDeps, actor);
  await replacePolicies(db, claimDeps, systemAuditContext(orgId, "system", "e2e seed"), orgId, "claim", [
    { name: "Default", condition: null, priority: 0, steps: [{ approverRule: "manager", escalateAfterDays: 3 }] },
  ]);
}
