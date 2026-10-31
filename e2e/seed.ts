/**
 * Seeds the e2e database before the server starts (run by playwright.config.ts). Uses the same
 * migrations, schema and argon2id hasher as the server, so the app under test has no seeding
 * backdoor. Idempotent: CI retries reuse the database.
 */
// Relative imports: the repo root has no workspace links (bun's isolated installs).

import { createArgon2Hasher } from "../apps/server/src/argon2-hasher.ts";
import { openDatabase } from "../apps/server/src/db.ts";
import { generateRpKeys } from "../packages/core/src/auth/oidc/keys.ts";
import {
  createSecretBox,
  createUuidV7Generator,
  parseSecretKey,
  SECRET_PURPOSES,
  schema,
  systemClock,
} from "../packages/core/src/index.ts";
import { seedMember } from "../packages/core/testing/fixtures.ts";
import { E2E } from "./fixtures.ts";

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
      employeeId: "employeeId" in m ? m.employeeId : null,
    });
  }
  await seedApprovals(orgId);
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
      issuer: "https://stg-id.singpass.gov.sg",
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
await database.close();

/**
 * Approvals (WS3): one equipment request submitted five days ago and still waiting for the
 * manager, so the server's first tick escalates it to HR ("Escalated" in the inbox).
 */
async function seedApprovals(orgId: string) {
  const members = await db.select().from(schema.memberships);
  const users = await db.select().from(schema.users);
  const byEmail = (email: string) => {
    const u = users.find((x) => x.email === email);
    const m = members.find((x) => x.userId === u?.id && x.orgId === orgId);
    if (!m) throw new Error(`seed: no member ${email}`);
    return m.id;
  };
  const day = 86_400_000;
  const submitted = new Date(Date.now() - 5 * day);
  const requestId = ids.newId();
  await db.insert(schema.approvalRequests).values({
    id: requestId,
    orgId,
    subjectType: "e2e_equipment",
    subjectId: ids.newId(),
    requesterMembershipId: byEmail(E2E.members.requester.email),
    requesterEmployeeId: E2E.members.requester.employeeId,
    policyName: "Default",
    status: "pending",
    title: "Barista apron and thermometer",
    submittedAt: submitted,
  });
  await db.insert(schema.approvalSteps).values([
    {
      orgId,
      requestId,
      position: 1,
      approverRule: "manager",
      escalateAfterDays: 3,
      status: "active",
      activatedAt: submitted,
    },
    { orgId, requestId, position: 2, approverRule: "role:hr_admin", escalateAfterDays: 3, status: "waiting" },
  ]);
  await db.insert(schema.approvalTasks).values({
    id: ids.newId(),
    orgId,
    requestId,
    position: 1,
    assigneeMembershipId: byEmail(E2E.members.approver.email),
    origin: "resolved",
    status: "pending",
    dueAt: new Date(submitted.getTime() + 3 * day),
    createdAt: submitted,
  });
}
