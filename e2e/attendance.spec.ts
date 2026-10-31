import { expect, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";

/**
 * Attendance end to end (add-attendance task 6.2): Nadia clocks in while offline, the punch waits
 * on the device, and when the connection returns it is sent exactly once with both the tap time
 * and the server time; then she clocks out online.
 */
test.use({ viewport: { width: 390, height: 844 } });

interface Me {
  clockedIn: boolean;
  today: {
    id: string;
    kind: string;
    deviceTime: string;
    serverTime: string;
    recordedAt: string;
    queued: boolean;
    flags: string[];
    idempotencyKey?: string;
  }[];
}

test("clock in offline → queued → back online → replayed once; then clock out", async ({ page, context }) => {
  test.setTimeout(60_000);
  await uiSignInOk(page, E2E.members.leaveStaff.email);
  await page.goto("/attendance");
  const button = page.getByTestId("clock-button");
  await expect(button).toHaveText(/Clock in/);

  await context.setOffline(true);
  await button.click();
  const queue = page.getByTestId("punch-queue");
  await expect(queue).toContainText("1 punch waiting to send");
  await expect(queue).toContainText("Queued — will send when you're back online");
  // The next tap would be a clock-out, even offline.
  await expect(button).toHaveText(/Clock out/);
  await page.waitForTimeout(2_000);

  await context.setOffline(false);
  await expect(queue).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId("today-punches")).toContainText("Clocked in");

  const me = (await (await page.request.get("/api/v1/attendance/me")).json()) as Me;
  expect(me.clockedIn).toBe(true);
  expect(me.today).toHaveLength(1);
  const [p] = me.today;
  expect(p?.queued).toBe(true);
  // Tapped while offline, received about two seconds later; recorded at the tap.
  expect(Date.parse(p?.serverTime ?? "") - Date.parse(p?.deviceTime ?? "")).toBeGreaterThan(1_500);
  expect(Math.abs(Date.parse(p?.recordedAt ?? "") - Date.parse(p?.deviceTime ?? ""))).toBeLessThan(1_500);
  expect(p?.flags).not.toContain("clock_skew");

  // Reloading never resends: the queue is empty and there is still one punch.
  await page.reload();
  await expect(page.getByTestId("today-punches").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("punch-queue")).toHaveCount(0);

  await page.getByTestId("clock-button").click();
  await expect(page.getByTestId("today-punches").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("clock-button")).toHaveText(/Clock in/);
  const after = (await (await page.request.get("/api/v1/attendance/me")).json()) as Me;
  expect(after.today.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)).map((x) => x.kind)).toEqual([
    "in",
    "out",
  ]);
  expect(after.clockedIn).toBe(false);
});
