import { createHash, randomBytes } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";

/**
 * add-api-platform task 4.1: a device session created the way the mobile app does it (native
 * authorize → sign-in in the system browser → code → `POST /api/v1/native/token`) is listed in
 * My sessions as a mobile app, and signing it out there revokes its tokens.
 */
const REDIRECT = "crowtech.crowhr:/oauth2redirect";
const member = E2E.members.device;

async function deviceSession(request: APIRequestContext, deviceName: string) {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(12).toString("base64url");
  const authorize = await request.get(
    `/api/v1/native/authorize?org=${E2E.org.slug}&client=android&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`,
    { maxRedirects: 0 },
  );
  expect(authorize.status()).toBe(302);
  const nativeRequestId = new URL(authorize.headers().location as string, "http://x").searchParams.get("native");
  // The system browser's sign-in page posts the password with the native request ID.
  const signIn = await request.post("/api/v1/auth/sign-in", {
    data: { org: E2E.org.slug, email: member.email, password: E2E.password, nativeRequestId },
  });
  expect(signIn.status(), await signIn.text()).toBe(200);
  const back = new URL(((await signIn.json()) as { redirectTo: string }).redirectTo);
  expect(`${back.protocol}${back.pathname}`).toBe(REDIRECT);
  expect(back.searchParams.get("state")).toBe(state);
  const token = await request.post("/api/v1/native/token", {
    data: {
      grantType: "authorization_code",
      code: back.searchParams.get("code"),
      codeVerifier: verifier,
      deviceName,
      appVersion: "1.0.0",
    },
  });
  expect(token.status(), await token.text()).toBe(200);
  return (await token.json()) as { accessToken: string; refreshToken: string; deviceSessionId: string };
}

test("a device session from the app's token endpoint is in My sessions and can be signed out", async ({
  page,
  playwright,
  baseURL,
}) => {
  // The phone: its own cookie jar, like the system browser plus the app.
  const phone = await playwright.request.newContext({ baseURL });
  const tokens = await deviceSession(phone, "Pixel 9 Pro");
  const bearer = { authorization: `Bearer ${tokens.accessToken}` };
  expect((await phone.get("/api/v1/me", { headers: bearer })).status()).toBe(200);

  await uiSignInOk(page, member.email);
  await page.goto("/me/sessions");
  const table = page.getByTestId("sessions-table");
  const row = table.getByRole("row").filter({ hasText: "Pixel 9 Pro (Android)" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Mobile app");
  await expect(table.getByRole("row").filter({ hasText: "This device" })).toBeVisible();

  // The new device was reported to the member (security notice in the bell).
  await page.getByTestId("notification-bell").click();
  await expect(page.getByRole("button", { name: /A new device signed in to your account/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await row.getByRole("button", { name: "Sign out Pixel 9 Pro (Android)" }).click();
  await expect(page.getByText("Signed out that session.")).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "Pixel 9 Pro" })).toHaveCount(0);

  // Revoked server-side: the access token and the refresh token no longer work.
  expect((await phone.get("/api/v1/me", { headers: bearer })).status()).toBe(401);
  const refresh = await phone.post("/api/v1/native/token", {
    data: { grantType: "refresh_token", refreshToken: tokens.refreshToken },
  });
  expect(refresh.status()).toBe(400);
  await phone.dispose();
});
