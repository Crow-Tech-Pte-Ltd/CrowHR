import { is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isTenantTable } from "../src/access/org-scope.ts";
import * as schema from "../src/db/schema/index.ts";
import { createTestDb, createTestDeps, seedMember, seedOrg, type TestDb } from "./index.ts";

/**
 * Tables that are deliberately not org-scoped. Adding one needs a reason here and a review:
 * AGENTS.md rule 6 says every tenant table has org_id.
 */
const GLOBAL_TABLES: Record<string, string> = {
  organisations: "the tenant itself",
  users: "global login identity; one person can belong to several organisations",
  recovery_codes: "belong to the global user, like the TOTP secret",
  auth_throttle: "security infrastructure keyed by account/IP (design decision 10)",
  secret_key_checks: "install-level CROWHR_SECRET_KEY check value",
  audit_heads: "keyed by org_id itself (primary key)",
};

describe("identity schema", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());

  it("has org_id on every tenant table", () => {
    const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));
    const offenders = tables
      .map((table) => ({
        table,
        name: (table as unknown as Record<symbol, string>)[Symbol.for("drizzle:Name")] as string,
      }))
      .filter(({ name, table }) => !(name in GLOBAL_TABLES) && !isTenantTable(table))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it("creates the identity tables", async () => {
    const { rows } = await t.pglite.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    expect(rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        "memberships",
        "membership_roles",
        "invitations",
        "sessions",
        "mfa_challenges",
        "recovery_codes",
        "password_resets",
        "auth_throttle",
        "org_security_settings",
        "sso_providers",
        "user_identities",
        "oidc_transactions",
        "native_auth_requests",
        "device_sessions",
        "audit_events",
        "audit_heads",
        "secret_key_checks",
      ]),
    );
  });

  it("enforces one membership per user per organisation", async () => {
    const deps = createTestDeps(t.db);
    const org = await seedOrg(deps);
    const m = await seedMember(deps, org.id, { email: "dup@example.sg" });
    await expect(
      t.pglite.query(
        `insert into memberships (id, org_id, user_id, status) values ('${deps.ids.newId()}', '${org.id}', '${m.userId}', 'active')`,
      ),
    ).rejects.toThrow(/memberships_org_user_unique/);
  });

  it("rejects a role row that points at another organisation's membership (composite FK)", async () => {
    const deps = createTestDeps(t.db);
    const a = await seedOrg(deps);
    const b = await seedOrg(deps);
    const memberOfB = await seedMember(deps, b.id);
    await expect(
      t.pglite.query(
        `insert into membership_roles (org_id, membership_id, role) values ('${a.id}', '${memberOfB.membershipId}', 'owner')`,
      ),
    ).rejects.toThrow(/membership_roles_membership_fk/);
  });

  it("rejects unknown roles and statuses", async () => {
    const deps = createTestDeps(t.db);
    const org = await seedOrg(deps);
    const m = await seedMember(deps, org.id);
    await expect(
      t.pglite.query(
        `insert into membership_roles (org_id, membership_id, role) values ('${org.id}', '${m.membershipId}', 'god')`,
      ),
    ).rejects.toThrow(/membership_roles_role_check/);
    await expect(
      t.pglite.query(`update memberships set status = 'vip' where id = '${m.membershipId}'`),
    ).rejects.toThrow(/memberships_status_check/);
  });

  it("enforces session-timeout bounds", async () => {
    const deps = createTestDeps(t.db);
    const org = await seedOrg(deps);
    await expect(
      t.pglite.query(`update org_security_settings set idle_timeout_min = 5 where org_id = '${org.id}'`),
    ).rejects.toThrow(/org_security_idle_check/);
  });

  it("makes SSO identities unique per issuer, subject and organisation", async () => {
    const { rows } = await t.pglite.query<{ conname: string }>(
      "select conname from pg_constraint where conname = 'user_identities_issuer_subject_org_unique'",
    );
    expect(rows).toHaveLength(1);
  });
});
