import type { AssignedRole } from "../src/access/matrix.ts";
import { membershipRoles, memberships } from "../src/db/schema/access.ts";
import { orgSecuritySettings } from "../src/db/schema/auth.ts";
import { organisations } from "../src/db/schema/organisations.ts";
import { users } from "../src/db/schema/users.ts";
import type { Db } from "../src/db/types.ts";
import type { AppDeps } from "../src/deps.ts";

/** Seeds an organisation (with default security settings). */
export async function seedOrg(deps: Pick<AppDeps, "db" | "ids">, input: { name?: string; slug?: string } = {}) {
  const id = deps.ids.newId();
  const slug = input.slug ?? `org-${id.slice(-8)}`;
  await deps.db.insert(organisations).values({ id, name: input.name ?? `Org ${slug}`, slug });
  await deps.db.insert(orgSecuritySettings).values({ orgId: id });
  return { id, slug };
}

export interface SeedMemberInput {
  email?: string;
  displayName?: string;
  /** Plain password; hashed with deps.passwordHasher. Omit for no password. */
  password?: string;
  roles?: readonly AssignedRole[];
  employeeId?: string | null;
  status?: "invited" | "active" | "suspended" | "former";
  /** When the roles were granted (MFA grace period); defaults to now. */
  grantedAt?: Date;
}

export interface SeededMember {
  userId: string;
  membershipId: string;
  email: string;
  password: string | undefined;
  employeeId: string | null;
  orgId: string;
}

/** Seeds a user + membership (+ roles). Reuses the user when the email already exists. */
export async function seedMember(deps: AppDeps, orgId: string, input: SeedMemberInput = {}): Promise<SeededMember> {
  const db: Db = deps.db;
  const email = (input.email ?? `${deps.ids.newId().slice(-12)}@example.sg`).toLowerCase();
  const existing = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.email, email) });
  const userId = existing?.id ?? deps.ids.newId();
  if (!existing) {
    await db.insert(users).values({
      id: userId,
      email,
      displayName: input.displayName ?? email.split("@")[0] ?? email,
      passwordHash: input.password ? await deps.passwordHasher.hash(input.password) : null,
      emailVerifiedAt: deps.clock.now(),
    });
  }
  const membershipId = deps.ids.newId();
  await db.insert(memberships).values({
    id: membershipId,
    orgId,
    userId,
    employeeId: input.employeeId ?? null,
    status: input.status ?? "active",
  });
  for (const role of input.roles ?? []) {
    await db.insert(membershipRoles).values({
      orgId,
      membershipId,
      role,
      grantedAt: input.grantedAt ?? deps.clock.now(),
    });
  }
  return { userId, membershipId, email, password: input.password, employeeId: input.employeeId ?? null, orgId };
}
