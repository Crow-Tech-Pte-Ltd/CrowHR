import { eq } from "drizzle-orm";
import { recordAudit, systemAuditContext } from "../src/audit/audit.ts";
import { membershipRoles, memberships } from "../src/db/schema/access.ts";
import { orgSecuritySettings } from "../src/db/schema/auth.ts";
import { files } from "../src/db/schema/files.ts";
import { organisations } from "../src/db/schema/organisations.ts";
import { users } from "../src/db/schema/users.ts";
import {
  DEMO_COMPANY_DEFAULTS,
  type DemoCompaniesDeps,
  type DemoProvisionInput,
} from "../src/demo-companies/config.ts";
import type { AppDeps } from "../src/deps.ts";
import { seedEmployee } from "./fixtures.ts";

/**
 * A fast stand-in for the sample-company seed (packages/demo provisions the real one): inserts a
 * demo company with the flag set on insert, four people without passwords at
 * `<name>@<slug>.kopikaki.example`, one audit event and one stored file.
 */
export const FAKE_DEMO_PEOPLE = [
  { key: "owner", name: "Lim Kah Hui", local: "kahhui", roles: ["owner"] as const },
  { key: "hr", name: "Nur Aisyah", local: "aisyah", roles: ["hr_admin"] as const },
  { key: "manager", name: "Siti Nurhaliza", local: "siti", roles: [] as const },
  { key: "employee", name: "Muhammad Hafiz", local: "hafiz", roles: [] as const },
];

export function fakeProvisioner(deps: () => AppDeps) {
  const calls: DemoProvisionInput[] = [];
  const provision = async (input: DemoProvisionInput) => {
    calls.push(input);
    const d = deps();
    const orgId = d.ids.newId();
    await d.db.insert(organisations).values({
      id: orgId,
      name: "Kopi Kaki Pte. Ltd.",
      slug: input.slug,
      demoExpiresAt: input.expiresAt,
      demoClaimedAt: input.claimedAt,
    });
    await d.db.insert(orgSecuritySettings).values({ orgId, mfaRequiredRoles: [] });
    for (const p of FAKE_DEMO_PEOPLE) {
      const userId = d.ids.newId();
      await d.db.insert(users).values({
        id: userId,
        email: `${p.local}@${input.slug}.kopikaki.example`,
        displayName: p.name,
        passwordHash: null,
      });
      const employeeId = await seedEmployee(d, orgId, { legalName: p.name });
      const membershipId = d.ids.newId();
      await d.db.insert(memberships).values({ id: membershipId, orgId, userId, employeeId, status: "active" });
      for (const role of p.roles) {
        await d.db.insert(membershipRoles).values({ orgId, membershipId, role, grantedAt: input.now });
      }
    }
    await recordAudit(d.db, d, systemAuditContext(orgId, "system", "seed"), {
      action: "test.seeded",
      targetType: "organisation",
      targetId: orgId,
    });
    const fileId = d.ids.newId();
    const storageKey = `org/${orgId}/files/${fileId}.png`;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await d.fileStore.put(storageKey, png, { contentType: "image/png" });
    const [owner] = await d.db.select().from(memberships).where(eq(memberships.orgId, orgId)).limit(1);
    await d.db.insert(files).values({
      id: fileId,
      orgId,
      purpose: "claim_receipt",
      sha256: "0".repeat(64),
      mime: "image/png",
      sizeBytes: png.byteLength,
      storageKey,
      originalName: "receipt.png",
      scanStatus: "unscanned",
      uploadedByMembershipId: owner?.id as string,
      createdAt: input.now,
    });
    return { orgId };
  };
  return { provision, calls };
}

/** `deps.demoCompanies` for tests: the defaults, a fake provisioner and simple persona labels. */
export function testDemoCompanies(
  deps: () => AppDeps,
  overrides: Partial<Omit<DemoCompaniesDeps, "provision">> = {},
): DemoCompaniesDeps & { calls: DemoProvisionInput[] } {
  const { provision, calls } = fakeProvisioner(deps);
  return {
    ...DEMO_COMPANY_DEFAULTS,
    poolSize: 0,
    provision,
    personaInfo: (email) => {
      const local = email.split("@")[0];
      const index = FAKE_DEMO_PEOPLE.findIndex((p) => p.local === local);
      const p = FAKE_DEMO_PEOPLE[index];
      return p ? { key: p.key, label: p.key.toUpperCase(), blurb: `The ${p.key}.`, order: index } : null;
    },
    ...overrides,
    calls,
  };
}
