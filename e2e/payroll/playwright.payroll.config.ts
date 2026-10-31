import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PAYROLL_E2E_PORT ?? 3220);

/**
 * Payroll e2e against the DEV-ONLY payroll server (packages/core/testing/payroll-dev-server.ts):
 * the real app on in-memory PGlite with the fictional café group and its September/October payroll.
 * Run: bun run --cwd apps/web build && bunx playwright test -c e2e/payroll/playwright.payroll.config.ts
 * Specs are named *.payroll.ts so the root config does not pick them up.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.payroll.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure", acceptDownloads: true },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node packages/core/testing/payroll-dev-server.ts",
    cwd: "../..",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: { PORT: String(PORT) },
  },
});
