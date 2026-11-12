import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";

/** The organisation switcher lists the person's organisations and moves the session; the company logo uploads. */

async function axeClean(page: Page, include?: string) {
  // A menu fades in: measure contrast once its opening animation has finished, not mid-fade.
  if (include) {
    await page
      .locator(include)
      .first()
      .evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  }
  const axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  // An open menu hides the rest of the page from assistive technology (Radix): check the menu itself.
  const results = await (include ? axe.include(include) : axe).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
    "axe violations",
  ).toEqual([]);
}

// A 1×1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("switch to a sister organisation and back", async ({ page }) => {
  await uiSignInOk(page, E2E.members.staff.email);
  const switcher = page.getByRole("button", { name: /Switch organisation/ }).first();
  await expect(switcher).toContainText(E2E.org.name);
  await axeClean(page);
  await switcher.click();
  const sister = page.getByRole("menuitem", { name: new RegExp(E2E.sisterOrg.name) });
  await expect(sister).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Bukit Batok Bakery/ })).toHaveCount(0);
  await axeClean(page, "[role=menu]");
  await sister.click();
  await expect(page.getByRole("button", { name: /Switch organisation/ }).first()).toContainText(E2E.sisterOrg.name);

  await page
    .getByRole("button", { name: /Switch organisation/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: new RegExp(E2E.org.name) }).click();
  await expect(page.getByRole("button", { name: /Switch organisation/ }).first()).toContainText(E2E.org.name);
});

test("someone in one organisation is told so", async ({ page }) => {
  await uiSignInOk(page, E2E.members.hr.email);
  await page
    .getByRole("button", { name: /Switch organisation/ })
    .first()
    .click();
  await expect(page.getByText("You belong to this organisation only.")).toBeVisible();
});

test("company logo: PNG only, then shown on the Company screen", async ({ page }) => {
  // Tanjong Tech: no other spec reads its company profile.
  await uiSignInOk(page, E2E.ssoOrg.owner.email, E2E.password, E2E.ssoOrg.slug);
  await page.goto("/settings/company");
  await expect(page.getByRole("button", { name: "Save company profile" })).toBeVisible();
  // The logo belongs to a saved profile: the control appears once there is one.
  if (await page.getByText("Set up your company").isVisible()) {
    await page.getByLabel("Legal name").fill(E2E.ssoOrg.name);
    await page.getByLabel("UEN").fill("202655555K");
    await page.getByRole("button", { name: "Save company profile" }).click();
    await expect(page.getByText("Company profile saved")).toBeVisible();
  }
  const file = page.getByLabel("Logo file (PNG)");
  await file.setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(page.getByText("Upload the logo as a PNG file.")).toBeVisible();
  await file.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Logo saved")).toBeVisible();
  await expect(page.getByRole("img", { name: "Current company logo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace logo" })).toBeVisible();
  await axeClean(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await axeClean(page);
});
