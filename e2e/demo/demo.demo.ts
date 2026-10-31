import { expect, test } from "@playwright/test";
import { go, pickPersona, signOut, waitForDemo, watchErrors } from "./helpers.ts";

/**
 * The public demo end to end, with no backend: load → payroll admin opens October's draft run and
 * an employee's CPF working → the manager approves a claim in the Inbox → Reset brings the seed
 * back (the approved claim is waiting again).
 */
test("load, payroll draft and CPF working, manager approves a claim, reset re-seeds", async ({ page }) => {
  const errors = watchErrors(page);

  // 1. First visit: the loader, then the sign-in page with personas and disabled SSO.
  await page.goto("/");
  const boot = await waitForDemo(page);
  expect(boot.timings.seeded).toBe(true);
  console.warn(
    `first load: navigation to app ${boot.readyMs} ms (worker ${boot.timings.totalMs} ms)`,
    JSON.stringify(boot.timings.stages),
  );
  await expect(page).toHaveURL(/\/sign-in\/kopi-kaki$/);
  await expect(page.getByTestId("demo-banner")).toContainText("runs entirely in your browser");
  await expect(page.getByTestId("sso-methods")).toContainText(
    "Not available in the demo. Self-hosted installs can enable this in Settings → Security.",
  );
  await expect(page.getByTestId("sso-methods").getByRole("button").first()).toBeDisabled();

  // 2. Payroll admin: October's draft run, with warnings, and one employee's CPF working.
  await pickPersona(page, "payroll-admin");
  await go(page, "/payroll");
  await expect(page.getByRole("heading", { level: 1, name: "Payroll" })).toBeVisible();
  await page
    .getByRole("link", { name: /October 2026/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("October 2026 payroll");
  await expect(page.getByText("Draft").first()).toBeVisible();
  await expect(page.getByText(/warning/i).first()).toBeVisible();
  const rows = page.getByRole("table", { name: "Pay per employee" }).locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  await rows.filter({ hasText: "Goh Jun Jie" }).first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Rules used")).toBeVisible();
  await expect(drawer.getByText(/CPF/).first()).toBeVisible();
  await expect(drawer.getByRole("link", { name: /cpf\.gov\.sg/ }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await signOut(page);

  // 3. Manager: approve Maria's taxi claim from the Inbox.
  await pickPersona(page, "manager");
  await go(page, "/inbox");
  const task = page.getByTestId("inbox-task").filter({ hasText: "Maria" }).filter({ hasText: /claim/i });
  await expect(task).toHaveCount(1);
  await task.getByRole("button").first().click();
  const panel = page.getByTestId("request-panel");
  await expect(panel).toContainText("S$21.50");
  // The receipt image is an <img src="/api/…">: the service worker hands it to the in-browser API.
  await panel.getByTestId("request-subject-link").click();
  await page.getByRole("button", { name: /View receipt comfortdelgro/i }).click();
  const receipt = page.getByTestId("receipt-viewer").getByRole("img", { name: /Receipt comfortdelgro/i });
  await expect(receipt).toBeVisible();
  await expect.poll(() => receipt.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(120);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Inbox" }).first().click();
  await task.getByRole("button").first().click();
  await expect(panel).toContainText("S$21.50");
  await panel.getByRole("button", { name: "Approve" }).click();
  await expect(task).toHaveCount(0);

  // 4. Reset: back to the seeded company, the claim is waiting again.
  await page.getByTestId("demo-reset").click();
  await page.getByTestId("demo-reset-confirm").click();
  await expect(page).toHaveURL(/\/sign-in/, { timeout: 60_000 });
  const again = await waitForDemo(page);
  expect(again.timings.seeded).toBe(false); // reset re-seeded in the worker before the reload
  await pickPersona(page, "manager");
  await go(page, "/inbox");
  await expect(page.getByTestId("inbox-task").filter({ hasText: "Maria" }).filter({ hasText: /claim/i })).toHaveCount(
    1,
  );

  expect(errors).toEqual([]);
});
