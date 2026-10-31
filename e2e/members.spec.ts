import { expect, test } from "@playwright/test";
import { E2E, HOME_HEADING, uiSignIn, uiSignInOk } from "./fixtures.ts";

test.describe("members", () => {
  test("invite → accept → sign in", async ({ page, browser }) => {
    const email = `new.hire.${Date.now()}@kampongkopi.example`;
    await uiSignInOk(page, E2E.members.owner.email);
    await page.goto("/settings/members");
    await expect(page.getByTestId("members-table")).toBeVisible();
    await page.getByRole("button", { name: "Invite someone" }).click();
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Name", { exact: true }).fill("Chua Boon Keat");
    await page
      .getByRole("dialog")
      .getByRole("checkbox", { name: /^HR admin/ })
      .check();
    await page.getByRole("button", { name: "Send invitation" }).click();
    const link = await page.getByTestId("invite-link").inputValue();
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);

    const invitee = await browser.newContext();
    const p2 = await invitee.newPage();
    await p2.goto(link);
    await expect(p2.getByRole("heading", { name: `Join ${E2E.org.name}` })).toBeVisible();
    await p2.getByLabel("Choose a password").fill("password1234");
    await p2.getByLabel("Type it again").fill("password1234");
    await p2.getByRole("button", { name: "Accept and sign in" }).click();
    await expect(p2.getByText("This password is too common")).toBeVisible();
    await p2.getByLabel("Choose a password").fill("sambal stingray by the sea");
    await p2.getByLabel("Type it again").fill("sambal stingray by the sea");
    await p2.getByRole("button", { name: "Accept and sign in" }).click();
    await expect(p2.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
    await p2.getByRole("button", { name: "Account menu" }).click();
    await p2.getByRole("menuitem", { name: "Sign out" }).click();
    await uiSignIn(p2, email, "sambal stingray by the sea");
    await expect(p2.getByRole("heading", { name: HOME_HEADING })).toBeVisible();
    await invitee.close();

    await page.reload();
    await expect(page.getByTestId(`member-${email}`)).toContainText("Active");
    await expect(page.getByTestId(`member-${email}`)).toContainText("HR admin");
  });

  test("an admin signs a member out everywhere; their open session ends", async ({ page, browser }) => {
    const victim = await browser.newContext();
    const vp = await victim.newPage();
    await uiSignIn(vp, E2E.members.revokee.email);
    await expect(vp.getByRole("heading", { name: HOME_HEADING })).toBeVisible();

    await uiSignInOk(page, E2E.members.owner.email);
    await page.goto("/settings/members");
    await page.getByRole("button", { name: `Actions for ${E2E.members.revokee.name}` }).click();
    await page.getByRole("menuitem", { name: "Sign out everywhere" }).click();
    await expect(page.getByText(`${E2E.members.revokee.name} was signed out everywhere.`)).toBeVisible();

    await vp.goto("/settings");
    await expect(vp).toHaveURL(/\/sign-in\/kampong-kopi\?reason=revoked/);
    await expect(vp.getByTestId("sign-in-notice")).toContainText("This session was signed out");
    await victim.close();
  });
});
