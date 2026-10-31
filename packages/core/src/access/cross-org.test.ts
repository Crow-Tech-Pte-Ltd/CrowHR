import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientAs,
  createTestDb,
  createTestDeps,
  foreignIds,
  seedMember,
  seedOrg,
  sweepCrossOrg,
  type TestDb,
} from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { recordAudit, systemAuditContext } from "../audit/audit.ts";
import { invitations, memberships } from "../db/schema/access.ts";
import { sessions, ssoProviders } from "../db/schema/auth.ts";
import { buildActor } from "../employees/access.ts";
import { defaultPeoplePorts } from "../employees/ports.ts";
import { seedPeopleOnePerTable } from "../testing/people-sweep.ts";
import { orgScope } from "./org-scope.ts";

describe("cross-organisation isolation", () => {
  let t: TestDb;
  let deps: ReturnType<typeof createTestDeps>;
  let app: ReturnType<typeof createApp>;
  let a: { id: string; slug: string };
  let b: { id: string; slug: string };
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db);
    app = createApp(deps);
    a = await seedOrg(deps, { slug: "org-a" });
    b = await seedOrg(deps, { slug: "org-b" });
    // One of everything in org B.
    const ownerB = await seedMember(deps, b.id, { roles: ["owner"] });
    await seedMember(deps, b.id, { status: "invited", email: "invitee-b@example.sg" });
    const now = deps.clock.now();
    await deps.db.insert(invitations).values({
      id: deps.ids.newId(),
      orgId: b.id,
      email: "invitee-b@example.sg",
      membershipId: ownerB.membershipId,
      tokenHash: "f".repeat(64),
      expiresAt: now,
      createdAt: now,
    });
    await deps.db.insert(ssoProviders).values({
      id: deps.ids.newId(),
      orgId: b.id,
      kind: "oidc",
      displayName: "B IdP",
      issuer: "https://idp.b",
      clientId: "b",
      clientSecretEnc: "x",
      createdAt: now,
      updatedAt: now,
    });
    await deps.db.insert(sessions).values({
      id: "e".repeat(64),
      orgId: b.id,
      userId: ownerB.userId,
      membershipId: ownerB.membershipId,
      authMethod: "password",
      createdAt: now,
      lastSeenAt: now,
      authenticatedAt: now,
      absoluteExpiresAt: new Date(now.getTime() + 3_600_000),
    });
    await recordAudit(deps.db, deps, systemAuditContext(b.id, "system", "seed"), { action: "x.seed", targetType: "t" });
    // People module: one row in each of its tables.
    const ownerActorB = buildActor({
      db: deps.db,
      orgId: b.id,
      userId: ownerB.userId,
      requestId: null,
      roles: ["owner"],
      employeeId: null,
      today: "2026-10-31",
    });
    await seedPeopleOnePerTable(deps, defaultPeoplePorts(deps), ownerActorB);
  });
  afterAll(() => t.close());

  it("answers 404 on every routed record of another organisation, as an owner", async () => {
    const ownerA = await clientAs(app, deps, await seedMember(deps, a.id, { roles: ["owner"] }));
    const ids = await foreignIds(deps.db, b.id);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    const result = await sweepCrossOrg({ app, ownerOfA: ownerA, idsOfB: ids });
    expect(result.untestable).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.checked.length).toBeGreaterThan(10);
  }, 90_000); // Sweeps every routed record of every module (people adds ~20 routes and tables).

  it("orgScope never returns another organisation's row", async () => {
    const [m] = await deps.db.select().from(memberships).where(orgScope(deps.db, b.id).where(memberships));
    expect(m).toBeDefined();
    expect(await orgScope(deps.db, a.id).findById(memberships, m?.id as string)).toBeNull();
    await expect(orgScope(deps.db, a.id).getById(memberships, m?.id as string, "member")).rejects.toThrow(
      "doesn't exist",
    );
    expect(orgScope(deps.db, a.id).values({ x: 1, orgId: b.id }).orgId).toBe(a.id);
  });

  it("the database rejects a cross-org reference (composite FK)", async () => {
    const memberOfB = (await deps.db.select().from(memberships).where(orgScope(deps.db, b.id).where(memberships)))[0];
    await expect(
      deps.db.insert(invitations).values({
        id: deps.ids.newId(),
        orgId: a.id,
        email: "x@a.sg",
        membershipId: memberOfB?.id as string,
        tokenHash: "a".repeat(64),
        expiresAt: deps.clock.now(),
      }),
    ).rejects.toThrow();
  });
});
