import { expect, type Page } from "@playwright/test";

/** Waits for the in-browser runtime to boot (loader gone, banner up) and returns its timings. */
export async function waitForDemo(page: Page) {
  await expect(page.getByTestId("demo-banner")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("demo-loading")).toBeHidden();
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __crowhrDemo: {
            bootMs: number;
            readyMs: number;
            timings: { totalMs: number; seeded: boolean; stages: { stage: string; ms: number }[] };
          };
        }
      ).__crowhrDemo,
  );
}

/** A full page load (as when a visitor types a URL): the demo restarts from IndexedDB. */
export async function go(page: Page, path: string) {
  await page.goto(path);
  return waitForDemo(page);
}

export type Persona = "owner" | "hr-admin" | "payroll-admin" | "manager" | "employee";

/** From the sign-in page: one click on a persona, then the signed-in Home. */
export async function pickPersona(page: Page, persona: Persona) {
  await expect(page.getByTestId("demo-personas")).toBeVisible();
  await page.getByTestId(`persona-${persona}`).click();
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 20_000 });
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByTestId("demo-personas")).toBeVisible();
}

/** Uncaught page errors and CSP violations collected during a test. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text());
  });
  return errors;
}
