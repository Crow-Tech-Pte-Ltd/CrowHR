import { expect, type Page, test } from "@playwright/test";

/**
 * People e2e (tasks 7.1–7.4). Runs against the DEV-ONLY people server with
 * persona sign-in (see playwright.people.config.ts). The seeded org is the
 * fictional Kopi Kaki Pte. Ltd.; "today" is the real date.
 */

async function as(page: Page, persona: string, to: string) {
  await page.goto(`/__dev/as/${persona}?to=${encodeURIComponent(to)}`);
}

/** Valid NRIC for a 7-digit number (public check-letter algorithm). */
function nric(digits: string): string {
  const w = [2, 7, 6, 5, 4, 3, 2];
  const sum = [...digits].reduce((s, d, i) => s + Number(d) * (w[i] as number), 0);
  return `S${digits}${"JZIHGFEDCBA"[sum % 11]}`;
}

const isoPlusDays = (days: number) =>
  new Date(Date.now() + 8 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);

test("add an employee, see NRIC masked, schedule a transfer and record a resignation", async ({ page }) => {
  await as(page, "hr", "/people/new");
  await expect(page.getByRole("heading", { name: "Add employee" })).toBeVisible();
  await page.getByLabel("Legal name").fill("Chua Li Ting");
  await page.getByLabel("NRIC").fill("S1234567A");
  // A 14-year-old on the start date: the form says what the Employment Act allows.
  await page.getByLabel("Date of birth").fill(`${Number(isoPlusDays(0).slice(0, 4)) - 14}-01-01`);
  const young = page.getByTestId("age-conditions");
  await expect(young).toContainText("Under 16 on the start date");
  await expect(young).toContainText("light duties");
  await page.getByLabel("Date of birth").fill("1997-05-14");
  await expect(young).toHaveCount(0);
  await page.getByLabel("Job title").fill("Barista");
  await page.getByRole("combobox", { name: "Department" }).click();
  await page.getByRole("option", { name: "Operations" }).click();
  await page.getByRole("button", { name: "Add employee" }).click();
  // Wrong check letter: the server's message is shown on the field.
  await expect(
    page.getByText("This NRIC's check letter does not match. Check the last letter against the card."),
  ).toBeVisible();
  const id = nric("8123456");
  await page.getByLabel("NRIC").fill(id);
  await page.getByRole("button", { name: "Add employee" }).click();

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Chua Li Ting");
  await expect(page.getByText(`S****${id.slice(-4)}`)).toBeVisible();
  await expect(page.locator("body")).not.toContainText(id);

  for (const tab of ["Job", "Pay", "Documents", "History", "Overview"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("data-state", "active");
  }

  // Future-dated transfer → Scheduled.
  await page.getByRole("button", { name: "Record change" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Effective from").fill(isoPlusDays(30));
  await dialog.getByLabel("Job title").fill("Senior Barista");
  await dialog.getByRole("button", { name: "Save change" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText("Transfer", { exact: true })).toBeVisible();
  await expect(page.getByText("Scheduled").first()).toBeVisible();

  // Resignation → "Leaving <date>".
  await page.getByRole("button", { name: "Record leaving" }).click();
  const leave = page.getByRole("dialog");
  await leave.getByLabel("Notice period (days)").fill("60");
  await leave.getByRole("button", { name: "Save" }).click();
  // A transfer is scheduled before the last day, so this succeeds.
  await expect(leave).toBeHidden();
  // The status sits beside the name, outside the heading (the page title is just the name).
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chua Li Ting");
  await expect(page.locator("main header").first()).toContainText("Leaving");
});

test("edit compensation with an effective date", async ({ page }) => {
  await as(page, "hr", "/people");
  await page.getByRole("link", { name: "Chloe de Souza" }).first().click();
  await page.getByRole("tab", { name: "Pay" }).click();
  await expect(page.getByText("S$3,400.00").first()).toBeVisible();
  await page.getByRole("button", { name: "Change pay" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("New amount").fill("3,650.00");
  await dialog.getByLabel("Effective from").fill(isoPlusDays(45));
  await dialog.getByLabel("Reason").fill("Promotion to Accounts Executive");
  await dialog.getByRole("button", { name: "Save pay" }).click();
  await expect(dialog).toBeHidden();
  const history = page.getByRole("table", { name: "Pay history" });
  await expect(history).toContainText("S$3,650.00");
  await expect(history).toContainText("Promotion to Accounts Executive");
  await expect(page.getByText("Scheduled").first()).toBeVisible();
  // Current pay is unchanged until the date.
  await expect(page.getByText("S$3,400.00").first()).toBeVisible();
});

test("hr_admin without payroll cannot see pay", async ({ page }) => {
  await as(page, "hronly", "/people");
  await page.getByRole("link", { name: "Chloe de Souza" }).first().click();
  await page.getByRole("tab", { name: "Pay" }).click();
  await expect(page.getByText("Your role can't see pay")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("S$3,400.00");
});

test("import a CSV: two errors, fix, re-upload, confirm", async ({ page }) => {
  await as(page, "hr", "/people/import");
  const head =
    "legal_name,id_type,id_number,date_of_birth,residency_status,hire_date,job_title,department,employment_type";
  const good = (name: string, digits: string) =>
    `${name},nric,${nric(digits)},14/02/1999,citizen,${isoPlusDays(10)},Service Crew,Operations,part_time`;
  const bad = [
    head,
    good("Low Jun Hao", "8200001"),
    `Pang Mei Yi,nric,S1234567A,1998-01-01,citizen,${isoPlusDays(10)},Service Crew,Operations,part_time`,
    `Ravi Kumar,nric,${nric("8200003")},1996-07-07,citizen,${isoPlusDays(10)},Service Crew,Operashuns,part_time`,
  ].join("\n");
  await page
    .locator("#import-file")
    .setInputFiles({ name: "crew.csv", mimeType: "text/csv", buffer: Buffer.from(bad) });
  const problems = page.getByRole("table", { name: "Problems in the file" });
  await expect(problems).toBeVisible();
  await expect(problems.getByRole("row")).toHaveCount(3);
  await expect(problems).toContainText('The closest is "Operations"');
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeDisabled();

  await page.getByRole("button", { name: "Upload a fixed file" }).click();
  const fixed = [
    head,
    good("Low Jun Hao", "8200001"),
    good("Pang Mei Yi", "8200002"),
    good("Ravi Kumar", "8200003"),
  ].join("\n");
  await page
    .locator("#import-file")
    .setInputFiles({ name: "crew.csv", mimeType: "text/csv", buffer: Buffer.from(fixed) });
  await expect(page.getByText("3 of 3 rows ready")).toBeVisible();
  await page.getByRole("button", { name: "Import 3 rows" }).click();
  await expect(page.getByText("Imported 3 rows")).toBeVisible();
  await page.getByRole("link", { name: "Go to People" }).click();
  await expect(page.getByRole("table", { name: "People" })).toContainText("Ravi Kumar");
});

test("company profile shows the UEN formats on a bad UEN", async ({ page }) => {
  await as(page, "hr", "/settings/company");
  await page.getByLabel("UEN").fill("12345");
  await page.getByRole("button", { name: "Save company profile" }).click();
  await expect(page.getByText(/three ACRA formats/)).toBeVisible();
  await page.getByLabel("UEN").fill("201912345K");
  await page.getByRole("button", { name: "Save company profile" }).click();
  await expect(page.getByText("Company profile saved")).toBeVisible();
});

test("self-service: edit mobile directly; bank change awaits approval", async ({ page }) => {
  await as(page, "employee", "/me/profile");
  await page.getByRole("button", { name: "Edit contact details" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Mobile").fill("8765 4321");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("+6587654321")).toBeVisible();
  await page.getByRole("button", { name: "Request a change" }).nth(1).click();
  const req = page.getByRole("dialog");
  await req.getByRole("combobox", { name: "Bank" }).click();
  await page.getByRole("option", { name: "OCBC Bank" }).click();
  await req.getByLabel("Account number").fill("501234567");
  await req.getByLabel("Account holder name").fill("Goh Jun Jie");
  await req.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText("Awaiting payroll approval")).toBeVisible();
  // Current account still shown until payroll approves.
  await expect(page.getByText("DBS Bank")).toBeVisible();
});

test("⌘K finds a person", async ({ page }) => {
  await as(page, "hr", "/people");
  await expect(page.getByRole("table", { name: "People" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Okafor");
  // People results come from the server; Enter picks what is listed at that moment.
  await expect(page.getByRole("option", { name: /Daniel Okafor/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Daniel Okafor");
});
