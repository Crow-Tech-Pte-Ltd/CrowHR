import { expect, type Page, test } from "@playwright/test";

/**
 * Documents (WS6b): HR generates the KETs for a new hire, the employee opens and acknowledges them,
 * and they appear in the employee's documents as acknowledged.
 */
async function as(page: Page, persona: string, to: string) {
  await page.goto(`/__dev/as/${persona}?to=${encodeURIComponent(to)}`);
}

test("generate a KET for a new hire; the employee acknowledges it", async ({ page, context }) => {
  const employees = (await (await page.request.get("/__dev/employees")).json()) as Record<string, string>;
  const newhire = employees.newhire as string;

  // HR + payroll admin (salary fields need payroll access) opens the new hire's Documents tab.
  await as(page, "payroll", `/people/${newhire}?tab=documents`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Lee Mei Xin");
  await page.getByTestId("open-generate").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Generate a letter")).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Template" })).toContainText("Key Employment Terms");
  // The preview shows values from the record; contract terms Crow HR doesn't hold are asked for.
  await expect(dialog.getByTestId("letter-preview")).toContainText("Lee Mei Xin");
  await expect(dialog.getByTestId("letter-preview")).toContainText("S$2,400.00 a month");
  const missing = dialog.getByTestId("missing-fields");
  await expect(missing).toBeVisible();
  const values: Record<string, string> = {
    "Main duties and responsibilities": "Prepare coffee and serve customers at the outlet.",
    "Fixed deductions": "None",
    "Overtime payment period": "Monthly, paid with the salary",
    "Overtime rate": "1.5 times the hourly basic rate",
    "Other salary components (bonus, incentives)": "Annual performance bonus at the company's discretion",
    "Medical benefits": "Outpatient GP visits up to S$300 a year",
    "Notice period": "1 week during probation, 1 month after",
    "Signatory job title": "HR Manager",
  };
  for (const [label, value] of Object.entries(values)) {
    const field = missing.getByLabel(label, { exact: true });
    if (await field.count()) await field.fill(value);
  }
  // Anything else still missing gets a generic value.
  for (const box of await missing.locator("textarea").all()) {
    if (!(await box.inputValue())) await box.fill("As agreed in the offer letter");
  }
  await missing.getByRole("button", { name: "Update preview" }).click();
  await expect(dialog.getByTestId("letter-preview")).toContainText("Prepare coffee and serve customers");
  await dialog.getByTestId("generate").click();
  await expect(page.getByText("Letter generated and sent for acknowledgement")).toBeVisible();
  const row = page.getByTestId("document-row").filter({ hasText: "Key Employment Terms" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("To acknowledge");

  // The employee sees it on Home and in My documents.
  await as(page, "newhire", "/");
  await expect(page.getByText(/Read and acknowledge: Key Employment Terms/)).toBeVisible();
  await page.goto("/documents");
  const card = page.getByTestId("to-acknowledge");
  await expect(card).toContainText("Key Employment Terms");
  await card.getByRole("button", { name: /Key Employment Terms/ }).click();
  const sheet = page.getByRole("dialog");
  const ack = sheet.getByTestId("acknowledge");
  await expect(ack).toBeDisabled();
  // Opening the PDF (a new tab) records the first view, which acknowledging requires.
  const [file] = await Promise.all([
    context.waitForEvent("response", (r) => r.url().includes(`/file`) && r.request().method() === "GET"),
    sheet.getByRole("link", { name: "Open" }).click(),
  ]);
  expect(file.status()).toBe(200);
  for (const p of context.pages()) if (p !== page) await p.close();
  await expect(ack).toBeEnabled();
  await ack.click();
  await expect(page.getByText("Acknowledged. Thank you.")).toBeVisible();
  await expect(sheet.getByTestId("ack-status")).toContainText("Acknowledged");
  await page.keyboard.press("Escape");
  const mine = page.getByTestId("document-row").filter({ hasText: "Key Employment Terms" });
  await expect(mine).toContainText("Acknowledged");
  await expect(page.getByTestId("to-acknowledge")).toHaveCount(0);

  // HR sees the completed acknowledgement.
  await as(page, "payroll", "/documents?tab=acknowledgements");
  await page.getByRole("button", { name: "Completed" }).click();
  await expect(page.getByRole("table", { name: "Acknowledgements" })).toContainText("Lee Mei Xin");
});
