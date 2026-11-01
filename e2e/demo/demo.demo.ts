import { expect, test } from "@playwright/test";
import { go, pickPersona, signOut, waitForDemo, watchErrors } from "./helpers.ts";

/** Real demo: snapshot → attendance-fed payroll and reports → manager approvals → PDF acknowledgement → reset. */
test("snapshot, fed OT, reports, shift swap, acknowledgement and reset", async ({ page, context }) => {
  const errors = watchErrors(page);

  // 1. First visit: the loader, then the sign-in page with personas and disabled SSO.
  await page.goto("/");
  const boot = await waitForDemo(page);
  expect(boot.timings.seeded).toBe(true);
  expect(boot.timings.restored).toBe(true);
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
  await expect(drawer.getByText(/Overtime \(approved in attendance\)/).first()).toBeVisible();
  await expect(drawer.getByText("Rules used")).toBeVisible();
  await expect(drawer.getByText(/CPF/).first()).toBeVisible();
  await expect(drawer.getByRole("link", { name: /cpf\.gov\.sg/ }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await go(page, "/reports/payroll.cost?from=2026-07&to=2026-09");
  await expect(page.getByRole("heading", { level: 1, name: "Payroll cost" })).toBeVisible();
  await expect(page.getByRole("table").locator("tbody tr").first()).toBeVisible();
  await expect(page.getByText("Operations", { exact: true }).first()).toBeVisible();
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

  // Scheduling uses the same inbox and real workflow decisions.
  await go(page, "/inbox");
  const swap = page.getByTestId("inbox-task").filter({ hasText: /shift swap/i });
  await expect(swap).toHaveCount(1);
  await swap.getByText(/Shift swap,/).click();
  await expect(panel).toContainText("Hafiz");
  await panel.getByRole("button", { name: /^Approve/ }).click();
  await expect(swap).toHaveCount(0);
  await signOut(page);

  // The employee opens the generated PDF through the service worker, then acknowledges it.
  await pickPersona(page, "employee");
  await go(page, "/documents");
  await page.getByTestId("document-row").filter({ hasText: "Updated Key Employment Terms" }).click();
  const doc = page.getByRole("dialog");
  await expect(doc.getByTestId("acknowledge")).toBeDisabled();
  const [file] = await Promise.all([
    context.waitForEvent("response", (r) => r.url().includes("/file") && r.request().method() === "GET"),
    doc.getByRole("link", { name: "Open", exact: true }).click(),
  ]);
  expect(file.status()).toBe(200);
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const rows = await (await fetch("/api/v1/documents?mine=true")).json();
        return rows.items.find((d: { title: string }) => d.title.startsWith("Updated Key Employment Terms"))?.viewed;
      }),
    )
    .toBe(true);
  for (const other of context.pages()) if (other !== page) await other.close();
  await doc.getByTestId("acknowledge").click();
  await expect(doc.getByTestId("ack-status")).toContainText("Acknowledged");
  await page.keyboard.press("Escape");

  // 4. Reset: back to the seeded company, the claim is waiting again.
  await page.getByTestId("demo-reset").click();
  await page.getByTestId("demo-reset-confirm").click();
  await expect(page).toHaveURL(/\/sign-in/, { timeout: 60_000 });
  const again = await waitForDemo(page);
  expect(again.timings.seeded).toBe(true); // the reload restores a fresh snapshot in a new worker
  expect(again.timings.restored).toBe(true);
  await pickPersona(page, "manager");
  await go(page, "/inbox");
  await expect(page.getByTestId("inbox-task").filter({ hasText: "Maria" }).filter({ hasText: /claim/i })).toHaveCount(
    1,
  );

  expect(errors).toEqual([]);
});

// The fallback remains a working real demo, including after a malformed snapshot reaches PGlite.
for (const mode of ["missing", "corrupt"] as const) {
  test(`snapshot ${mode}: seeds in the browser and persists on reload`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    await page.route("**/assets/demo-*.tar.gz", (route) =>
      route.fulfill({
        status: mode === "missing" ? 404 : 200,
        contentType: "application/gzip",
        body: mode === "missing" ? "Missing" : "not a gzip database",
      }),
    );
    await page.goto("/");
    const boot = await waitForDemo(page, 120_000);
    expect(boot.timings.seeded).toBe(true);
    expect(boot.timings.restored).toBe(false);
    console.warn(`${mode} fallback: ${boot.readyMs} ms`, JSON.stringify(boot.timings.stages));
    await pickPersona(page, "employee");
    await expect(page.getByText("Updated Key Employment Terms", { exact: false }).first()).toBeVisible();
    const persisted = await go(page, "/documents");
    expect(persisted.timings.seeded).toBe(false);
    await expect(page.getByTestId("document-row").filter({ hasText: "Updated Key Employment Terms" })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
