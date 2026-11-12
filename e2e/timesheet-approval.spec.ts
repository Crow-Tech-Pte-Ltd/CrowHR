import { type Browser, expect, type Page, test } from "@playwright/test";
import { E2E, SHOTS, uiSignInOk } from "./fixtures.ts";

/**
 * Timesheet approval end to end (add-timesheet-approval task 5.2): with weekly approval on, Nadia
 * submits last week's timesheet, her manager Kai Wen sees it in the Inbox and approves it from
 * the Timesheets tab, Nadia's week shows Approved and locked, and a correction to it answers
 * 409 `timesheet_locked` until HR confirms reopening. Approval is turned off again afterwards.
 */
test.use({ viewport: { width: 1440, height: 900 } });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await uiSignInOk(page, email);
  return page;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Monday of last week in Singapore; the week before when last week's overnight cut-off (Mon 04:00) hasn't passed. */
function lastWeek(): { monday: string; wednesday: string } {
  const sg = new Date(Date.now() + 8 * 3_600_000);
  const dow = (sg.getUTCDay() + 6) % 7; // 0 = Monday
  const back = dow === 0 && sg.getUTCHours() < 4 ? 14 : 7;
  const monday = new Date(Date.UTC(sg.getUTCFullYear(), sg.getUTCMonth(), sg.getUTCDate() - dow - back));
  const wednesday = new Date(monday.getTime() + 2 * 86_400_000);
  return { monday: iso(monday), wednesday: iso(wednesday) };
}

async function setApproval(owner: Page, on: boolean) {
  const current = (await (await owner.request.get("/api/v1/attendance/settings")).json()) as Record<string, unknown>;
  const { effectivePdpaNotice: _e, ...rest } = current;
  const res = await owner.request.put("/api/v1/attendance/settings", {
    data: {
      ...rest,
      timesheets: { approval: on, period: "weekly", submittedBy: "employee", payrollApprovedOnly: false },
    },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test("submit → manager approves → the week is locked", async ({ browser }) => {
  test.setTimeout(120_000);
  const week = lastWeek();
  const owner = await signedIn(browser, E2E.members.owner.email);
  await setApproval(owner, true);
  try {
    // Nadia submits last week from My timesheet.
    const nadia = await signedIn(browser, E2E.members.leaveStaff.email);
    await nadia.goto(`/attendance/timesheet?period=${week.monday}`);
    const card = nadia.getByTestId("timesheet-status-card");
    await expect(card.getByTestId("timesheet-status")).toHaveText("Not submitted");
    await expect(nadia.getByTestId("timesheet-day")).toHaveCount(7);
    await card.getByRole("button", { name: "Submit for approval" }).click();
    await expect(card.getByTestId("timesheet-status")).toHaveText("Waiting for approval");
    await expect(card.getByRole("button", { name: "Withdraw" })).toBeVisible();
    if (SHOTS) await nadia.screenshot({ path: `${SHOTS}/timesheet-submitted-1440.png`, fullPage: true });

    // Kai Wen, her manager, has the task in the Inbox and approves it from the Timesheets tab.
    const kaiWen = await signedIn(browser, E2E.members.approver.email);
    await kaiWen.goto("/inbox");
    await expect(
      kaiWen
        .getByTestId("inbox-task")
        .filter({ hasText: E2E.members.leaveStaff.name })
        .filter({ hasText: "Timesheet" }),
    ).toHaveCount(1);
    await kaiWen.goto(`/attendance/timesheets?date=${week.monday}`);
    const row = kaiWen.getByTestId("timesheet-row").filter({ hasText: E2E.members.leaveStaff.name });
    await expect(row.getByTestId("timesheet-status")).toHaveText("Waiting for approval");
    await row.getByRole("button", { name: `Review ${E2E.members.leaveStaff.name}'s timesheet` }).click();
    const sheet = kaiWen.getByTestId("timesheet-sheet");
    await expect(sheet.getByTestId("timesheet-day")).toHaveCount(7);
    if (SHOTS) await kaiWen.screenshot({ path: `${SHOTS}/timesheet-review-1440.png`, fullPage: true });
    await sheet.getByRole("button", { name: "Approve" }).click();
    await expect(sheet.getByTestId("timesheet-status")).toHaveText("Approved");
    await expect(kaiWen.getByText("Timesheet approved. The period is now locked.")).toBeVisible();

    // Nadia's week is approved and every day is locked.
    await nadia.reload();
    await expect(card.getByTestId("timesheet-status")).toHaveText("Approved");
    await expect(nadia.getByTestId("timesheet-status-text")).toContainText("The period is locked");
    await expect(nadia.getByTestId("timesheet-day").getByText("Locked")).toHaveCount(7);
    if (SHOTS) await nadia.screenshot({ path: `${SHOTS}/timesheet-approved-1440.png`, fullPage: true });

    // A correction to a locked day is refused until HR confirms reopening it.
    const me = (await (await nadia.request.get("/api/v1/attendance/me")).json()) as { employeeId: string };
    const correction = {
      employeeId: me.employeeId,
      kind: "in",
      time: `${week.wednesday}T09:00:00+08:00`,
      reason: "Forgot to clock in",
    };
    const refused = await owner.request.post("/api/v1/attendance/corrections", { data: correction });
    expect(refused.status()).toBe(409);
    const body = (await refused.json()) as { error: { code: string; details: { canReopen: boolean } } };
    expect(body.error.code).toBe("timesheet_locked");
    expect(body.error.details.canReopen).toBe(true);
    // In the correction sheet HR sees why, and the button says it reopens the timesheet.
    await kaiWen.goto(`/attendance/team?date=${week.wednesday}`);
    await kaiWen
      .getByTestId("team-row")
      .filter({ hasText: E2E.members.leaveStaff.name })
      .getByRole("button", { name: "Correct" })
      .click();
    await expect(kaiWen.getByTestId("locked-notice")).toContainText("Saving a correction reopens the timesheet");
    await expect(kaiWen.getByRole("button", { name: "Add punch and reopen" })).toBeVisible();
    for (const p of [nadia, kaiWen]) await p.context().close();
  } finally {
    await setApproval(owner, false);
    await owner.context().close();
  }
});
