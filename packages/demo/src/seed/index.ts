import { type AppDeps, type AssignedRole, createApp, schema } from "@crowhr/core";
import { eq } from "drizzle-orm";
import type { SeedClock } from "../clock.ts";
import { DEMO_PASSWORD, OTHER_MEMBERS, PERSONAS } from "../personas.ts";
import { seedHistory } from "./history.ts";
import { seedHttp } from "./http.ts";
import { DEMO_ORG, type DemoPeople, resignLeaver, seedDemoPeople } from "./people.ts";

/**
 * Seeds the demo database: Kopi Kaki's people through the people services, then four months of
 * the company's life through the public API as the people who would do each step. Payroll is
 * computed by the real engine (nothing is inserted as numbers), approvals go through the real
 * workflows engine, and notifications and Home items are whatever those produce.
 */

export interface SeedResult {
  orgId: string;
  people: DemoPeople;
  members: Record<string, string>;
  runs: Record<string, string>;
}

export async function seedDemo(deps: AppDeps, clock: SeedClock, origin: string): Promise<SeedResult> {
  const { db, ids } = deps;
  clock.set("2026-06-22T09:00");
  const orgId = ids.newId();
  await db.insert(schema.organisations).values({ id: orgId, name: DEMO_ORG.name, slug: DEMO_ORG.slug });
  // Demo personas sign in with one click, so no MFA requirement; sessions last a working day.
  await db
    .insert(schema.orgSecuritySettings)
    .values({ orgId, mfaRequiredRoles: [], idleTimeoutMin: 240, absoluteTimeoutH: 24 });

  // The owner's account exists first so the people seed is attributed to her.
  const ownerUserId = ids.newId();
  const people = await seedDemoPeople(deps, orgId, ownerUserId);

  const members: Record<string, string> = {};
  const passwordHash = await deps.passwordHasher.hash(DEMO_PASSWORD);
  const nameOf = async (employeeId: string) => {
    const [row] = await db
      .select({ legal: schema.employees.legalName })
      .from(schema.employees)
      .where(eq(schema.employees.id, employeeId));
    if (!row) throw new Error(`No employee ${employeeId}`);
    // Legal names as the account name: name order differs by culture, so don't recombine them.
    return row.legal;
  };
  const addMember = async (key: string, email: string, employee: string, roles: readonly AssignedRole[]) => {
    const employeeId = people.employees[employee];
    if (!employeeId) throw new Error(`Unknown seed employee ${employee}`);
    const userId = key === "owner" ? ownerUserId : ids.newId();
    await db.insert(schema.users).values({
      id: userId,
      email,
      displayName: await nameOf(employeeId),
      passwordHash,
      passwordChangedAt: clock.now(),
      emailVerifiedAt: clock.now(),
    });
    const membershipId = ids.newId();
    await db.insert(schema.memberships).values({ id: membershipId, orgId, userId, employeeId, status: "active" });
    for (const role of roles) {
      await db.insert(schema.membershipRoles).values({ orgId, membershipId, role, grantedAt: clock.now() });
    }
    members[key] = membershipId;
  };
  for (const p of PERSONAS) await addMember(p.key, p.email, p.employee, p.roles);
  for (const m of OTHER_MEMBERS) await addMember(m.employee, m.email, m.employee, []);

  await seedSsoProviders(deps, orgId);

  const app = createApp(deps);
  const http = seedHttp(app, origin, () => clock.now().getTime());
  const runs = await seedHistory({
    deps,
    app,
    clock,
    http,
    people,
    members,
    resignLeaver: () => resignLeaver(deps, orgId, ownerUserId, people),
  });
  return { orgId, people, members, runs };
}

/**
 * Google, Microsoft and Singpass appear on the sign-in page so visitors see what staff would see;
 * in demo mode core refuses to start them ("Not available in the demo …"), with no network call.
 * The client IDs are placeholders and the secret is a throwaway string, encrypted like a real one.
 */
async function seedSsoProviders(deps: AppDeps, orgId: string) {
  const now = deps.clock.now();
  const rows = [
    {
      kind: "google" as const,
      displayName: "Google",
      issuer: "https://accounts.google.com",
      allowedDomains: ["kopikaki.example"],
    },
    {
      kind: "entra" as const,
      displayName: "Microsoft",
      issuer: "https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0",
      tenantId: "00000000-0000-0000-0000-000000000000",
    },
    {
      kind: "singpass" as const,
      displayName: "Singpass",
      issuer: "https://stg-id.singpass.gov.sg",
      environment: "staging" as const,
    },
  ];
  for (const r of rows) {
    await deps.db.insert(schema.ssoProviders).values({
      id: deps.ids.newId(),
      orgId,
      kind: r.kind,
      displayName: r.displayName,
      issuer: r.issuer,
      clientId: `demo-${r.kind}-client`,
      clientSecretEnc:
        r.kind === "singpass" ? null : await deps.secretBox.encrypt("sso-client-secret", "demo-not-a-secret"),
      allowedDomains: "allowedDomains" in r ? r.allowedDomains : [],
      tenantId: "tenantId" in r ? r.tenantId : null,
      environment: "environment" in r ? r.environment : null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }
}
