import { expect, test } from "@playwright/test";
import { HOME_HEADING } from "./fixtures.ts";

test.describe("application shell", () => {
  test.use({ storageState: "test-results/owner.json" });

  test("loads Home with navigation and real (not sample) data", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: HOME_HEADING })).toBeVisible();
    await expect(page.getByTestId("home-approvals")).toBeVisible();
    await expect(page.getByTestId("sample-data-notice")).toHaveCount(0);
    const nav = page.getByRole("complementary", { name: "Main navigation" });
    for (const item of [
      "Home",
      "Inbox",
      "People",
      "Payroll",
      "Leave",
      "Attendance",
      "Schedules",
      "Claims",
      "Documents",
      "Reports",
      "Settings",
    ]) {
      await expect(nav.getByRole("link", { name: item, exact: true })).toBeVisible();
    }
    await expect(page.getByText("API connected")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("command palette jumps to Payroll", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("heading", { name: HOME_HEADING }).waitFor();
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await expect(palette).toBeVisible();
    await page.keyboard.type("payroll");
    await page.keyboard.press("Enter");
    await expect(palette).toBeHidden();
    await expect(page).toHaveURL(/\/payroll$/);
    await expect(page.getByRole("heading", { level: 1, name: "Payroll" })).toBeVisible();
  });

  for (const [route, heading] of [
    ["/", HOME_HEADING],
    ["/inbox", "Inbox"],
    ["/people", "People"],
    ["/payroll", "Payroll"],
    ["/leave", "Leave"],
    ["/attendance", "Attendance"],
    ["/schedules", "Schedules"],
    ["/claims", "Claims"],
    ["/documents", "Documents"],
    ["/reports", "Reports"],
    ["/settings", "Settings"],
  ] as const) {
    test(`${route} renders and survives a deep-link reload`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/");
      await page.getByRole("heading", { level: 1, name: HOME_HEADING }).waitFor();
      await page
        .getByRole("complementary", { name: "Main navigation" })
        .getByRole("link", { name: route === "/" ? "Home" : heading, exact: true })
        .click();
      await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
      await expect(page.getByTestId("module-empty-state")).toHaveCount(0);
      expect(new URL(page.url()).pathname).toBe(route === "/attendance" ? "/attendance/team" : route);
      expect(errors).toEqual([]);
    });
  }

  test("works at 360px without horizontal scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Claims" }).click();
    await expect(page).toHaveURL(/\/claims$/);
  });

  test("employee view shows a bottom tab bar on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?view=employee");
    const tabs = page.getByRole("navigation", { name: "Employee navigation" });
    await expect(tabs).toBeVisible();
    await tabs.getByRole("link", { name: "Leave" }).click();
    await expect(page).toHaveURL(/\/leave/);
  });

  test("keyboard focus is visible in the top bar", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("heading", { name: HOME_HEADING }).waitFor();
    // Skip link, then into the sidebar/top bar.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    const search = page.getByRole("button", { name: /Search people or jump to/ });
    await search.focus();
    const ring = await search.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(ring).not.toBe("none");
  });

  test("unknown API paths return the JSON error envelope", async ({ request }) => {
    const res = await request.get("/api/does-not-exist");
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});
