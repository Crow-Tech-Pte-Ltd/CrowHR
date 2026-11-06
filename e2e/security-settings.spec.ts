import { expect, type Page, test } from "@playwright/test";
import { E2E, MOCK_IDP, mockIdpNextUser, uiSignInOk } from "./fixtures.ts";

/**
 * add-identity-and-access task 9.2: an owner adds a generic OpenID Connect provider (the mock IdP
 * from packages/core/testing/mock-oidc.ts, served by e2e/mock-idp-server.ts), completes a test
 * sign-in, turns it on and turns password sign-in off; staff then see the SSO-only message and
 * sign in through the provider. Runs in its own organisation (E2E.oidcOrg).
 */
test.describe.configure({ mode: "serial" });

const org = E2E.oidcOrg;
const BUTTON = "Bakery Keycloak";

/** Retry-safe start: password sign-in on and no generic provider left from an earlier attempt. */
async function reset(page: Page) {
  const r = page.request;
  const signIn = await r.post("/api/v1/auth/sign-in", {
    data: { org: org.slug, email: org.owner.email, password: E2E.password },
  });
  expect(signIn.status()).toBe(200);
  expect((await r.patch("/api/v1/security/settings", { data: { passwordEnabled: true } })).status()).toBe(200);
  const settings = (await (await r.get("/api/v1/security/settings")).json()) as {
    providers: { id: string; kind: string }[];
  };
  for (const p of settings.providers.filter((x) => x.kind === "oidc"))
    expect((await r.delete(`/api/v1/security/providers/${p.id}`)).status()).toBe(204);
  await r.post("/api/v1/auth/sign-out");
}

test("owner adds a generic OIDC provider, tests it, turns passwords off; staff must use SSO", async ({
  page,
  browser,
}) => {
  await reset(page);
  await uiSignInOk(page, org.owner.email, E2E.password, org.slug);
  await page.goto("/settings/security");
  const methods = page.getByTestId("sign-in-methods");
  await expect(page.getByRole("switch", { name: "Email and password sign-in" })).toBeDisabled();

  // Add the provider: discovery is checked before saving.
  await page.getByRole("button", { name: "Add a method" }).click();
  await page.getByRole("menuitem", { name: "OpenID Connect" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Button label").fill(BUTTON);
  await dialog.getByLabel("Issuer URL").fill(`${MOCK_IDP.origin}/realms/nowhere`);
  await dialog.getByLabel("Client ID").fill(MOCK_IDP.clientId);
  await dialog.getByLabel("Client secret").fill(MOCK_IDP.clientSecret);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText(/could not be fetched|names a different issuer/)).toBeVisible();
  await dialog.getByLabel("Issuer URL").fill(MOCK_IDP.issuer);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByTestId("provider-saved")).toContainText("Saved. Now register Crow HR at the provider");
  await expect(dialog.getByRole("textbox", { name: "redirect URI" })).toHaveValue(
    /\/api\/v1\/auth\/oidc\/[0-9a-f-]{36}\/callback$/,
  );
  await dialog.getByRole("button", { name: "Done" }).click();
  const provider = methods.getByTestId("provider-oidc");
  await expect(provider).toContainText(BUTTON);
  await expect(provider).toContainText("Off · not tested");

  // Test sign-in: a round trip through the mock IdP as the owner.
  await mockIdpNextUser(page.request, { sub: "kc-owner", email: org.owner.email, email_verified: true });
  await provider.getByRole("button", { name: "Test sign-in" }).click();
  await expect(page).toHaveURL(/\/settings\/security\?test=ok/);
  await expect(page.getByTestId("test-result")).toContainText(`Test sign-in with ${BUTTON} worked`);
  await expect(provider).toContainText("Off · tested");

  // Turn it on, then turn password sign-in off (owners keep break-glass).
  await provider.getByRole("switch", { name: `${BUTTON} sign-in` }).click();
  await expect(page.getByText(`${BUTTON} is on.`)).toBeVisible();
  const password = page.getByRole("switch", { name: "Email and password sign-in" });
  await expect(password).toBeEnabled();
  await password.click();
  await expect(page.getByText("Password sign-in is off for staff.")).toBeVisible();
  await expect(methods).toContainText("Off for staff. Owners can still sign in with a password");

  // Staff: the sign-in page offers only the SSO button; a password is refused with the SSO-only message.
  const staffCtx = await browser.newContext();
  const staff = await staffCtx.newPage();
  await staff.goto(`/sign-in/${org.slug}`);
  await expect(staff.getByTestId("sso-methods").getByRole("button", { name: `Sign in with ${BUTTON}` })).toBeVisible();
  await expect(staff.getByLabel("Password", { exact: true })).toHaveCount(0);
  await staff.getByRole("button", { name: "Organisation owner? Sign in with password" }).click();
  await staff.getByLabel("Work email").fill(org.staff.email);
  await staff.getByLabel("Password", { exact: true }).fill(E2E.password);
  await staff.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(staff.getByTestId("sign-in-notice")).toContainText(
    `${org.name} doesn't use passwords for sign-in. Use ${BUTTON} instead.`,
  );

  // …and signs in through the provider (linked by verified email to the pre-provisioned member).
  await mockIdpNextUser(staff.request, { sub: "kc-hafiz", email: org.staff.email, email_verified: true });
  await staff.getByRole("button", { name: `Sign in with ${BUTTON}` }).click();
  await expect(staff.getByRole("heading", { level: 1 })).toHaveText(/^Hi, Hafiz/);
  await staff.goto("/me/sessions");
  await expect(staff.getByText(BUTTON).first()).toBeVisible();
  await staffCtx.close();

  // The owner still gets in with a password (break-glass), and was told about each change.
  await page.getByTestId("notification-bell").click();
  await expect(page.getByRole("button", { name: /Sign-in settings were changed/ }).first()).toBeVisible();
});
