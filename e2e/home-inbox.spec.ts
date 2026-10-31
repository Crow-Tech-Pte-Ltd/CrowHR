import { type Browser, expect, type Page, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";

/**
 * Approvals end to end (workflows tasks 5.2 and the WS3 brief): a request type registered by a test
 * plugin (e2e/workflow-plugin.ts) goes submit → manager approves on Home → HR approves in the
 * inbox → the requester is notified.
 */
test.use({ viewport: { width: 1440, height: 900 } });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await uiSignInOk(page, email);
  return page;
}

async function submit(page: Page, title: string, amountCents?: number) {
  const res = await page.request.post("/api/v1/e2e/requests", {
    data: { title, ...(amountCents !== undefined ? { amountCents } : {}) },
  });
  expect(res.status()).toBe(201);
}

test("a plugin request goes submit → manager approves → HR approves → requester notified", async ({ browser }) => {
  const requester = await signedIn(browser, E2E.members.requester.email);
  await expect(requester.getByRole("heading", { level: 1, name: "Hi, Ahmad" })).toBeVisible();
  await submit(requester, "Milk frothing jug", 4_590);
  await requester.reload();
  const mine = requester.getByTestId("employee-requests");
  await expect(mine).toContainText("Equipment: Milk frothing jug");
  await expect(mine).toContainText("Waiting for Wong Kai Wen");

  const manager = await signedIn(browser, E2E.members.approver.email);
  await expect(manager.getByRole("heading", { level: 1, name: "Work to do" })).toBeVisible();
  const row = manager.getByTestId("approval-row").filter({ hasText: "Milk frothing jug" });
  await expect(row).toContainText("Ahmad Ismail");
  await row.getByRole("button", { name: "Approve Ahmad Ismail's request" }).click();
  await expect(row).toHaveCount(0);
  await expect(manager.getByText("Sent on to the next approver.")).toBeVisible();

  const hr = await signedIn(browser, E2E.members.hr.email);
  await hr.goto("/inbox");
  const task = hr.getByTestId("inbox-task").filter({ hasText: "Milk frothing jug" });
  await task.getByRole("button").click();
  const panel = hr.getByTestId("request-panel");
  await expect(panel).toContainText("Milk frothing jug");
  await expect(panel).toContainText("S$45.90");
  await expect(panel.getByTestId("chain-step").first()).toContainText("Wong Kai Wen");
  await hr.keyboard.press("a");
  await expect(task).toHaveCount(0);

  await requester.reload();
  await expect(requester.getByTestId("unread-count")).toBeVisible();
  await requester.getByTestId("notification-bell").click();
  await expect(requester.getByRole("button", { name: /Your equipment request was approved/ })).toBeVisible();
  await requester.keyboard.press("Escape");
  await expect(mine.getByTestId("my-request").filter({ hasText: "Milk frothing jug" })).toContainText("Approved");
  for (const p of [requester, manager, hr]) await p.context().close();
});

test("Home: rejecting inline needs a comment; the requester sees it", async ({ browser }) => {
  const requester = await signedIn(browser, E2E.members.requester.email);
  await submit(requester, "Spare grinder burrs");
  const manager = await signedIn(browser, E2E.members.approver.email);
  const row = manager.getByTestId("approval-row").filter({ hasText: "Spare grinder burrs" });
  await row.getByRole("button", { name: "Reject Ahmad Ismail's request" }).click();
  const dialog = manager.getByRole("dialog");
  await dialog.getByRole("button", { name: "Reject" }).click();
  await expect(dialog.getByText("Say why, so the requester knows what to change.")).toBeVisible();
  await dialog.getByLabel("Reason").fill("We replaced them in September. Ask again in March.");
  await dialog.getByRole("button", { name: "Reject" }).click();
  await expect(row).toHaveCount(0);

  await requester.reload();
  await requester.getByTestId("notification-bell").click();
  await expect(requester.getByText("Wong Kai Wen: We replaced them in September. Ask again in March.")).toBeVisible();
  for (const p of [requester, manager]) await p.context().close();
});

test("Home with nothing to do: empty state with leave and claim links, no sample data or stat cards", async ({
  browser,
}) => {
  const staff = await signedIn(browser, E2E.members.staff.email);
  const todo = staff.getByTestId("employee-todo");
  await expect(todo).toContainText("Nothing waiting for you");
  await expect(todo.getByRole("link", { name: "Apply for leave" })).toBeVisible();
  await expect(todo.getByRole("link", { name: "Submit a claim" })).toBeVisible();
  await expect(staff.getByTestId("sample-data-notice")).toHaveCount(0);

  const owner = await signedIn(browser, E2E.members.owner.email);
  await expect(owner.getByTestId("home-payroll")).toContainText("Payroll isn't set up yet");
  await expect(owner.getByTestId("home-passes")).toContainText("Not set up yet");
  await expect(owner.getByTestId("sample-data-notice")).toHaveCount(0);
  for (const p of [staff, owner]) await p.context().close();
});
