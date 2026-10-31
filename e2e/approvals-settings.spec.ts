import { type Browser, expect, type Page, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";

test.use({ viewport: { width: 1440, height: 900 } });

async function signedIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await uiSignInOk(page, email);
  return page;
}

test("Settings → Approvals: defaults shown, claims get an amount threshold", async ({ browser }) => {
  const hr = await signedIn(browser, E2E.members.hr.email);
  await hr.goto("/settings/approvals");
  const leave = hr.getByTestId("chain-leave");
  await expect(leave).toContainText("Manager");
  await expect(leave).toContainText("HR admin");
  await expect(leave).toContainText("Escalates after 3 days");
  await expect(hr.getByTestId("chain-payroll_run")).toContainText("Only an owner can change this");

  await hr.getByRole("button", { name: "Edit Claims approvals" }).click();
  const dialog = hr.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Who approves claims?" })).toBeVisible();
  await dialog.getByRole("button", { name: "Add a rule for larger amounts" }).click();
  const amount = dialog.getByLabel("Amount threshold");
  await amount.fill("500");
  await amount.blur();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  const claims = hr.getByTestId("chain-claim");
  await expect(claims).toContainText("S$500.00 or more:");
  await expect(claims).toContainText("Owner");
  await hr.context().close();
});

test("out-of-office cover and an escalated task", async ({ browser }) => {
  const manager = await signedIn(browser, E2E.members.approver.email);
  await manager.goto("/inbox");
  await manager.getByRole("button", { name: "Out of office" }).click();
  const dialog = manager.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Who covers" }).click();
  await manager.getByRole("option", { name: E2E.members.shots.name }).click();
  await dialog.getByRole("button", { name: "Last day away" }).click();
  // First day defaults to today; make today the last day too (react-day-picker marks it data-today).
  await manager.locator('[data-today="true"] button').click();
  await dialog.getByRole("button", { name: "Set cover" }).click();
  await expect(dialog.getByRole("list", { name: "Current cover" })).toContainText(E2E.members.shots.name);
  await dialog.getByRole("button", { name: "Close" }).first().click();
  await manager.context().close();

  // Farah's seeded change waited 5 days for Kai Wen: the server's first sweep escalated it to HR.
  const hr = await signedIn(browser, E2E.members.hr.email);
  await hr.goto("/inbox");
  const task = hr.getByTestId("inbox-task").filter({ hasText: E2E.members.shots.name });
  await expect(task).toContainText("Escalated");
  await task.getByRole("button").click();
  await expect(hr.getByTestId("request-panel")).toContainText("Escalated");
  await hr.context().close();
});
