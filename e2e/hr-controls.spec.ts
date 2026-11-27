import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { apiSignIn, E2E } from "./fixtures.ts";
import { addDays, mondayOf, todaySg } from "./leave-helpers.ts";

async function checkBothThemes(page: Page, selector: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
      .toBe(colorScheme === "dark");
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
    const { violations } = await new AxeBuilder({ page })
      .include(selector)
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(violations.map(({ id, nodes }) => `${id}: ${nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  }
}

test("HR records a signed adjustment and the employee sees the revised leave balance", async ({ browser }) => {
  const hr = await browser.newContext();
  const staff = await browser.newContext();
  try {
    await apiSignIn(hr.request, E2E.members.approver.email);
    await apiSignIn(staff.request, E2E.members.leaveStaff.email);
    const { employeeId } = await (await staff.request.get("/api/v1/me")).json();
    const hrMe = await (await hr.request.get("/api/v1/me")).json();
    const before = (await (await staff.request.get("/api/v1/leave/balances")).json()).items.find(
      (row: { code: string }) => row.code === "annual",
    );

    const page = await hr.newPage();
    await page.goto(`/people/${employeeId}?tab=leave`);
    await page.getByRole("button", { name: "Adjust Annual leave", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(String(before.year), { exact: true })).toBeVisible();
    await checkBothThemes(page, '[role="dialog"]');
    await dialog.getByLabel("Adjustment (days)").fill("-0.5");
    await dialog.getByLabel("Reason").fill("Correct opening balance from the old system");
    await dialog.getByRole("button", { name: "Save adjustment" }).click();
    await expect(dialog).toHaveCount(0);
    const annual = page.getByRole("table", { name: "Leave balances" }).getByRole("row", { name: /Annual leave/ });
    await expect(annual.getByRole("cell", { name: `${before.available - 0.5} days`, exact: true })).toBeVisible();
    const after = (await (await staff.request.get("/api/v1/leave/balances")).json()).items.find(
      (row: { code: string }) => row.code === "annual",
    );
    expect(after.available).toBe(before.available - 0.5);
    expect(after.adjustments).toBe(before.adjustments - 0.5);

    await page.getByLabel("Leave year", { exact: true }).fill(String(before.year - 1));
    await page.getByRole("button", { name: "Adjust Annual leave", exact: true }).click();
    await expect(dialog.getByText(String(before.year - 1), { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

    await page.goto(`/people/${hrMe.employeeId}?tab=leave`);
    await expect(page.getByRole("table", { name: "Leave balances" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Adjust / })).toHaveCount(0);
  } finally {
    await staff.close();
    await hr.close();
  }
});

test("an employee and HR can edit the same child record, preserving other fields", async ({ browser }) => {
  const hr = await browser.newContext();
  const staff = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await apiSignIn(hr.request, E2E.members.hr.email);
    await apiSignIn(staff.request, E2E.members.leaveDad.email);
    const getChildren = async () => (await (await staff.request.get("/api/v1/leave/children")).json()).items;
    const before = await getChildren();
    const child = before.find((row: { name: string }) => row.name === "Tan Yu Xuan");
    const page = await staff.newPage();
    await page.goto("/leave");
    await page.getByRole("button", { name: `Edit ${child.name}` }).click();
    const dialog = page.getByRole("dialog");
    const name = dialog.getByRole("textbox", { name: "Name", exact: true });
    await expect(name).toHaveValue(child.name);
    await checkBothThemes(page, '[role="dialog"]');
    await name.fill("Tan Yu Xuan Sophie");
    await dialog.getByRole("button", { name: "Save child" }).click();
    await expect(page.getByTestId("leave-children").getByText("Tan Yu Xuan Sophie", { exact: true })).toBeVisible();
    const edited = await getChildren();
    expect(edited).toHaveLength(before.length);
    expect(edited.find((row: { id: string }) => row.id === child.id)).toEqual({ ...child, name: "Tan Yu Xuan Sophie" });

    const hrPage = await hr.newPage();
    await hrPage.goto(`/people/${child.employeeId}?tab=leave`);
    await hrPage.getByRole("button", { name: "Edit Tan Yu Xuan Sophie" }).click();
    const hrDialog = hrPage.getByRole("dialog");
    await hrDialog.getByRole("textbox", { name: "Name", exact: true }).fill(child.name);
    await hrDialog.getByRole("button", { name: "Save child" }).click();
    await expect(hrPage.getByTestId("leave-children").getByText(child.name, { exact: true })).toBeVisible();
    expect(await getChildren()).toEqual(before);

    const balances = async () => (await (await staff.request.get("/api/v1/leave/balances")).json()).items;
    const paternity = (await balances()).find(
      (row: { childId: string; statutoryCode: string }) =>
        row.childId === child.id && row.statutoryCode === "paternity",
    );
    await hrPage.getByRole("button", { name: `Adjust ${paternity.name} · ${child.name}`, exact: true }).click();
    await expect(hrDialog).toContainText(child.name);
    await hrDialog.getByRole("spinbutton", { name: "Adjustment (days)", exact: true }).fill("0.5");
    await hrDialog.getByRole("textbox", { name: "Reason", exact: true }).fill("Family leave balance correction");
    await hrDialog.getByRole("button", { name: "Save adjustment" }).click();
    await expect(hrDialog).toHaveCount(0);
    const changed = (await balances()).find(
      (row: { childId: string; typeId: string }) => row.childId === child.id && row.typeId === paternity.typeId,
    );
    expect(changed.adjustments).toBe(paternity.adjustments + 0.5);
  } finally {
    await staff.close();
    await hr.close();
  }
});

test("HR saves a schedule start, claims overtime for an employee and the employee replaces a withdrawn claim", async ({
  browser,
}) => {
  const hr = await browser.newContext();
  const staff = await browser.newContext();
  try {
    await apiSignIn(hr.request, E2E.members.hr.email);
    await apiSignIn(staff.request, E2E.members.leaveStaff.email);
    const { employeeId } = await (await staff.request.get("/api/v1/me")).json();
    const before = await (await hr.request.get("/api/v1/attendance/settings")).json();
    const { items: schedules } = await (await hr.request.get("/api/v1/organisation/work-schedules")).json();
    const schedule = schedules.find(
      (row: { kind: string; isDefault: boolean }) => row.kind === "fixed" && row.isDefault,
    );
    const page = await hr.newPage();
    await page.goto("/settings/attendance");
    const start = page.getByLabel(`${schedule.name} start (SGT)`, { exact: true });
    await expect(start).toBeVisible();
    await checkBothThemes(page, '[data-testid="attendance-schedule-starts"]');
    await start.fill("07:45");
    try {
      await page.getByRole("button", { name: "Save attendance settings" }).click();
      await expect(page.getByText("Attendance settings saved.", { exact: true })).toBeVisible();
      const saved = await (await hr.request.get("/api/v1/attendance/settings")).json();
      expect(saved.scheduleStartTimes[schedule.id]).toBe("07:45");

      const week = addDays(mondayOf(todaySg()), -21);
      const weekSheet = (await (
        await staff.request.get(`/api/v1/attendance/timesheet?from=${week}&to=${addDays(week, 6)}`)
      ).json()) as { days: { date: string; dayType: string; firstIn: string | null; lastOut: string | null }[] };
      const date = weekSheet.days.find((d) => d.dayType === "working" && !d.firstIn && !d.lastOut)?.date;
      if (!date) throw new Error("The overtime fixture needs an untouched working day.");
      for (const [kind, time] of [
        ["in", "08:00"],
        ["out", "22:00"],
      ]) {
        const response = await hr.request.post("/api/v1/attendance/corrections", {
          data: { employeeId, kind, time: `${date}T${time}:00+08:00`, reason: "Overtime fixture" },
        });
        expect(response.status(), await response.text()).toBe(201);
      }
      const sheet = await (await staff.request.get(`/api/v1/attendance/timesheet?from=${date}&to=${date}`)).json();
      expect(sheet.days[0].scheduledStart).toBe("07:45");
      expect(sheet.days[0].otMinutes).toBeGreaterThanOrEqual(60);
      await page.goto(`/attendance/team?date=${date}`);
      const row = page.getByTestId("team-row").filter({ hasText: E2E.members.leaveStaff.name });
      await row.getByRole("button", { name: /Claim OT/ }).click({ timeout: 5000 });
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(E2E.members.leaveStaff.name);
      await checkBothThemes(page, '[role="dialog"]');
      await dialog.getByRole("spinbutton", { name: "Minutes", exact: true }).fill("60");
      await dialog.getByRole("button", { name: "Send for approval" }).click();
      await expect(row.getByText("OT claimed 1h", { exact: true })).toBeVisible();

      const initial = (await (await staff.request.get(`/api/v1/attendance/timesheet?from=${date}&to=${date}`)).json())
        .days[0].otClaim;
      const withdrew = await staff.request.post(`/api/v1/attendance/overtime/${initial.id}/withdraw`);
      expect(withdrew.status(), await withdrew.text()).toBe(200);
      const staffPage = await staff.newPage();
      await staffPage.goto(`/attendance/timesheet?week=${week}`);
      await staffPage.getByRole("button", { name: /Refile OT/ }).click({ timeout: 5000 });
      const retry = staffPage.getByRole("dialog");
      await retry.getByRole("spinbutton", { name: "Minutes", exact: true }).fill("45");
      await retry.getByRole("button", { name: "Send for approval" }).click();
      await expect(staffPage.getByText("OT claimed 45m", { exact: true })).toBeVisible();
      const replacement = (
        await (await staff.request.get(`/api/v1/attendance/timesheet?from=${date}&to=${date}`)).json()
      ).days[0].otClaim;
      expect(replacement).toMatchObject({ status: "pending", claimedMinutes: 45 });
      expect(replacement.id).not.toBe(initial.id);
      await expect(staffPage.getByRole("button", { name: /Refile OT/ })).toHaveCount(0);
    } finally {
      const restored = await hr.request.put("/api/v1/attendance/settings", { data: before });
      expect(restored.status(), await restored.text()).toBe(200);
    }
  } finally {
    await staff.close();
    await hr.close();
  }
});
