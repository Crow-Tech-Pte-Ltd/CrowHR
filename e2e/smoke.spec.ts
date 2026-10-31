import { expect, test } from "@playwright/test";

test.describe("application shell", () => {
  test("loads Home with navigation and a visible sample-data notice", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Work to do" })).toBeVisible();
    await expect(page.getByTestId("sample-data-notice")).toBeVisible();
    const nav = page.getByRole("complementary", { name: "Main navigation" });
    for (const item of [
      "Home",
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
    await page.getByRole("heading", { name: "Work to do" }).waitFor();
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await expect(palette).toBeVisible();
    await page.keyboard.type("payroll");
    await page.keyboard.press("Enter");
    await expect(palette).toBeHidden();
    await expect(page).toHaveURL(/\/payroll$/);
    await expect(page.getByRole("heading", { level: 1, name: "Payroll" })).toBeVisible();
  });

  test("unbuilt modules show an honest empty state, also on a deep-link reload", async ({ page }) => {
    await page.goto("/leave");
    const empty = page.getByTestId("module-empty-state");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("Leave is not available yet");
  });

  test("sign-in form sends nothing and says so", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/") && !r.url().endsWith("/api/health")) apiCalls.push(r.url());
    });
    await page.goto("/sign-in");
    await page.getByLabel("Work email").fill("aisyah@kampongkopi.example");
    await page.getByLabel("Password").fill("not-a-real-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByTestId("sign-in-notice")).toContainText("Sign-in isn't available yet");
    expect(apiCalls).toEqual([]);
  });

  test("sign-in renders only the enabled methods", async ({ page }) => {
    await page.goto("/sign-in?methods=password");
    await expect(page.getByTestId("sso-methods")).toHaveCount(0);
    await page.goto("/sign-in?methods=all");
    const sso = page.getByTestId("sso-methods");
    await expect(sso.getByRole("button")).toHaveCount(4);
    await expect(sso.getByRole("button", { name: "Log in with Sing-pass" })).toBeVisible();
  });

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
    await page.getByRole("heading", { name: "Work to do" }).waitFor();
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
