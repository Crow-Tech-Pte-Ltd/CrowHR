import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { clientAs, createTestDb, createTestDeps, seedMember, seedOrg, type TestDb } from "../../testing/index.ts";
import { createApp } from "../app.ts";
import { defineModule, defineRoute } from "../http/route.ts";
import { redact, withRedactions } from "./redact.ts";
import { createStaticReportingScope } from "./scope.ts";
import { sensitive } from "./sensitivity.ts";

const MGR = "00000000-0000-7000-8000-0000000000a1";
const EMP = "00000000-0000-7000-8000-0000000000a2";

const profile = withRedactions(
  z.object({
    id: z.string(),
    name: z.string(),
    basicPayCents: sensitive(z.number().int().optional(), "salary"),
    nric: sensitive(z.string().optional(), "nric"),
    bankAccountMasked: sensitive(z.string().optional(), "bank"),
    mcCertificateUrl: sensitive(z.string().optional(), "medical"),
  }),
);

const stub = defineModule({
  name: "redact-stub",
  basePath: "/redact-stub",
  routes: [
    defineRoute({
      method: "get",
      path: "/:employeeId",
      summary: "Profile with every sensitivity class",
      access: "authenticated",
      crossOrgExempt: "test stub",
      request: {
        params: z.object({ employeeId: z.string() }),
        query: z.object({ approver: z.enum(["1"]).optional() }),
      },
      responses: { 200: profile },
      handler: ({ c, params, query }) =>
        redact(
          c,
          profile,
          {
            id: params.employeeId,
            name: "Tan Mei Ling",
            basicPayCents: 450_000,
            nric: "S****567D",
            bankAccountMasked: "****6789",
            mcCertificateUrl: "/files/mc.pdf",
          },
          { employeeId: params.employeeId, assignedApproverOfItem: query.approver === "1" },
        ),
    }),
  ],
});

describe("redact()", () => {
  let t: TestDb;
  let app: ReturnType<typeof createApp>;
  let deps: ReturnType<typeof createTestDeps>;
  let orgId: string;
  beforeAll(async () => {
    t = await createTestDb();
    deps = createTestDeps(t.db, { reportingScope: createStaticReportingScope({ [MGR]: [EMP] }) });
    app = createApp(deps, { modules: [stub] });
    orgId = (await seedOrg(deps)).id;
  });
  afterAll(() => t.close());

  const read = async (member: Awaited<ReturnType<typeof seedMember>>, employeeId: string, approver = false) => {
    const http = await clientAs(app, deps, member);
    const res = await http.get(`/api/v1/redact-stub/${employeeId}${approver ? "?approver=1" : ""}`);
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  };

  it("owner sees everything", async () => {
    const body = await read(await seedMember(deps, orgId, { roles: ["owner"] }), EMP);
    expect(body.redactedFields).toBeUndefined();
    expect(body.basicPayCents).toBe(450_000);
  });

  it("hr_admin: compensation and bank fields absent and listed", async () => {
    const body = await read(await seedMember(deps, orgId, { roles: ["hr_admin"] }), EMP);
    expect(body).not.toHaveProperty("basicPayCents");
    expect(body).not.toHaveProperty("bankAccountMasked");
    expect(body.nric).toBe("S****567D");
    expect(body.mcCertificateUrl).toBe("/files/mc.pdf");
    expect(body.redactedFields).toEqual(["bankAccountMasked", "basicPayCents"]);
  });

  it("payroll_admin: pay, NRIC and bank but not medical", async () => {
    const body = await read(await seedMember(deps, orgId, { roles: ["payroll_admin"] }), EMP);
    expect(body.redactedFields).toEqual(["mcCertificateUrl"]);
  });

  it("the employee sees all of their own fields", async () => {
    const body = await read(await seedMember(deps, orgId, { employeeId: EMP }), EMP);
    expect(body.redactedFields).toBeUndefined();
  });

  it("a manager sees none of the sensitive fields of a report", async () => {
    const body = await read(await seedMember(deps, orgId, { employeeId: MGR }), EMP);
    expect(body.redactedFields).toEqual(["bankAccountMasked", "basicPayCents", "mcCertificateUrl", "nric"]);
  });

  it("the assigned approver of a medical item sees that item's medical field only", async () => {
    const mgr = await seedMember(deps, orgId, { employeeId: MGR });
    const asApprover = await read(mgr, EMP, true);
    expect(asApprover.mcCertificateUrl).toBe("/files/mc.pdf");
    expect(asApprover.redactedFields).toEqual(["bankAccountMasked", "basicPayCents", "nric"]);
    const otherDoc = await read(mgr, EMP, false);
    expect(otherDoc).not.toHaveProperty("mcCertificateUrl");
  });
});
