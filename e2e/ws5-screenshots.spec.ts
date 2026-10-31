import { type Browser, expect, type Page, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";
import { addDays, mondayOf, pickDate, todaySg } from "./leave-helpers.ts";

/**
 * WS5 design-review screenshots (run with WS5_SHOTS_DIR=<dir>): My leave, the apply sheet with a
 * live quote, a request, the team calendar, who's away, the inbox with a leave task, and
 * Settings → Leave, at 1440 and 390 wide. Skipped in normal runs.
 */
const DIR = process.env.WS5_SHOTS_DIR;
test.skip(!DIR, "set WS5_SHOTS_DIR to capture screenshots");

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await uiSignInOk(page, email);
  return page;
}

async function snap(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage });
}

async function both(page: Page, name: string, prepare?: () => Promise<void>, fullPage = true) {
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await prepare?.();
    await snap(page, `${name}-${w}`, fullPage);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("WS5 leave screens", async ({ browser }) => {
  test.setTimeout(180_000);
  const mon = mondayOf(todaySg());

  const nadia = await signedIn(browser, E2E.members.leaveStaff.email);
  await both(nadia, "leave-mine", async () => {
    await nadia.goto("/leave");
    await expect(nadia.getByTestId("balance-annual")).toBeVisible();
  });

  await both(
    nadia,
    "leave-apply-sheet",
    async () => {
      await nadia.goto("/leave?apply=1");
      const sheet = nadia.getByRole("dialog");
      await expect(sheet.getByText("Apply for leave")).toBeVisible();
      await pickDate(nadia, "From", addDays(mon, 14));
      await pickDate(nadia, "To", addDays(mon, 18));
      await sheet.getByLabel("Reason").fill("School holidays with the kids");
      await expect(sheet.getByTestId("quote-quantity")).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Send for approval" })).toBeEnabled();
    },
    false,
  );

  await both(
    nadia,
    "leave-apply-sick",
    async () => {
      await nadia.goto("/leave?apply=1");
      const sheet = nadia.getByRole("dialog");
      await sheet.getByRole("combobox", { name: "Leave type" }).click();
      await nadia.getByRole("option", { name: "Sick leave (outpatient)" }).click();
      await expect(sheet.getByText("Medical certificate (MC)")).toBeVisible();
      await expect(sheet.getByTestId("quote-quantity")).toBeVisible();
    },
    false,
  );

  await both(
    nadia,
    "leave-request",
    async () => {
      await nadia.goto("/leave");
      await nadia.getByTestId("my-leave-request").filter({ hasText: "Sick leave" }).first().click();
      await expect(nadia.getByTestId("leave-request")).toBeVisible();
      await expect(nadia.getByTestId("request-panel")).toBeVisible();
    },
    false,
  );

  const kaiWen = await signedIn(browser, E2E.members.approver.email);
  await both(kaiWen, "leave-calendar-team", async () => {
    await kaiWen.goto("/leave/team");
    await expect(kaiWen.getByTestId("calendar-range")).toBeVisible();
  });
  await both(kaiWen, "leave-inbox", async () => {
    await kaiWen.goto("/inbox");
    const task = kaiWen.getByTestId("inbox-task").filter({ hasText: E2E.members.leaveDad.name }).first();
    await task.getByRole("button").first().click();
    await expect(kaiWen.getByTestId("request-panel")).toContainText("Annual leave");
  });

  const farah = await signedIn(browser, E2E.members.shots.email);
  await both(farah, "leave-whos-away", async () => {
    await farah.goto("/leave/team");
    await expect(farah.getByTestId("calendar-range")).toBeVisible();
  });

  const owner = await signedIn(browser, E2E.members.owner.email);
  await both(owner, "settings-leave-policies", async () => {
    await owner.goto("/settings/leave");
    await expect(owner.getByTestId("policy-row").first()).toBeVisible();
  });
  await both(
    owner,
    "settings-leave-policy-floor",
    async () => {
      await owner.goto("/settings/leave");
      await owner.getByTestId("policy-row").filter({ hasText: "Annual leave" }).click();
      const sheet = owner.getByRole("dialog");
      await sheet.getByRole("combobox", { name: "Entitlement" }).click();
      await owner.getByRole("option", { name: "Same days every year" }).click();
      await sheet.getByLabel("Days a year").fill("5");
      await sheet.getByRole("button", { name: "Save" }).click();
      await expect(sheet.getByTestId("policy-error")).toBeVisible();
    },
    false,
  );
  await both(owner, "settings-leave-holidays", async () => {
    await owner.goto("/settings/leave?tab=holidays");
    await expect(owner.getByTestId("holiday-row").first()).toBeVisible();
  });
  await both(owner, "settings-leave-rules", async () => {
    await owner.goto("/settings/leave?tab=rules");
    await expect(owner.getByText("Comparable full-timer")).toBeVisible();
  });
  await both(owner, "settings-leave-government-paid", async () => {
    await owner.goto("/settings/leave?tab=claims");
    await expect(owner.getByTestId("gov-row").first()).toBeVisible();
  });
});

/** The last Monday–Friday before today (the seed's latest attendance day). */
function lastWeekday(): string {
  let d = addDays(todaySg(), -1);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, -1);
  return d;
}

test("WS5 attendance screens", async ({ browser }) => {
  test.setTimeout(180_000);
  const ahmad = await signedIn(browser, E2E.members.requester.email);
  await both(ahmad, "attendance-clock", async () => {
    await ahmad.goto("/attendance");
    await expect(ahmad.getByTestId("clock-button")).toBeVisible();
  });

  // Offline: one punch waits on the device.
  const farahContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const farah = await farahContext.newPage();
  await uiSignInOk(farah, E2E.members.shots.email);
  await farah.goto("/attendance");
  await expect(farah.getByTestId("clock-button")).toBeVisible();
  await farahContext.setOffline(true);
  await farah.getByTestId("clock-button").click();
  await expect(farah.getByTestId("punch-queue")).toContainText("waiting to send");
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    await farah.setViewportSize({ width: w, height: h });
    await farah.waitForTimeout(300);
    await farah.screenshot({ path: `${DIR}/attendance-clock-queued-${w}.png`, fullPage: true });
  }
  await farahContext.setOffline(false);
  await expect(farah.getByTestId("punch-queue")).toBeHidden({ timeout: 15_000 });
  await farah.setViewportSize({ width: 1440, height: 900 });

  await both(farah, "attendance-timesheet", async () => {
    await farah.goto(`/attendance/timesheet?week=${mondayOf(lastWeekday())}`);
    await expect(farah.getByTestId("timesheet-day").first()).toBeVisible();
  });
  await both(
    farah,
    "attendance-claim-ot",
    async () => {
      await farah.goto(`/attendance/timesheet?week=${mondayOf(lastWeekday())}`);
      await farah.getByTestId("claim-ot").first().click();
      await expect(farah.getByRole("dialog")).toBeVisible();
    },
    false,
  );

  const kaiWen = await signedIn(browser, E2E.members.approver.email);
  await both(kaiWen, "attendance-team", async () => {
    await kaiWen.goto(`/attendance/team?date=${lastWeekday()}`);
    await expect(kaiWen.getByTestId("team-row").first()).toBeVisible();
  });
  await both(
    kaiWen,
    "attendance-correction",
    async () => {
      await kaiWen.goto(`/attendance/team?date=${lastWeekday()}`);
      await kaiWen
        .getByTestId("team-row")
        .filter({ hasText: E2E.members.shots.name })
        .getByRole("button", { name: "Correct" })
        .click();
      await expect(kaiWen.getByRole("dialog")).toBeVisible();
    },
    false,
  );

  const owner = await signedIn(browser, E2E.members.owner.email);
  await both(owner, "attendance-summary", async () => {
    await owner.goto("/attendance/summary");
    await expect(owner.getByTestId("summary-row").first()).toBeVisible();
  });
  await both(owner, "settings-attendance", async () => {
    await owner.goto("/settings/attendance");
    await expect(owner.getByText("Working day and overtime")).toBeVisible();
  });
});
