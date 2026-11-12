import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { addDays, pickDate, todaySg } from "./leave-helpers.ts";

/**
 * Demo companies end to end (add-demo-companies 3.3), against a server started with
 * DEMO_COMPANIES=1 (playwright.config.ts, project "demo-companies"): a visitor opens /try, starts
 * a demo company, opens it in the browser and signs in as Hafiz (Employee) by picking him, applies
 * for leave; Siti (Manager) signs in to the same company in another browser and approves it.
 * The try page and the persona picker must have no axe violations, on a computer and at 360 px.
 */
const DESKTOP = { width: 1440, height: 900 };

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    "axe violations",
  ).toEqual([]);
}

async function newPage(browser: Browser, viewport = DESKTOP) {
  const context = await browser.newContext({ viewport });
  return context.newPage();
}

interface Shift {
  date: string;
  kind: "shift" | "rest";
}

test("start a demo company, apply for leave as the employee, approve it as the manager", async ({ browser }) => {
  // The first start may wait for a copy to be seeded (about 20 s on a laptop, more on CI).
  test.setTimeout(240_000);
  const visitor = await newPage(browser);
  await visitor.goto("/try");
  await expect(visitor.getByRole("heading", { level: 1 })).toContainText("Your own demo company");
  await axeClean(visitor);

  await visitor.getByTestId("try-start-button").click();
  const company = visitor.getByTestId("try-company");
  await expect(company).toBeVisible({ timeout: 180_000 });
  await expect(visitor.getByTestId("try-qr")).toBeVisible();
  const slug = await visitor.getByTestId("try-slug").inputValue();
  expect(slug).toMatch(/^demo-[a-z2-7]{12}$/);
  await expect(visitor.getByTestId("try-server")).toHaveValue(new URL(visitor.url()).origin);
  await axeClean(visitor);

  // Coming back shows the same company.
  await visitor.reload();
  await expect(visitor.getByTestId("try-slug")).toHaveValue(slug);

  // Open it in this browser: the sign-in page offers its people, no password.
  await visitor.getByTestId("try-open-browser").click();
  await expect(visitor).toHaveURL(new RegExp(`/sign-in/${slug}$`));
  await expect(visitor.getByTestId("demo-company-notice")).toBeVisible();
  await expect(visitor.getByLabel("Password")).toHaveCount(0);
  await expect(visitor.getByTestId("persona-employee")).toBeVisible();
  await axeClean(visitor);
  await visitor.getByTestId("persona-employee").click();
  await expect(visitor.getByTestId("demo-company-banner")).toBeVisible();

  // Hafiz applies for a day of annual leave on a day he is rostered, a few weeks ahead.
  const today = todaySg();
  const roster = (await (
    await visitor.request.get(`/api/v1/scheduling/me?from=${addDays(today, 14)}&to=${addDays(today, 40)}`)
  ).json()) as { shifts: Shift[] };
  const day = roster.shifts.find((s) => s.kind === "shift" && new Date(`${s.date}T00:00:00Z`).getUTCDay() !== 0);
  expect(day, "Hafiz has a shift in the coming weeks").toBeDefined();
  await visitor.goto("/leave");
  await visitor.getByTestId("apply-leave").click();
  const sheet = visitor.getByRole("dialog");
  await expect(sheet.getByText("Apply for leave")).toBeVisible();
  // One day: picking "From" fills "To" with the same date.
  await pickDate(visitor, "From", day?.date as string);
  await sheet.getByLabel("Reason").fill("My sister's wedding");
  await expect(sheet.getByTestId("leave-quote")).toBeVisible();
  await sheet.getByRole("button", { name: "Send for approval" }).click();
  await expect(visitor.getByTestId("leave-request")).toContainText("Pending");
  await visitor.keyboard.press("Escape");

  // Siti, in another browser (say the visitor's laptop while Hafiz is on the phone), approves it.
  const siti = await newPage(browser, { width: 360, height: 780 });
  await siti.goto(`/sign-in/${slug}`);
  await expect(siti.getByTestId("persona-manager")).toBeVisible();
  await axeClean(siti);
  await siti.getByTestId("persona-manager").click();
  await expect(siti.getByTestId("demo-company-banner")).toBeVisible();
  await siti.setViewportSize(DESKTOP);
  await siti.goto("/inbox");
  const [y, mo, d] = (day?.date as string).split("-").map(Number) as [number, number, number];
  const shown = `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mo - 1]} ${y}`;
  const task = siti
    .getByTestId("inbox-task")
    .filter({ hasText: "Hafiz" })
    .filter({ hasText: "Annual leave" })
    .filter({ hasText: shown })
    .first();
  await expect(task).toBeVisible();
  await task.getByRole("button").first().click();
  await expect(siti.getByTestId("request-panel")).toContainText("My sister's wedding");
  await siti.keyboard.press("a");
  await expect(task).toHaveCount(0);

  // Hafiz sees it approved.
  await visitor.reload();
  await expect(visitor.getByTestId("my-leave-request").filter({ hasText: shown }).first()).toContainText("Approved");
});

test("the try page works at 360 px on a phone, with an app link", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({
    viewport: { width: 360, height: 780 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
    isMobile: true,
    hasTouch: true,
  });
  const phone = await context.newPage();
  await phone.goto("/try");
  await phone.getByTestId("try-start-button").click();
  await expect(phone.getByTestId("try-company")).toBeVisible({ timeout: 180_000 });
  const slug = await phone.getByTestId("try-slug").inputValue();
  const link = await phone.getByTestId("try-open-app").getAttribute("href");
  expect(link).toContain("intent://connect?server=");
  expect(link).toContain(`org=${slug}`);
  expect(link).toContain("package=crowtech.crowhr");
  expect(link).toContain(
    `S.browser_fallback_url=${encodeURIComponent("https://play.google.com/store/apps/details?id=crowtech.crowhr")}`,
  );
  await expect(phone.getByTestId("try-qr")).toHaveCount(0);
  // Nothing wider than the screen.
  expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await axeClean(phone);
  // The keyboard reaches the main actions.
  await phone.getByTestId("try-open-browser").focus();
  await expect(phone.getByTestId("try-open-browser")).toBeFocused();
});

test("an ended or unknown demo company's sign-in page says so and offers a new one", async ({ page }) => {
  await page.goto("/sign-in/demo-aaaaaaaaaaaa");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This demo company has ended");
  await expect(page.getByRole("link", { name: "Start a new demo company" })).toHaveAttribute("href", "/try");
  await axeClean(page);
});
