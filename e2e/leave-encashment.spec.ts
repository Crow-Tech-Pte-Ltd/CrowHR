import { expect, test } from "@playwright/test";
import { apiSignIn, E2E } from "./fixtures.ts";

test("policy-gated employee request, HR employee tab, approval and payroll change list", async ({ browser }) => {
  test.setTimeout(90_000);
  const hr = await browser.newContext();
  const staff = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const payroll = await browser.newContext();
  try {
    await apiSignIn(hr.request, E2E.members.hr.email);
    await apiSignIn(staff.request, E2E.members.leaveStaff.email);
    await apiSignIn(payroll.request, E2E.members.payroll.email);
    const policies = await (await hr.request.get("/api/v1/leave/policies")).json();
    const annual = policies.items.find((t: { code: string }) => t.code === "annual");
    const update = async (enabled: boolean) => {
      const response = await hr.request.patch(`/api/v1/leave/policies/${annual.id}`, {
        data: { policy: { ...annual.policy, encashable: true, employeeEncashmentRequests: enabled } },
      });
      expect(response.status(), await response.text()).toBe(200);
    };
    await update(false);
    const page = await staff.newPage();
    const loaded = page.waitForResponse((r) => r.url().includes("/api/v1/leave/encashments"));
    await page.goto("/leave");
    await loaded;
    // Encashable, but not by the employee's own request: nothing to show them, so no card at all.
    await expect(page.getByTestId("leave-balances")).toBeVisible();
    await expect(page.getByText("Leave encashment", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Encash leave", exact: true })).toHaveCount(0);
    await update(true);
    await page.reload();
    await page.getByRole("button", { name: "Encash leave", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Quantity (days)", { exact: true }).fill("1.5");
    await dialog.getByRole("button", { name: "Send for approval", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Awaiting approval", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect(page.getByText("Withdrawn", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Encash leave", exact: true }).click();
    await dialog.getByLabel("Quantity (days)", { exact: true }).fill("1.5");
    await dialog.getByRole("button", { name: "Send for approval", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const me = await (await staff.request.get("/api/v1/me")).json();
    const hrPage = await hr.newPage();
    await hrPage.goto(`/people/${me.employeeId}?tab=leave`);
    await expect(hrPage.getByRole("button", { name: "Encash leave", exact: true })).toBeVisible();
    await hrPage.getByRole("button", { name: "Encash leave", exact: true }).click();
    await expect(hrPage.getByRole("dialog")).toContainText("HR or payroll must approve");
    await hrPage.getByRole("button", { name: "Cancel", exact: true }).click();
    const encashments = await (await staff.request.get("/api/v1/leave/encashments")).json();
    const encashment = encashments.items.find((r: { status: string }) => r.status === "pending");
    const tasks = await (await hr.request.get("/api/v1/approvals/tasks")).json();
    const task = tasks.items.find((t: { requestId: string }) => t.requestId === encashment.approvalRequestId);
    const decision = await hr.request.post(`/api/v1/approvals/tasks/${task.taskId}/decision`, {
      data: { decision: "approve" },
    });
    expect(decision.status(), await decision.text()).toBe(200);
    await page.reload();
    await expect(page.getByText("Awaiting payroll", { exact: true })).toBeVisible();
    const month = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 7);
    const created = await payroll.request.post("/api/v1/payroll/runs", {
      data: { kind: "regular", month, payDate: `${month}-28` },
    });
    expect(created.status(), await created.text()).toBe(201);
    const run = await created.json();
    const computed = await payroll.request.post(`/api/v1/payroll/runs/${run.id}/compute`);
    expect(computed.status(), await computed.text()).toBe(200);
    const payrollPage = await payroll.newPage();
    await payrollPage.goto(`/payroll/runs/${run.id}`);
    await expect(payrollPage.getByText(/Leave encashment \(1.5 days\)/)).toBeVisible();
    await page.reload();
    await expect(page.getByText("In payroll", { exact: true })).toBeVisible();
  } finally {
    await hr.close();
    await staff.close();
    await payroll.close();
  }
});
