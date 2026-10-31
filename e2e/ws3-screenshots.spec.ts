import { type Browser, expect, type Page, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";

/**
 * WS3 design-review screenshots (run with WS3_SHOTS_DIR=<dir>): Home (admin and employee), the
 * inbox and Settings → Approvals, at 1440 and 390 wide. Skipped in normal runs.
 */
const DIR = process.env.WS3_SHOTS_DIR;
test.skip(!DIR, "set WS3_SHOTS_DIR to capture screenshots");

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await uiSignInOk(page, email);
  return page;
}

async function snap(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: opts.fullPage ?? true });
}

async function both(page: Page, name: string, prepare?: () => Promise<void>) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare?.();
  await snap(page, `${name}-1440`);
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare?.();
  await snap(page, `${name}-390`);
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("WS3 screens", async ({ browser }) => {
  test.setTimeout(120_000);
  // Ahmad asks for two changes (with Kai Wen); Kai Wen passes one on to HR.
  const requester = await signedIn(browser, E2E.members.requester.email);
  for (const data of [
    { personal: { religion: "buddhism" } },
    { bank: { bankCode: "OCBCSGSG", accountNumber: "5012345678", holderName: "Ahmad Ismail" } },
  ]) {
    expect((await requester.request.post("/api/v1/people/me/change-requests", { data })).status()).toBe(201);
  }
  const kaiWen = await signedIn(browser, E2E.members.approver.email);
  const tasks = (await (await kaiWen.request.get("/api/v1/approvals/tasks")).json()) as {
    items: { taskId: string; title: string }[];
  };
  const personal = tasks.items.find((t) => t.title === "Personal details change");
  if (personal) {
    await kaiWen.request.post(`/api/v1/approvals/tasks/${personal.taskId}/decision`, { data: { decision: "approve" } });
  }
  await kaiWen.context().close();

  const hr = await signedIn(browser, E2E.members.hr.email);
  await both(hr, "home-admin", async () => {
    await hr.goto("/");
    await expect(hr.getByTestId("home-approvals")).toBeVisible();
  });
  await both(hr, "inbox", async () => {
    await hr.goto("/inbox");
    await expect(hr.getByTestId("request-panel")).toBeVisible();
  });
  await hr.goto("/inbox");
  await hr.getByTestId("inbox-task").first().getByRole("checkbox").check();
  await hr.getByTestId("inbox-task").nth(1).getByRole("checkbox").check();
  await expect(hr.getByTestId("bulk-actions")).toBeVisible();
  await snap(hr, "inbox-bulk-1440", { fullPage: false });

  const owner = await signedIn(browser, E2E.members.owner.email);
  await both(owner, "home-owner", async () => {
    await owner.goto("/");
    await expect(owner.getByTestId("home-payroll")).toBeVisible();
  });
  await both(owner, "settings-approvals", async () => {
    await owner.goto("/settings/approvals");
    await expect(owner.getByTestId("approval-chains")).toBeVisible();
  });
  await owner.goto("/settings/approvals");
  await owner.getByRole("button", { name: "Edit Claims approvals" }).click();
  await expect(owner.getByRole("dialog")).toBeVisible();
  await snap(owner, "settings-approvals-editor-1440", { fullPage: false });
  await owner.keyboard.press("Escape");
  await both(owner, "settings-notifications", async () => {
    await owner.goto("/settings/notifications");
    await expect(owner.getByTestId("email-not-configured")).toBeVisible();
  });

  await both(requester, "home-employee", async () => {
    await requester.goto("/");
    await expect(requester.getByTestId("employee-requests")).toBeVisible();
  });
  await requester.goto("/");
  await requester.getByTestId("notification-bell").click();
  await snap(requester, "notifications-1440", { fullPage: false });

  const manager = await signedIn(browser, E2E.members.approver.email);
  await both(manager, "home-manager", async () => {
    await manager.goto("/");
    await expect(manager.getByTestId("home-approvals")).toBeVisible();
  });
  for (const p of [requester, hr, owner, manager]) await p.context().close();
});
