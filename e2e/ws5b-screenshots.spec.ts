import { type Browser, expect, type Page, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";
import { addDays, mondayOf, todaySg } from "./leave-helpers.ts";

/**
 * WS5b design-review screenshots (run with WS5B_SHOTS_DIR=<dir>): the Bugis week grid at
 * 25 people × 7 days (1440, 1024 tablet, 390 day list), the shift editor, the publish dialog,
 * My schedule, a swap offer on Home, a swap task in the Inbox, and Settings → Shift templates.
 * Skipped in normal runs. Run after e2e/schedules.spec.ts for Nurul's published week.
 */
const DIR = process.env.WS5B_SHOTS_DIR;
test.skip(!DIR, "set WS5B_SHOTS_DIR to capture screenshots");

async function signedIn(browser: Browser, email: string, width = 1440, height = 900): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await uiSignInOk(page, email);
  return page;
}

async function snap(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage });
}

async function sizes(
  page: Page,
  name: string,
  widths: [number, number][],
  prepare: () => Promise<void>,
  fullPage = true,
) {
  for (const [w, h] of widths) {
    await page.setViewportSize({ width: w, height: h });
    await prepare();
    await snap(page, `${name}-${w}`, fullPage);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("WS5b scheduling screens", async ({ browser }) => {
  test.setTimeout(240_000);
  const week = mondayOf(todaySg());
  const next = addDays(week, 7);

  const hr = await signedIn(browser, E2E.members.hr.email);
  const scopes = (await (await hr.request.get("/api/v1/scheduling/scopes")).json()) as {
    locations: { id: string; name: string }[];
  };
  const bugis = scopes.locations.find((l) => l.name === "Bugis outlet")?.id as string;
  const grid = `/schedules?week=${week}&loc=${bugis}`;
  await sizes(
    hr,
    "schedules-grid",
    [
      [1440, 900],
      [1024, 768],
      [390, 844],
    ],
    async () => {
      await hr.goto(grid);
      await expect(hr.getByTestId("roster-status")).toBeVisible();
    },
  );
  // The viewport the manager actually sees at 1440 (sticky header and footer inside the scroller).
  await hr.goto(grid);
  await expect(hr.getByTestId("week-grid")).toBeVisible();
  await snap(hr, "schedules-grid-viewport-1440", false);

  // Editor on a shift with a warning (Ryan Low's 13-hour Wednesday).
  await hr
    .getByTestId("week-grid")
    .getByRole("row")
    .filter({ hasText: "Ryan Low" })
    .getByTestId("shift-chip")
    .filter({ hasText: "08:00–22:00" })
    .click();
  await expect(hr.getByTestId("shift-editor")).toBeVisible();
  await snap(hr, "shift-editor-1440", false);
  await hr.keyboard.press("Escape");

  // An unpublished change, then the publish dialog.
  await hr.getByTestId("week-grid").getByRole("row").filter({ hasText: "Aaron Tan" }).getByRole("cell").nth(1).click();
  const editor = hr.getByTestId("shift-editor");
  if (await editor.isVisible()) {
    await editor.getByRole("button", { name: /^MID/ }).click();
    await editor.getByRole("button", { name: "Save shift" }).click();
  }
  await expect(hr.getByTestId("roster-status")).toContainText("Unpublished changes");
  await hr.getByTestId("publish").click();
  await expect(hr.getByTestId("publish-dialog")).toBeVisible();
  await snap(hr, "publish-dialog-1440", false);
  await hr.keyboard.press("Escape");

  // Settings → Shift templates.
  await sizes(
    hr,
    "settings-shift-templates",
    [
      [1440, 900],
      [390, 844],
    ],
    async () => {
      await hr.goto("/settings/shift-templates");
      await expect(hr.getByRole("heading", { name: "Shift templates" })).toBeVisible();
    },
  );

  // Kai Wen's HQ week (built by schedules.spec.ts), on a tablet.
  const kaiWen = await signedIn(browser, E2E.members.approver.email, 1024, 768);
  await kaiWen.goto(`/schedules?week=${next}`);
  await expect(kaiWen.getByTestId("week-grid")).toBeVisible();
  await snap(kaiWen, "schedules-hq-next-week-1024");

  // A pending give-away: Marcus offers Nurul his Wednesday; Home shows Nurul the offer.
  const marcus = await signedIn(browser, E2E.members.crewB.email, 390, 844);
  const mine = (await (
    await marcus.request.get(`/api/v1/scheduling/me?from=${next}&to=${addDays(next, 6)}`)
  ).json()) as {
    shifts: { id: string; kind: string }[];
  };
  const wed = mine.shifts.find((s) => s.kind === "shift");
  const nurul = await signedIn(browser, E2E.members.crewA.email, 390, 844);
  const nurulId = ((await (await nurul.request.get("/api/v1/me")).json()) as { employeeId: string }).employeeId;
  if (wed) {
    await marcus.request.post("/api/v1/scheduling/swaps", {
      data: { kind: "giveaway", shiftId: wed.id, peerEmployeeId: nurulId, note: "Dentist appointment" },
    });
  }
  await nurul.goto("/");
  await snap(nurul, "home-swap-offer-390");
  await sizes(
    nurul,
    "my-schedule",
    [
      [390, 844],
      [1440, 900],
    ],
    async () => {
      await nurul.goto("/schedules/me");
      await expect(nurul.getByTestId("my-days")).toBeVisible();
    },
  );
  await nurul.setViewportSize({ width: 390, height: 844 });
  await nurul.goto("/schedules/me");
  const offers = nurul.getByTestId("swap-offers");
  await offers.getByRole("button", { name: "Accept" }).click();
  await expect(offers).toBeHidden();
  await kaiWen.setViewportSize({ width: 1440, height: 900 });
  await kaiWen.goto("/inbox");
  const task = kaiWen.getByTestId("inbox-task").filter({ hasText: "Shift give-away" }).first();
  await task.getByRole("button").first().click();
  await expect(kaiWen.getByTestId("request-panel")).toContainText("Goes to");
  await snap(kaiWen, "inbox-shift-swap-1440", false);
});
