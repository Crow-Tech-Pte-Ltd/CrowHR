import { type Browser, expect, type Page, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";

/**
 * Approvals end to end with a real module request type: people's profile change requests
 * (e2e/seed.ts sets their chain to manager → HR admin; bank details: manager → payroll admin).
 * Submit → manager approves on Home → HR approves in the inbox → the change applies and the
 * requester is notified.
 */
test.use({ viewport: { width: 1440, height: 900 } });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await uiSignInOk(page, email);
  return page;
}

async function requestChange(page: Page, body: unknown) {
  const res = await page.request.post("/api/v1/people/me/change-requests", { data: body });
  expect(res.status(), await res.text()).toBe(201);
}

test("a profile change goes submit → manager approves → HR approves → applied and requester notified", async ({
  browser,
}) => {
  const requester = await signedIn(browser, E2E.members.requester.email);
  await expect(requester.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(requester.getByRole("button", { name: /^Account menu/ })).toContainText("Ahmad");
  await requestChange(requester, { personal: { religion: "christianity" } });
  await requester.reload();
  const mine = requester.getByTestId("employee-requests");
  const myRequest = mine.getByTestId("my-request").filter({ hasText: "Personal details change" }).first();
  await expect(myRequest).toContainText("Profile change");
  await expect(myRequest).toContainText("Waiting for Wong Kai Wen");

  const manager = await signedIn(browser, E2E.members.approver.email);
  await expect(manager.getByRole("heading", { level: 1, name: "Work to do" })).toBeVisible();
  const row = manager
    .getByTestId("approval-row")
    .filter({ hasText: E2E.members.requester.name })
    .filter({ hasText: "Personal details change" });
  await row.getByRole("button", { name: "Approve Ahmad Ismail's request" }).click();
  await expect(row).toHaveCount(0);
  await expect(manager.getByText("Sent on to the next approver.")).toBeVisible();

  const hr = await signedIn(browser, E2E.members.hr.email);
  await hr.goto("/inbox");
  const task = hr.getByTestId("inbox-task").filter({ hasText: E2E.members.requester.name });
  await task.getByRole("button").click();
  const panel = hr.getByTestId("request-panel");
  await expect(panel).toContainText("Personal details change");
  await expect(panel).toContainText("Religion");
  await expect(panel).toContainText("Christianity");
  await expect(panel.getByTestId("chain-step").first()).toContainText("Wong Kai Wen");
  await hr.keyboard.press("a");
  await expect(task).toHaveCount(0);

  await requester.reload();
  await expect(requester.getByTestId("unread-count")).toBeVisible();
  await requester.getByTestId("notification-bell").click();
  await expect(requester.getByRole("button", { name: /Your profile change request was approved/ })).toBeVisible();
  await requester.keyboard.press("Escape");
  await expect(myRequest).toContainText("Approved");
  // The people module applied the change.
  const profile = await requester.request.get("/api/v1/people/me/profile");
  expect(JSON.stringify(await profile.json())).toContain("christianity");
  for (const p of [requester, manager, hr]) await p.context().close();
});

test("Home: rejecting inline needs a comment; the requester sees it", async ({ browser }) => {
  const requester = await signedIn(browser, E2E.members.requester.email);
  await requestChange(requester, {
    bank: { bankCode: "DBSSSGSG", accountNumber: "0123456789", holderName: "Ahmad Ismail" },
  });
  const manager = await signedIn(browser, E2E.members.approver.email);
  const row = manager.getByTestId("approval-row").filter({ hasText: "Bank account change" });
  await row.getByRole("button", { name: "Reject Ahmad Ismail's request" }).click();
  const dialog = manager.getByRole("dialog");
  await dialog.getByRole("button", { name: "Reject" }).click();
  await expect(dialog.getByText("Say why, so the requester knows what to change.")).toBeVisible();
  await dialog.getByLabel("Reason").fill("Please use the account in your own name, not the joint one.");
  await dialog.getByRole("button", { name: "Reject" }).click();
  await expect(row).toHaveCount(0);

  await requester.reload();
  await requester.getByTestId("notification-bell").click();
  await expect(
    requester.getByText("Wong Kai Wen: Please use the account in your own name, not the joint one."),
  ).toBeVisible();
  for (const p of [requester, manager]) await p.context().close();
});

test("Home with nothing to do: a plain empty state under the leave and claim buttons; admins see real people data", async ({
  browser,
}) => {
  const staff = await signedIn(browser, E2E.members.staff.email);
  const todo = staff.getByTestId("employee-todo");
  await expect(todo).toContainText("Nothing to do.");
  // The quick actions above the card are the only way in: the empty state doesn't repeat them.
  await expect(staff.getByRole("link", { name: "Apply leave" })).toBeVisible();
  await expect(staff.getByRole("link", { name: "New claim" })).toBeVisible();
  await expect(todo.getByRole("link")).toHaveCount(0);
  await expect(staff.getByTestId("sample-data-notice")).toHaveCount(0);

  const owner = await signedIn(browser, E2E.members.owner.email);
  await expect(owner.getByTestId("home-payroll")).toContainText("Payroll isn't set up yet");
  await expect(owner.getByTestId("home-passes")).toContainText(E2E.members.shots.name);
  await expect(owner.getByTestId("home-probation")).toContainText(E2E.members.requester.name);
  await expect(owner.getByTestId("home-setup")).toContainText("Company profile");
  await expect(owner.getByTestId("sample-data-notice")).toHaveCount(0);
  for (const p of [staff, owner]) await p.context().close();
});
