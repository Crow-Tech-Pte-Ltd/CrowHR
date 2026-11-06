import { expect, test } from "@playwright/test";
import { E2E, uiSignInOk } from "./fixtures.ts";

/**
 * add-self-hosting task 6.4: Settings → System and the Home backup warning. e2e/seed.ts records a
 * successful scheduled backup three days ago (no archive file), so the last success is more than
 * 48 hours old. The e2e server has no BACKUP_PASSPHRASE, so backups are not encrypted.
 */
test.describe("Settings → System", () => {
  test("Home warns the owner that the last backup is more than 48 hours old", async ({ page }) => {
    await uiSignInOk(page, E2E.members.owner.email);
    const warning = page.getByTestId("home-backup-warning");
    await expect(warning).toContainText("No backup in the last 48 hours");
    await expect(warning).toContainText(/Last successful backup 7\d hours ago/);
    await warning.getByRole("link", { name: "Check backups" }).click();
    await expect(page).toHaveURL(/\/settings\/system$/);
    await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();
  });

  test("shows the last backup, the not-encrypted notice and the proxy diagnostic", async ({ page }) => {
    // A forged X-Forwarded-For from a peer that isn't a trusted proxy must be ignored.
    await page.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https" });
    await uiSignInOk(page, E2E.members.owner.email);
    await page.goto("/settings/system");

    await expect(page.getByTestId("backup-stale")).toContainText(
      "The last successful backup is more than 48 hours old",
    );
    await expect(page.getByTestId("backup-unencrypted")).toContainText("Scheduled backups require encryption");
    await expect(page.getByTestId("backup-unencrypted")).toContainText("BACKUP_PASSPHRASE");

    const backups = page.getByRole("region", { name: "Backups" });
    await expect(backups.getByTestId("last-backup-status")).toHaveText("OK");
    await expect(backups.getByTestId("last-backup")).toContainText("(3 days ago)");
    await expect(backups).toContainText("18 MB");
    await expect(backups).toContainText("Daily 02:00 Asia/Singapore");

    const request = page.getByRole("region", { name: "This request" });
    await expect(request.getByTestId("client-ip")).toHaveText("127.0.0.1");
    await expect(request.getByTestId("proxy-trust")).toHaveText("Direct");
    await expect(request).toContainText("http");
    await expect(request).toContainText("None"); // no trusted proxies configured
  });

  test("only owners can open it", async ({ page }) => {
    await uiSignInOk(page, E2E.members.hr.email);
    await page.goto("/settings/system");
    await expect(page.getByTestId("system-error")).toBeVisible();
    // HR admins get no backup warning on Home either.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("home-backup-warning")).toHaveCount(0);
  });
});
