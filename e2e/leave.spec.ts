import { type Browser, expect, type Page, test } from "@playwright/test";
import { apiSignIn, E2E, uiSignInOk } from "./fixtures.ts";
import { addDays, mondayOf, pickDate, todaySg } from "./leave-helpers.ts";

/**
 * Leave end to end (add-leave task 7.2): Nadia applies for annual leave in the sheet with a live
 * count → Kai Wen approves it in the Inbox → Nadia's taken days go up → an approved no-pay leave
 * shows up in payroll's input for the payroll admin.
 */
test.use({ viewport: { width: 1440, height: 900 } });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await uiSignInOk(page, email);
  return page;
}

const taken = async (page: Page) => {
  const cell = page.getByTestId("balance-annual").getByTestId("balance-taken");
  const text = (await cell.textContent())?.trim() ?? "—";
  return text === "—" ? 0 : Number(text);
};

test("apply in the sheet → manager approves in the Inbox → balance updates → no-pay leave reaches payroll", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const mon = mondayOf(todaySg());
  const from = addDays(mon, 15); // Tuesday in two weeks
  const to = addDays(mon, 16);

  const nadia = await signedIn(browser, E2E.members.leaveStaff.email);
  await nadia.goto("/leave");
  await expect(nadia.getByTestId("balance-annual")).toBeVisible();
  const takenBefore = await taken(nadia);

  await nadia.getByTestId("apply-leave").click();
  const sheet = nadia.getByRole("dialog");
  await expect(sheet.getByText("Apply for leave")).toBeVisible();
  await pickDate(nadia, "From", from);
  await pickDate(nadia, "To", to);
  await sheet.getByLabel("Reason").fill("Wedding in Johor Bahru");
  const quote = sheet.getByTestId("leave-quote");
  await expect(quote).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Send for approval" })).toBeEnabled();
  const quantity = Number(((await quote.getByTestId("quote-quantity").textContent()) ?? "").split(" ")[0]);
  expect(quantity).toBeGreaterThan(0);
  await sheet.getByRole("button", { name: "Send for approval" }).click();
  // The new request opens: pending, waiting for Kai Wen.
  const detail = nadia.getByTestId("leave-request");
  await expect(detail).toContainText("Pending");
  await expect(detail.getByTestId("request-panel")).toContainText("Wong Kai Wen");
  await nadia.keyboard.press("Escape");

  const kaiWen = await signedIn(browser, E2E.members.approver.email);
  await kaiWen.goto("/inbox");
  const task = kaiWen
    .getByTestId("inbox-task")
    .filter({ hasText: E2E.members.leaveStaff.name })
    .filter({ hasText: "Annual leave" })
    .first();
  await task.getByRole("button").first().click();
  const panel = kaiWen.getByTestId("request-panel");
  await expect(panel).toContainText("Wedding in Johor Bahru");
  await expect(panel).toContainText("Annual leave left");
  await kaiWen.keyboard.press("a");
  await expect(task).toHaveCount(0);

  await nadia.reload();
  await expect(nadia.getByTestId("balance-annual")).toBeVisible();
  await expect.poll(() => taken(nadia)).toBe(takenBefore + quantity);
  await expect(nadia.getByTestId("my-leave-request").filter({ hasText: "Annual leave" }).first()).toContainText(
    "Approved",
  );

  // No-pay leave, approved, reaches payroll's input.
  const types = (await (await nadia.request.get("/api/v1/leave/types")).json()) as {
    items: { id: string; code: string }[];
  };
  const noPay = types.items.find((t) => t.code === "no_pay")?.id;
  const npDay = addDays(mon, 17);
  const applied = await nadia.request.post("/api/v1/leave/requests", {
    data: { leaveTypeId: noPay, startDate: npDay, endDate: npDay, startSession: "am", reason: "Personal matter" },
  });
  expect(applied.status(), await applied.text()).toBe(201);
  const tasks = (await (await kaiWen.request.get("/api/v1/approvals/tasks")).json()) as {
    items: { taskId: string; title: string }[];
  };
  const npTask = tasks.items.find((t) => t.title.startsWith("No-pay leave"));
  expect(npTask).toBeTruthy();
  const decided = await kaiWen.request.post(`/api/v1/approvals/tasks/${npTask?.taskId}/decision`, {
    data: { decision: "approve" },
  });
  expect(decided.status(), await decided.text()).toBe(200);

  const payrollContext = await browser.newContext();
  await apiSignIn(payrollContext.request, E2E.members.payroll.email);
  const input = await payrollContext.request.get(
    `/api/v1/leave/payroll-input?periodStart=${npDay.slice(0, 8)}01&periodEnd=${addDays(npDay, 31).slice(0, 8)}01`,
  );
  expect(input.status(), await input.text()).toBe(200);
  const items = ((await input.json()) as { items: { date: string; days: number; leaveTypeCode: string }[] }).items;
  expect(items).toEqual(
    expect.arrayContaining([expect.objectContaining({ date: npDay, days: 0.5, leaveTypeCode: "no_pay" })]),
  );
  // Staff can't read payroll input.
  expect(
    (await nadia.request.get(`/api/v1/leave/payroll-input?periodStart=${npDay}&periodEnd=${npDay}`)).status(),
  ).toBe(403);
});
