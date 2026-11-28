import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { apiSignIn, E2E } from "./fixtures.ts";

test("staff reach troubleshooting on mobile without owner controls", async ({ page }) => {
  await apiSignIn(page.request, E2E.members.requester.email);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Help", exact: true }).click();
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Help", exact: true })).toBeVisible();
  await main.getByRole("link", { name: "Payroll and payslips" }).click();
  await expect(main.getByRole("link", { name: "My payslips" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Open payroll runs" })).toHaveCount(0);
  await main.getByRole("link", { name: "Server, backups and errors" }).click();
  await expect(main.getByRole("heading", { name: "Share a technical summary" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Draft support email" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: "System status" })).toHaveCount(0);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator("html")).toHaveClass(scheme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
    const { violations } = await new AxeBuilder({ page })
      .include("main")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  }
});

test("owners go from an error to a safe summary and editable email draft", async ({ page }) => {
  await apiSignIn(page.request, E2E.members.owner.email);
  const reference = "1b9b6af7-7c2a-4b51-b6c4-1d60134aecb1";
  await page.route("**/api/v1/reports", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: "service_unavailable", message: "Report unavailable", requestId: reference } },
    }),
  );
  await page.goto("/reports");
  await page.getByRole("link", { name: "Help with this error" }).click();
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Server, backups and errors" })).toBeVisible();
  await expect(main.getByText("Database reachable", { exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "System status" })).toBeVisible();
  const mailto = new URL((await main.getByRole("link", { name: "Draft support email" }).getAttribute("href")) ?? "");
  expect(mailto.pathname).toBe("hello@crowhr.com");
  expect(mailto.searchParams.get("subject")).toBe("[Crow HR] Support");
  const body = mailto.searchParams.get("body");
  expect(body).toContain(reference);
  expect(body).toContain("Database reachable");
  expect(body).not.toContain(E2E.members.owner.email);
  expect(body).not.toContain("http://");
});

test("sign-in has a public recovery guide", async ({ page }) => {
  await page.goto(`/sign-in/${E2E.org.slug}`);
  await expect(page.getByRole("link", { name: "Help signing in" })).toHaveAttribute("href", /#signing-in$/);
});
