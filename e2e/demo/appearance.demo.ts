import { expect, test } from "@playwright/test";
import { go, pickPersona, waitForDemo } from "./helpers.ts";

test("owners can preview branding while AI assistants stay disabled in the public demo", async ({ page, request }) => {
  await page.goto("/");
  await waitForDemo(page);
  await pickPersona(page, "owner");
  await go(page, "/settings/company");
  await expect(page.getByText("Connections are disabled in the public demo.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enable AI assistants" })).toHaveCount(0);
  expect((await request.get("/.well-known/oauth-authorization-server")).status()).toBe(404);
  await page.getByLabel("Accent colour").fill("#165E85");
  await page.getByRole("button", { name: "Save appearance" }).click();
  await expect(page.getByText("Appearance saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Accent colour")).toHaveValue("#165E85");
  await page.getByRole("button", { name: "Reset appearance" }).click();
  await expect(page.getByLabel("Accent colour")).toHaveValue("");
});
