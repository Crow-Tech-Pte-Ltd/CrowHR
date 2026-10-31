/**
 * The e2e server: the normal server (apps/server startServer) plus a test request type and a
 * reporting line, so approvals can be exercised end to end before leave, claims and the people
 * module exist. Started by playwright.config.ts after e2e/seed.ts.
 */
// Relative imports: the repo root has no workspace links (bun's isolated installs).
import { startServer } from "../apps/server/src/main.ts";
import { createApproverDirectory, createStaticReportingScope } from "../packages/core/src/index.ts";
import { E2E } from "./fixtures.ts";
import { e2eRequestsModule, e2eWorkflowPlugin } from "./workflow-plugin.ts";

const manager = E2E.members.approver.employeeId;
const report = E2E.members.requester.employeeId;

await startServer({
  deps: {
    workflowPlugins: [e2eWorkflowPlugin],
    // Stand-in for the people module: Ahmad reports to Kai Wen.
    approverDirectory: createApproverDirectory({ managers: { [report]: manager } }),
    reportingScope: createStaticReportingScope({ [manager]: [report] }),
  },
  modules: [e2eRequestsModule],
});
