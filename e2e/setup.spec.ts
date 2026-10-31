import { expect, test } from "@playwright/test";
import { E2E_SETUP_CODE } from "../playwright.config.ts";

/**
 * e2e/self-host.sh runs this same spec against a real `docker compose` install (selfhost.config.ts),
 * passing the code it read from `docker compose logs app`.
 */
const SETUP_CODE = process.env.SELFHOST_SETUP_CODE ?? E2E_SETUP_CODE;
const SELFHOST = Boolean(process.env.SELFHOST_SETUP_CODE);

/**
 * First-run setup (self-hosting spec "First-run setup wizard"), against a fresh server with no
 * organisation. Runs as the `setup` project; the steps depend on each other, so run serially.
 */
test.describe.configure({ mode: "serial" });

test.describe("first-run setup wizard", () => {
  test("every page redirects to /setup while setup is pending", async ({ page, request }) => {
    await page.goto("/payroll");
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByRole("heading", { level: 1, name: "Set up Crow HR" })).toBeVisible();
    const api = await request.get("/api/v1/system/status");
    expect(api.status()).toBe(409);
    expect((await api.json()).error.code).toBe("setup_required");
  });

  test("a wrong code is refused with where to find the right one", async ({ page }) => {
    await page.goto("/setup");
    await page.getByLabel("Setup code").fill("KKKK-KKKK-KKKK-KKKK");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("That setup code is not right")).toBeVisible();
    await expect(page.getByText("docker compose logs app").first()).toBeVisible();
  });

  test("enter code, company and owner; offered MFA; lands on Home", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/setup");
    await page.getByLabel("Setup code").fill(SETUP_CODE.toLowerCase().replace(/-/g, ""));
    await expect(page.getByLabel("Setup code")).toHaveValue(SETUP_CODE);
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Company's registered name").fill("Kampong Kopi Pte. Ltd.");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Your name").fill("Aisyah Rahman");
    await page.getByLabel("Work email").fill("aisyah@kampongkopi.example");
    // The identity password policy rejects common passwords; the message says how to fix it.
    await page.getByLabel("Password").fill("Password!2026");
    await page.getByRole("button", { name: "Create company and owner" }).click();
    await expect(page.getByLabel("Password")).toHaveAttribute("aria-invalid", "true");

    await page.getByLabel("Password").fill("kopi-o kosong peng, siew dai");
    await page.getByRole("button", { name: "Create company and owner" }).click();

    const done = page.getByTestId("setup-done");
    await expect(done).toContainText("Kampong Kopi Pte. Ltd. is set up");
    await expect(done).toContainText("/sign-in/kampong-kopi");
    await expect(page.getByRole("heading", { name: "Protect the owner account" })).toBeVisible();
    await expect(page.getByTestId("mfa-offer")).toBeVisible();

    await expect(page.getByRole("link", { name: "Set up two-step verification" })).toHaveAttribute(
      "href",
      /^\/me\/sessions\?enrol=/,
    );
    await page.getByRole("link", { name: "Later, go to Home" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Work to do" })).toBeVisible();

    // The new owner is signed in, so Settings → System shows real status (read-only).
    await page.goto("/settings");
    await page.getByRole("link", { name: /System/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Database" })).toContainText("Connected");
    await expect(page.getByTestId("backup-stale")).toContainText("No successful backup yet");
    await expect(page.getByTestId("backup-unencrypted")).toContainText("Backups are not encrypted");
    // Through Docker's published port the peer is the bridge gateway, not 127.0.0.1.
    await expect(page.getByTestId("client-ip")).toHaveText(SELFHOST ? /^\d+\.\d+\.\d+\.\d+$/ : "127.0.0.1");
    await expect(page.getByTestId("proxy-trust")).toHaveText("Direct");
    expect(errors).toEqual([]);
  });

  test("afterwards /setup is gone: the API answers 404 and the page says so", async ({ page, request }) => {
    expect((await request.get("/api/v1/setup")).status()).toBe(404);
    await page.goto("/setup");
    await expect(page.getByTestId("setup-already-done")).toBeVisible();
  });
});
