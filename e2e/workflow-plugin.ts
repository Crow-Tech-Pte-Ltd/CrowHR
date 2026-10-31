/**
 * A request type registered by a test plugin (e2e only), to drive the approval engine end to end
 * before leave and claims exist: "Equipment" requests with a title and an optional amount. Subject
 * state lives in memory in the e2e server process. Never part of the product.
 */
// Relative imports: the repo root has no workspace links (bun's isolated installs).
import { z } from "zod";
import {
  type ApiModule,
  auditContext,
  type Db,
  defineModule,
  defineRoute,
  submitApproval,
  type WorkflowPlugin,
} from "../packages/core/src/index.ts";

export const E2E_SUBJECT = "e2e_equipment";

interface Subject {
  title: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
}
const subjects = new Map<string, Subject>();

/** Seeded requests (e2e/seed.ts) have no in-memory subject: fall back to the request's title. */
async function titleOf(db: Db, subjectId: string, requestId: string): Promise<string> {
  const known = subjects.get(subjectId)?.title;
  if (known) return known;
  const row = await db.query.approvalRequests.findFirst({ where: (r, { eq }) => eq(r.id, requestId) });
  return row?.title ?? "Equipment request";
}

const setStatus = (id: string, status: Subject["status"]) => {
  const s = subjects.get(id);
  if (s) s.status = status;
};

export const e2eWorkflowPlugin: WorkflowPlugin = {
  name: "e2e-equipment",
  subjects: [
    {
      type: E2E_SUBJECT,
      label: "Equipment",
      inlineDecision: true,
      attributes: z.object({ amountCents: z.int().min(0).optional() }),
      async summary(db, ref) {
        const title = await titleOf(db, ref.subjectId, ref.requestId);
        return {
          title,
          lines: [
            { label: "Item", value: title },
            ...(ref.attributes.amountCents !== undefined
              ? [{ label: "Cost", value: `S$${(ref.attributes.amountCents / 100).toFixed(2)}` }]
              : []),
          ],
          context: [{ label: "Spent this year", value: "S$0.00 of S$1,500.00" }],
        };
      },
      async onApproved(_db, ref) {
        setStatus(ref.subjectId, "approved");
      },
      async onRejected(_db, ref) {
        setStatus(ref.subjectId, "rejected");
      },
      async onWithdrawn(_db, ref) {
        setStatus(ref.subjectId, "withdrawn");
      },
    },
  ],
};

export const e2eRequestsModule: ApiModule = defineModule({
  name: "e2e",
  basePath: "/e2e",
  routes: [
    defineRoute({
      method: "post",
      path: "/requests",
      summary: "E2E only: submit an equipment request",
      access: "authenticated",
      request: {
        body: z.object({ title: z.string().min(1).max(120), amountCents: z.int().min(0).optional() }),
      },
      responses: { 201: z.object({ requestId: z.uuid(), subjectId: z.uuid() }) },
      handler: async ({ c, deps, auth, body }) => {
        const subjectId = deps.ids.newId();
        subjects.set(subjectId, { title: body.title, status: "pending" });
        const r = await deps.db.transaction((tx) =>
          submitApproval(tx, deps, auditContext(c), {
            orgId: auth.orgId,
            subjectType: E2E_SUBJECT,
            subjectId,
            requesterMembershipId: auth.membershipId,
            requesterEmployeeId: auth.employeeId,
            attributes: body.amountCents !== undefined ? { amountCents: body.amountCents } : {},
          }),
        );
        return { requestId: r.requestId, subjectId };
      },
    }),
  ],
});
