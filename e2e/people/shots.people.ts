import { expect, test } from "@playwright/test";

/** Screenshots for design review (desktop + 390px). Only runs when SHOTS_DIR is set. */
const DIR = process.env.SHOTS_DIR;

test.describe("people screenshots", () => {
  test.skip(!DIR, "set SHOTS_DIR to capture screenshots");

  for (const [suffix, size] of [
    ["desktop", { width: 1440, height: 900 }],
    ["390", { width: 390, height: 844 }],
  ] as const) {
    test(`capture ${suffix}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/__dev/as/hr?to=/people");
      await expect(page.getByRole("table", { name: "People" }).getByRole("row").nth(5)).toBeVisible();
      await page.screenshot({ path: `${DIR}/ws2-directory-${suffix}.png`, fullPage: true });

      await page.getByRole("link", { name: "Daniel Okafor" }).first().click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Daniel Okafor");
      await page.screenshot({ path: `${DIR}/ws2-profile-${suffix}.png`, fullPage: true });
      await page.getByRole("tab", { name: "Pay" }).click();
      await page.screenshot({ path: `${DIR}/ws2-profile-pay-${suffix}.png`, fullPage: true });
      await page.getByRole("tab", { name: "History" }).click();
      await page.screenshot({ path: `${DIR}/ws2-profile-history-${suffix}.png`, fullPage: true });

      await page.goto("/people/new");
      await expect(page.getByRole("heading", { name: "Add employee" })).toBeVisible();
      await page.screenshot({ path: `${DIR}/ws2-add-employee-${suffix}.png`, fullPage: true });

      await page.goto("/people/import");
      await page.screenshot({ path: `${DIR}/ws2-import-${suffix}.png`, fullPage: true });
      const csv = [
        "legal_name,id_type,id_number,date_of_birth,residency_status,hire_date,job_title,department,employment_type",
        "Lee Jia Wen,nric,S1234567A,1995-03-02,citizen,2026-11-02,Barista,Operations,full_time",
        "Wong Kai Xin,nric,S8765432C,02/30/1996,citizen,2026-11-02,Barista,Operashuns,full_time",
        "Hamid bin Salleh,nric,S7654321Z,1990-01-01,pr,2026-11-02,Cook,Operations,full_time",
      ].join("\n");
      await page
        .locator("#import-file")
        .setInputFiles({ name: "staff.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await expect(page.getByRole("table", { name: "Problems in the file" })).toBeVisible();
      await page.screenshot({ path: `${DIR}/ws2-import-preview-${suffix}.png`, fullPage: true });

      await page.goto("/settings/company");
      await expect(page.getByLabel("UEN")).toHaveValue("201912345K");
      await page.screenshot({ path: `${DIR}/ws2-company-${suffix}.png`, fullPage: true });
      await page.goto("/settings/structure?tab=schedules");
      await page.screenshot({ path: `${DIR}/ws2-structure-schedules-${suffix}.png`, fullPage: true });
      await page.goto("/settings/structure");
      await page.screenshot({ path: `${DIR}/ws2-structure-${suffix}.png`, fullPage: true });

      await page.goto("/__dev/as/employee?to=/me/profile");
      await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();
      await page.screenshot({ path: `${DIR}/ws2-me-profile-${suffix}.png`, fullPage: true });
    });
  }
});
