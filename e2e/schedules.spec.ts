import { type Browser, expect, type Page, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";
import { addDays, mondayOf, todaySg } from "./leave-helpers.ts";

/**
 * Scheduling end to end (add-scheduling task 6.5): Kai Wen builds next week's roster for his
 * crew from the template palette and the keyboard, publishes it → Nurul sees it on her phone
 * (390 px) and asks Marcus to swap → Marcus accepts → Kai Wen approves in the Inbox → Nurul's
 * schedule shows Marcus's shift.
 */
async function signedIn(browser: Browser, email: string, width = 1440, height = 900): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await uiSignInOk(page, email);
  return page;
}

const shortDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${wd} ${d.getUTCDate()} ${mo}`;
};

test("build next week's roster → publish → employee sees it on mobile → swap → colleague accepts → manager approves", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const next = addDays(mondayOf(todaySg()), 7);
  const tue = addDays(next, 1);

  // 1. Kai Wen builds the week.
  const kaiWen = await signedIn(browser, E2E.members.approver.email);
  await kaiWen.goto(`/schedules?week=${next}`);
  const grid = kaiWen.getByTestId("week-grid");
  await expect(grid).toBeVisible();
  const nurulRow = grid.getByRole("row").filter({ hasText: E2E.members.crewA.name });
  const marcusRow = grid.getByRole("row").filter({ hasText: E2E.members.crewB.name });
  await expect(nurulRow).toBeVisible();
  await expect(kaiWen.getByTestId("roster-status")).toContainText("Draft");
  // Click to assign: pick "AM" in the palette, click Nurul's Monday.
  await kaiWen.getByRole("toolbar", { name: "Shift templates" }).getByRole("button", { name: /^AM/ }).click();
  await nurulRow.getByRole("cell").nth(0).click();
  await expect(nurulRow.getByTestId("shift-chip").first()).toContainText("07:00–15:00");
  await kaiWen.getByRole("button", { name: "Stop assigning" }).click();
  // Keyboard: focus Marcus's Tuesday and press 4 (the fourth template, Closing 15:00–23:00).
  const marcusTue = marcusRow.getByRole("cell").nth(1);
  await marcusTue.focus();
  await kaiWen.keyboard.press("4");
  await expect(marcusRow.getByTestId("shift-chip").first()).toContainText("15:00–23:00");
  // The editor: a custom shift for Marcus on Wednesday.
  await marcusRow.getByRole("cell").nth(2).click();
  const editor = kaiWen.getByTestId("shift-editor");
  await editor.getByRole("button", { name: /^MID/ }).click();
  await editor.getByRole("button", { name: "Save shift" }).click();
  await expect(editor).toBeHidden();
  await expect(marcusRow.getByTestId("shift-chip")).toHaveCount(2);

  await kaiWen.getByTestId("publish").click();
  const publish = kaiWen.getByTestId("publish-dialog");
  await expect(publish).toContainText("2 people with shifts will be notified");
  await publish.getByTestId("confirm-publish").click();
  await expect(kaiWen.getByText("Published. 2 people were notified.")).toBeVisible();
  await expect(kaiWen.getByTestId("roster-status")).toContainText("Published");

  // 2. Nurul on her phone.
  const nurul = await signedIn(browser, E2E.members.crewA.email, 390, 844);
  await nurul.goto("/?view=employee"); // the employee view: a bottom tab bar on a phone
  await nurul.getByRole("navigation", { name: "Employee navigation" }).getByRole("link", { name: "Shifts" }).click();
  await expect(nurul).toHaveURL(/\/schedules\/me/);
  await expect(nurul.getByTestId("my-days")).toBeVisible();
  expect(await nurul.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const days = nurul.getByTestId("my-days");
  const monRow = days.getByTestId(`day-${next}`);
  await expect(monRow).toContainText("07:00–15:00");
  await monRow.getByRole("button", { name: /Swap or give away/ }).click();
  const sheet = nurul.getByTestId("offer-sheet");
  await sheet.getByRole("combobox", { name: "Colleague" }).click();
  await nurul.getByRole("option", { name: E2E.members.crewB.name }).click();
  await sheet.getByRole("combobox", { name: "Their shift" }).click();
  await nurul.getByRole("option", { name: `${shortDay(tue)} 15:00–23:00` }).click();
  await sheet.getByRole("button", { name: "Send request" }).click();
  await expect(nurul.getByTestId("my-swaps")).toContainText("Waiting for colleague");

  // 3. Marcus accepts.
  const marcus = await signedIn(browser, E2E.members.crewB.email, 390, 844);
  await marcus.goto("/schedules/me");
  const offers = marcus.getByTestId("swap-offers");
  await expect(offers).toContainText(E2E.members.crewA.name);
  await offers.getByRole("button", { name: "Accept" }).click();
  await expect(offers).toBeHidden();

  // 4. Kai Wen approves in the Inbox.
  await kaiWen.goto("/inbox");
  const task = kaiWen.getByTestId("inbox-task").filter({ hasText: "Shift swap" }).first();
  await expect(task).toBeVisible();
  await task.getByRole("button").first().click();
  await expect(kaiWen.getByTestId("request-panel")).toContainText(E2E.members.crewB.name);
  await kaiWen.keyboard.press("a");
  await expect(task).toHaveCount(0);

  // 5. Nurul now works Tuesday's closing shift, and no longer Monday.
  await nurul.reload();
  const tueRow = nurul.getByTestId(`day-${tue}`);
  await expect(tueRow).toContainText("15:00–23:00");
  await expect(nurul.getByTestId(`day-${next}`)).toContainText("Off");
  await expect(nurul.getByTestId("my-swaps")).toContainText("Approved");
});
