import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { addDays, pickDate, todaySg } from "../leave-helpers.ts";

/**
 * Task 5.3: create a run → review → approve → payslip visible to the employee → download the PDF.
 * The dev server seeds September (paid, released) and October (draft); this test runs November.
 */

async function as(page: Page, persona: string, to: string) {
  await page.goto(`/__dev/as/${persona}?to=${encodeURIComponent(to)}`);
}

async function checkAllowanceAccessibility(page: Page, scope: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
      .toBe(colorScheme === "dark");
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))),
    );
    const result = await new AxeBuilder({ page })
      .include(scope)
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      colorScheme,
    ).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("monthly payroll from creation to the employee's payslip PDF", async ({ page }) => {
  // Payroll admin creates November's run.
  await as(page, "payroll", "/payroll");
  await expect(page.getByRole("heading", { level: 1, name: "Payroll" })).toBeVisible();
  // October's draft is the open-run card, not a row of the table.
  await expect(page.getByRole("heading", { name: /October 2026 payroll/ })).toBeVisible();

  // Year end: IR8A rows from the approved September payslips, for IRAS's import template.
  const ir8a = page.getByTestId("payroll-ir8a");
  await expect(ir8a).toContainText("Income year 2026 (Year of Assessment 2027)");
  await expect(ir8a).toContainText("Appendix 8A");
  const [csv] = await Promise.all([page.waitForEvent("download"), ir8a.getByRole("button", { name: "CSV" }).click()]);
  expect(csv.suggestedFilename()).toBe("ir8a-2026-part1-of-1.csv");
  expect(readFileSync(await csv.path(), "utf8")).toContain("*Record No.,*ID Type [Choose option]");

  await page.getByRole("button", { name: "New run" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Month", { exact: true }).fill("2026-11");
  await dialog.getByRole("button", { name: "Create run" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("November 2026 payroll");

  // Compute: the part-timer has no hours yet, which blocks the run.
  await page.getByRole("button", { name: "Compute" }).click();
  await expect(page.getByText(/Blocking issues \(1\)/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit for approval" })).toBeDisabled();
  // Rule codes are not shown as text; each issue carries its code for support (and these tests).
  const blocking = page.locator('li[data-code="HOURS_MISSING"]');
  await blocking.getByRole("button").first().click();

  // The drawer shows the working; add the hours there.
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Items in this run")).toBeVisible();
  await drawer.getByRole("button", { name: "Add item" }).click();
  await drawer.getByRole("combobox", { name: "Item" }).click();
  await page.getByRole("option", { name: "Hours worked" }).click();
  await drawer.getByLabel("Hours").fill("80");
  await drawer.getByRole("button", { name: "Add item" }).click();
  await expect(drawer.getByText("80 h", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Recompute" }).click();
  await expect(page.getByText(/Blocking issues/)).toHaveCount(0);

  // Keyboard review: focus the first row, open it, step to the next employee.
  const firstRow = page.getByRole("table", { name: "Pay per employee" }).locator("tbody tr").first();
  await firstRow.focus();
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").getByText("Rules used")).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("link", { name: /cpf\.gov\.sg/ })
      .first(),
  ).toBeVisible();
  const before = await page.getByRole("dialog").getByRole("heading").first().textContent();
  await page.keyboard.press("]");
  await expect(page.getByRole("dialog").getByRole("heading").first()).not.toHaveText(before ?? "");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("In review").first()).toBeVisible();
  const url = page.url();

  // The owner approves and releases payslips.
  await as(page, "owner", new URL(url).pathname);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved").first()).toBeVisible();
  await page.getByRole("button", { name: "Release payslips" }).click();
  await expect(page.getByText("Payslips released").first()).toBeVisible();

  // The employee sees and downloads the payslip.
  await as(page, "employee", "/me/payslips");
  await expect(page.getByRole("heading", { level: 1, name: "Payslips" })).toBeVisible();
  await page.getByRole("link", { name: "Payslip, November 2026", exact: true }).click();
  await expect(page.getByRole("article", { name: "Payslip, November 2026" })).toBeVisible();
  await expect(page.getByText("Net pay", { exact: true })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "PDF" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^payslip-2026-11-E\d{4}\.pdf$/);
  const path = await download.path();
  expect(readFileSync(path).subarray(0, 5).toString()).toBe("%PDF-");

  // Employees cannot open payroll runs.
  await page.goto("/payroll");
  await expect(page).toHaveURL(/\/me\/payslips$/);
});

test("blocking issues link to their fix: allowance treatment, holiday pay, hours; an approved run returns to draft", async ({
  page,
}) => {
  await as(page, "payroll", "/payroll");
  // Chloe moves to an hourly rate from February 2027 (the API call behind People → Change pay).
  const people = (await (await page.request.get("/api/v1/employees?q=Chloe")).json()) as { items: { id: string }[] };
  const chloe = people.items[0]?.id as string;
  const change = await page.request.post(`/api/v1/employees/${chloe}/events`, {
    data: {
      type: "salary_change",
      effectiveDate: "2027-02-01",
      compensation: { payBasis: "hourly", amountCents: 2_000, reason: "Moves to part-time hours" },
    },
  });
  expect(change.ok(), await change.text()).toBe(true);

  // February 2027: Chinese New Year falls on Saturday 6 Feb, an off day on the office schedule.
  await page.getByRole("button", { name: "New run" }).first().click();
  await page.getByRole("dialog").getByLabel("Month", { exact: true }).fill("2027-02");
  await page.getByRole("dialog").getByRole("button", { name: "Create run" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("February 2027 payroll");
  await page.getByRole("button", { name: "Compute" }).click();
  // Chloe's holiday pay and hours, and the part-timer's hours.
  await expect(page.getByText(/Blocking issues \(3\)/)).toBeVisible();

  // The run asks how the shift allowance counts, and links to the place that sets it.
  const ask = page.locator('li[data-code="ALLOWANCE_GROSS_RATE_UNSET"]');
  await expect(ask).toContainText("Shift allowance");
  await ask.getByRole("link", { name: "Classify allowances" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Allowance treatment" })).toBeVisible();
  await expect(page).toHaveURL(/highlight=SHIFT/);
  const shift = page.getByRole("listitem", { name: "Shift allowance (SHIFT)" });
  await shift.getByRole("combobox", { name: "Shift allowance (SHIFT): Gross rate of pay" }).click();
  await page.getByRole("option", { name: "Included" }).click();
  await shift.getByRole("button", { name: "Save Shift allowance" }).click();
  await expect(page.getByText("Shift allowance saved")).toBeVisible();
  await page.goBack();

  // Holiday pay for an hourly employee: the fix opens her drawer with the holiday filled in.
  const holiday = page.locator('li[data-code="PH_GROSS_RATE_REQUIRED"]');
  await expect(holiday).toContainText("6 Feb 2027");
  await holiday.getByRole("button", { name: "Enter holiday pay" }).click();
  const drawer = page.getByRole("dialog");
  const form = drawer.getByRole("form", { name: "Holiday pay: Chinese New Year, 6 Feb 2027" });
  await expect(form).toBeVisible();
  await form.getByLabel("Day's gross pay").fill("160");
  await form.getByRole("button", { name: "Add item" }).click();
  await expect(drawer.getByText("holiday 6 Feb 2027")).toBeVisible();
  // Her hours: the other blocking issue, fixed from the drawer's issue list.
  await drawer.getByRole("button", { name: "Add hours worked" }).click();
  await drawer.getByLabel("Hours", { exact: true }).fill("150");
  await drawer.getByRole("button", { name: "Add item" }).click();
  await expect(drawer.getByText("150 h", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  // The part-timer's hours, straight from the run's issue list.
  await page
    .locator('li[data-code="HOURS_MISSING"]')
    .filter({ hasText: "Ong Hui Min" })
    .getByRole("button", { name: "Add hours worked" })
    .click();
  await drawer.getByLabel("Hours", { exact: true }).fill("90");
  await drawer.getByRole("button", { name: "Add item" }).click();
  await expect(drawer.getByText("90 h", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Recompute" }).click();
  await expect(page.getByText(/Blocking issues/)).toHaveCount(0);
  await expect(page.locator('li[data-code="ALLOWANCE_GROSS_RATE_UNSET"]')).toHaveCount(0);

  // Submit, approve as the owner, then return the approved run to draft with a reason.
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("In review").first()).toBeVisible();
  const path = new URL(page.url()).pathname;
  await as(page, "owner", path);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved").first()).toBeVisible();
  await as(page, "payroll", path);
  await page.getByRole("button", { name: "Return to draft" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("new bank account");
  await expect(dialog.getByRole("button", { name: "Return to draft" })).toBeDisabled();
  await dialog.getByLabel("Reason (kept in the audit log)").fill("Chloe's new bank account");
  await dialog.getByRole("button", { name: "Return to draft" }).click();
  await expect(page.getByText("Returned to draft: Chloe's new bank account")).toBeVisible();
  await expect(page.getByRole("button", { name: "Recompute" })).toBeVisible();
});

test("year end: a benefit-in-kind and a share gain flow into the IR8A totals and the appendix sheets", async ({
  page,
}) => {
  await as(page, "payroll", "/payroll");
  const ir8a = page.getByTestId("payroll-ir8a");
  await ir8a.getByRole("link", { name: /Benefits and share gains/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Year end 2026" })).toBeVisible();
  await expect(page.getByText("No benefits-in-kind recorded for 2026")).toBeVisible();

  // Appendix 8A item 4a: home leave passages, an amount HR enters.
  await page.getByRole("button", { name: "Add benefit" }).first().click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Employee" }).click();
  await page.getByRole("option", { name: /Goh Jun Jie/ }).click();
  await dialog.getByRole("combobox", { name: "Benefit" }).click();
  await page.getByRole("option", { name: "Other benefit" }).click();
  await dialog.getByLabel("Cost to the employer").fill("3000");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByTestId("appendix-computed")).toContainText("Appendix 8A · item 4a");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("table", { name: "Appendix 8A benefits-in-kind" })).toContainText("3,000.00");

  // Appendix 8B: an ESOP exercised in June, (2.75 − 1.50) × 1,000 = 1,250.00 under S10(1)(b).
  await page.getByRole("button", { name: "Add share gain" }).first().click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Employee" }).click();
  await page.getByRole("option", { name: /Goh Jun Jie/ }).click();
  await pickDate(page, "Granted on", "2024-03-01", dialog);
  await pickDate(page, "Gain accrued on", "2026-06-01", dialog);
  await dialog.getByLabel("Number of shares").fill("1000");
  await dialog.getByLabel("Price paid per share (S$)").fill("1.50");
  await dialog.getByLabel("Open market value per share (S$)").fill("2.75");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const computed = dialog.getByTestId("appendix-computed");
  await expect(computed).toContainText("S10(1)(b), IR8A d7(a)");
  await expect(computed).toContainText("1,250.00");
  await dialog.getByRole("button", { name: "Done" }).click();

  const totals = page.getByRole("table", { name: "IR8A totals per employee" });
  await expect(totals.getByRole("row", { name: /Goh Jun Jie/ })).toContainText("3,000");
  await expect(totals.getByRole("row", { name: /Goh Jun Jie/ })).toContainText("1,250");

  // The IR8A panel offers this part's appendix sheets.
  await page.getByRole("link", { name: "Payroll" }).first().click();
  const [sheet] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("payroll-ir8a").getByRole("button", { name: "8B", exact: true }).click(),
  ]);
  expect(sheet.suggestedFilename()).toBe("ir8a-2026-part1-of-1-appendix-8b.csv");
  const csv = readFileSync(await sheet.path(), "utf8");
  expect(csv).toContain("*ID Type [Choose option],*ID No.,*Record ID");
  expect(csv).toContain(",ESOP,2024-03-01,2026-06-01,1.5,2.75,1000,");
});

test("payroll explains missing hours and shows dated hours from a subsequently approved timesheet", async ({
  page,
}) => {
  await as(page, "payroll", "/payroll");
  const api = "/api/v1";
  const { october } = (await (await page.request.get("/__dev/runs")).json()) as { october: string };
  const payroll = `/payroll/runs/${october}`;
  const { items: people } = (await (await page.request.get(`${api}/employees?q=Rajesh`)).json()) as {
    items: { id: string }[];
  };
  const employeeId = people[0]?.id;
  expect(employeeId).toBeTruthy();
  const change = await page.request.post(`${api}/employees/${employeeId}/events`, {
    data: {
      type: "salary_change",
      effectiveDate: "2026-10-01",
      compensation: { payBasis: "hourly", amountCents: 2_000, reason: "Moves to hourly pay" },
    },
  });
  expect(change.ok(), await change.text()).toBe(true);

  const settings = await page.request.get(`${api}/attendance/settings`);
  expect(settings.ok()).toBe(true);
  const { effectivePdpaNotice: _notice, ...attendance } = (await settings.json()) as Record<string, unknown>;
  const enabled = await page.request.put(`${api}/attendance/settings`, {
    data: {
      ...attendance,
      timesheets: { approval: true, period: "monthly", submittedBy: "manager", payrollApprovedOnly: true },
    },
  });
  expect(enabled.ok(), await enabled.text()).toBe(true);
  await page.goto(payroll);
  await page.getByRole("button", { name: "Recompute", exact: true }).click();
  const missing = page.locator('li[data-code="HOURS_MISSING"]').filter({ hasText: "Rajesh" });
  await expect(missing).toContainText("No approved timesheet covers this date");
  await missing.getByRole("button", { name: "Add hours worked" }).click();
  await expect(page.getByRole("dialog")).toContainText("Manual hours replace all timesheet hours");
  await page.keyboard.press("Escape");

  for (const [kind, time] of [
    ["in", "09:00"],
    ["out", "13:00"],
  ] as const) {
    const correction = await page.request.post(`${api}/attendance/corrections`, {
      data: { employeeId, kind, time: `2026-10-05T${time}:00+08:00`, reason: "Migrated attendance records" },
    });
    expect(correction.ok(), await correction.text()).toBe(true);
  }
  const submitted = await page.request.post(`${api}/attendance/timesheets`, {
    data: { employeeId, date: "2026-10-01" },
  });
  expect(submitted.ok(), await submitted.text()).toBe(true);
  const { timesheet } = (await submitted.json()) as { timesheet: { approvalRequestId: string } };
  await as(page, "owner", "/inbox");
  const { items: tasks } = (await (await page.request.get(`${api}/approvals/tasks`)).json()) as {
    items: { taskId: string; requestId: string }[];
  };
  const task = tasks.find((t) => t.requestId === timesheet.approvalRequestId);
  expect(task).toBeTruthy();
  const approved = await page.request.post(`${api}/approvals/tasks/${task?.taskId}/decision`, {
    data: { decision: "approve" },
  });
  expect(approved.ok(), await approved.text()).toBe(true);

  await as(page, "payroll", payroll);
  await page.getByRole("button", { name: "Recompute", exact: true }).click();
  await expect(missing).toHaveCount(0);
  await page
    .getByRole("table", { name: "Pay per employee" })
    .getByRole("row", { name: /Rajesh/ })
    .click();
  const hours = page
    .getByRole("dialog")
    .getByRole("listitem")
    .filter({ hasText: "Regular hours from approved timesheet" });
  await expect(hours).toContainText("Attendance");
  await expect(hours).toContainText("5 Oct 2026");
  await expect(hours).toContainText("4 h");
});

test("payroll can create, assign, change, and end a recurring allowance from the web", async ({ page }) => {
  test.setTimeout(60_000);
  await as(page, "payroll", "/payroll/allowances");
  await page.getByRole("button", { name: "Add allowance type" }).click();
  const typeDialog = page.getByRole("dialog", { name: "Add allowance type" });
  await typeDialog.getByRole("textbox", { name: "Name", exact: true }).fill("Pilot transport");
  await typeDialog.getByRole("textbox", { name: "Code", exact: true }).fill("PILOTTRANSPORT");
  await checkAllowanceAccessibility(page, '[role="dialog"]');
  await typeDialog.getByRole("button", { name: "Create type" }).click();
  await expect(page.getByRole("listitem", { name: "Pilot transport (PILOTTRANSPORT)" })).toBeVisible();

  await page.goto("/people/new");
  await page.getByLabel("Legal name").fill("Lau Yuen");
  await page.getByLabel("NRIC").fill("S9317602B");
  await pickDate(page, "Date of birth", "1997-05-14", page.locator("main"));
  await page.getByLabel("Job title").fill("Barista");
  await page.getByRole("combobox", { name: "Department" }).click();
  await page.getByRole("option", { name: "Operations" }).click();
  await page.getByLabel("Basic monthly pay").fill("4000.00");
  await page.getByRole("button", { name: "Add recurring allowance" }).click();
  await page.getByRole("combobox", { name: "Allowance type" }).click();
  await page.getByRole("option", { name: "Pilot transport (PILOTTRANSPORT)" }).click();
  await page.getByLabel("Monthly amount").fill("100.00");
  await checkAllowanceAccessibility(page, "main fieldset fieldset");
  await page.getByRole("button", { name: "Add employee" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lau Yuen" })).toBeVisible();
  await page.getByRole("tab", { name: "Pay" }).click();
  const rows = page.getByRole("table", { name: "Recurring allowances" });
  await expect(rows.getByRole("row", { name: /Pilot transport/ })).toContainText("S$100.00");

  const [year, month] = todaySg().split("-").map(Number) as [number, number];
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const monthAfter = new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 10);
  const openAllowance = async () => {
    await page.getByRole("button", { name: "Change allowance" }).click();
    return page.getByRole("dialog", { name: "Change recurring allowance" });
  };
  const chooseAllowance = async () => {
    await page.getByRole("combobox", { name: "Allowance type" }).click();
    await page.getByRole("option", { name: "Pilot transport (PILOTTRANSPORT)" }).click();
  };

  const change = await openAllowance();
  await pickDate(page, "Effective from", addDays(nextMonth, 13), change);
  await chooseAllowance();
  await change.getByLabel("Monthly amount").fill("150.00");
  await checkAllowanceAccessibility(page, '[role="dialog"]');
  await change.getByRole("button", { name: "Save allowance" }).click();
  await expect(change.getByText(/Use the first day of a month/)).toBeVisible();
  await pickDate(page, "Effective from", nextMonth, change);
  await change.getByRole("button", { name: "Save allowance" }).click();
  await expect(change).toBeHidden();
  await expect(rows.getByRole("row", { name: /Pilot transport.*S\$150\.00/ })).toBeVisible();

  const end = await openAllowance();
  await pickDate(page, "Effective from", monthAfter, end);
  await chooseAllowance();
  await end.getByRole("combobox", { name: "Change" }).click();
  await page.getByRole("option", { name: "End allowance" }).click();
  await end.getByRole("button", { name: "Save allowance" }).click();
  await expect(end).toBeHidden();
  await expect(rows.getByRole("row", { name: /Pilot transport.*S\$150\.00/ })).not.toContainText("Ongoing");
  await expect(page.getByRole("table", { name: "Pay history" }).getByRole("row")).toHaveCount(2);

  await page.getByRole("tab", { name: "History" }).click();
  const endEvent = page.getByRole("listitem").filter({ hasText: "allowance ends" });
  await endEvent.getByRole("button", { name: "Cancel" }).click();
  await expect(endEvent.getByText("Cancelled", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Pay" }).click();
  await expect(rows.getByRole("row", { name: /Pilot transport.*S\$150\.00/ })).toContainText("Ongoing");
});
