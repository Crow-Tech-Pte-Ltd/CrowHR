import { z } from "zod";
import { createApp } from "../src/app.ts";
import { systemAuditContext } from "../src/audit/audit.ts";
import type { AppDeps, Mailer } from "../src/deps.ts";
import { AppError } from "../src/errors.ts";
import { createApproverDirectory } from "../src/workflows/directory.ts";
import { submitApproval } from "../src/workflows/engine.ts";
import type {
  FinalDecision,
  PeopleDates,
  ProbationEnd,
  SubjectAdapter,
  SubjectAttributes,
  WorkflowPlugin,
  WorkPassExpiry,
} from "../src/workflows/types.ts";
import { type SeededMember, seedMember, seedOrg } from "./fixtures.ts";
import { createTestDb, createTestDeps, type TestDb } from "./index.ts";

/**
 * Workflow test helpers: a fake subject module (in-memory state, records every callback, can be
 * told to refuse), a people-dates double, a capturing mailer and an org with the usual cast.
 */
export interface FakeSubjectModule {
  plugin: WorkflowPlugin;
  calls: { type: string; event: "approved" | "rejected" | "withdrawn"; subjectId: string; decision?: FinalDecision }[];
  state: Map<string, "pending" | "approved" | "rejected" | "withdrawn">;
  /** Make the next onApproved throw this message (e.g. "Not enough leave balance."). */
  failNextApproval(message: string): void;
}

export function createFakeSubjects(
  types: readonly string[] = ["leave", "claim", "payroll_run", "leave_cancellation"],
  options: { inline?: boolean } = {},
): FakeSubjectModule {
  const calls: FakeSubjectModule["calls"] = [];
  const state = new Map<string, "pending" | "approved" | "rejected" | "withdrawn">();
  let fail: string | null = null;
  const adapters = types.map(
    (type): SubjectAdapter<SubjectAttributes> => ({
      type,
      label:
        type === "claim"
          ? "Claim"
          : type === "payroll_run"
            ? "Payroll run"
            : type[0]?.toUpperCase() + type.slice(1).replace(/_/g, " "),
      inlineDecision: options.inline ?? type !== "payroll_run",
      attributes: z.object({ amountCents: z.int().min(0).optional(), typeCode: z.string().optional() }),
      async summary(_db, ref) {
        return {
          title: `${type} ${ref.subjectId.slice(-4)}`,
          lines: [{ label: "Type", value: ref.attributes.typeCode ?? type }],
          context: [{ label: "Balance", value: "10 days" }],
        };
      },
      async onApproved(_db, ref, decision) {
        if (fail) {
          const message = fail;
          fail = null;
          throw new AppError("conflict", message);
        }
        calls.push({ type, event: "approved", subjectId: ref.subjectId, decision });
        state.set(ref.subjectId, "approved");
      },
      async onRejected(_db, ref, decision) {
        calls.push({ type, event: "rejected", subjectId: ref.subjectId, decision });
        state.set(ref.subjectId, "rejected");
      },
      async onWithdrawn(_db, ref) {
        calls.push({ type, event: "withdrawn", subjectId: ref.subjectId });
        state.set(ref.subjectId, "withdrawn");
      },
    }),
  );
  return {
    plugin: { name: "fake-subjects", subjects: adapters },
    calls,
    state,
    failNextApproval(message) {
      fail = message;
    },
  };
}

export function createPeopleDatesDouble(input: { passes?: WorkPassExpiry[]; probations?: ProbationEnd[] } = {}) {
  const passes = [...(input.passes ?? [])];
  const probations = [...(input.probations ?? [])];
  const double: PeopleDates & { passes: WorkPassExpiry[]; probations: ProbationEnd[] } = {
    passes,
    probations,
    async workPassesExpiring(_db, until) {
      return passes.filter((p) => p.expiresOn <= until);
    },
    async probationsEnding(_db, until) {
      return probations.filter((p) => p.endsOn <= until);
    },
  };
  return double;
}

export function createCapturingMailer(): Mailer & {
  sent: { to: string; subject: string; text: string; html?: string }[];
  failing: boolean;
} {
  const mailer = {
    sent: [] as { to: string; subject: string; text: string; html?: string }[],
    failing: false,
    async send(message: { to: string; subject: string; text: string; html?: string }) {
      if (mailer.failing) throw new Error("connect ECONNREFUSED 127.0.0.1:25");
      mailer.sent.push(message);
    },
  };
  return mailer;
}

/** Fixed employee IDs for the cast (the people module isn't here yet; memberships carry them). */
export const EMP = {
  owner: "00000000-0000-7000-8000-0000000000a1",
  hr: "00000000-0000-7000-8000-0000000000a2",
  head: "00000000-0000-7000-8000-0000000000a3",
  manager: "00000000-0000-7000-8000-0000000000a4",
  staff: "00000000-0000-7000-8000-0000000000a5",
  other: "00000000-0000-7000-8000-0000000000a6",
  loner: "00000000-0000-7000-8000-0000000000a7",
} as const;

export interface WorkflowWorld {
  t: TestDb;
  deps: ReturnType<typeof createTestDeps>;
  app: ReturnType<typeof createApp>;
  org: { id: string; slug: string };
  fake: FakeSubjectModule;
  /** Mutable manager map (employeeId → manager employeeId). */
  managers: Record<string, string | null>;
  m: {
    owner: SeededMember;
    hr: SeededMember;
    hr2: SeededMember;
    payroll: SeededMember;
    head: SeededMember;
    manager: SeededMember;
    staff: SeededMember;
    other: SeededMember;
    loner: SeededMember;
  };
  submit(
    member: SeededMember,
    subjectType: string,
    attributes?: SubjectAttributes,
    subjectId?: string,
  ): Promise<{ requestId: string; subjectId: string; created: boolean }>;
  close(): Promise<void>;
}

/**
 * An org with: owner (head of company), two hr_admins, a payroll_admin, a department head who
 * reports to the owner, a manager reporting to the head, staff reporting to the manager, another
 * report of the manager, and a loner with no manager.
 */
export async function createWorkflowWorld(overrides: Partial<AppDeps> = {}): Promise<WorkflowWorld> {
  const t = await createTestDb();
  const fake = createFakeSubjects();
  const managers: Record<string, string | null> = {
    [EMP.head]: EMP.owner,
    [EMP.manager]: EMP.head,
    [EMP.staff]: EMP.manager,
    [EMP.other]: EMP.manager,
    [EMP.hr]: EMP.owner,
  };
  const deps = createTestDeps(t.db, {
    approverDirectory: createApproverDirectory({ managers }),
    workflowPlugins: [fake.plugin],
    ...overrides,
  });
  const app = createApp(deps);
  const org = await seedOrg(deps, { name: "Kampong Kopi Pte. Ltd." });
  const seed = (displayName: string, roles: ("owner" | "hr_admin" | "payroll_admin")[], employeeId: string | null) =>
    seedMember(deps, org.id, {
      displayName,
      roles,
      employeeId,
      email: `${displayName.split(" ")[0]?.toLowerCase()}@kopi.example`,
    });
  const m = {
    owner: await seed("Nur Aisyah", ["owner"], EMP.owner),
    hr: await seed("Tan Mei Ling", ["hr_admin"], EMP.hr),
    hr2: await seed("Goh Pei Shan", ["hr_admin"], null),
    payroll: await seed("Lim Jia Hui", ["payroll_admin"], null),
    head: await seed("Rajesh Kumar", [], EMP.head),
    manager: await seed("Wong Kai Wen", [], EMP.manager),
    staff: await seed("Ravi Kumar", [], EMP.staff),
    other: await seed("Siti Rahmah", [], EMP.other),
    loner: await seed("Daniel Goh", [], EMP.loner),
  };
  return {
    t,
    deps,
    app,
    org,
    fake,
    managers,
    m,
    async submit(member, subjectType, attributes = {}, subjectId = deps.ids.newId()) {
      const r = await deps.db.transaction((tx) =>
        submitApproval(tx, deps, systemAuditContext(org.id, "system", "test"), {
          orgId: org.id,
          subjectType,
          subjectId,
          requesterMembershipId: member.membershipId,
          requesterEmployeeId: member.employeeId,
          attributes,
        }),
      );
      return { requestId: r.requestId, subjectId, created: r.created };
    },
    close: () => t.close(),
  };
}
