import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.WS6B_E2E_PORT ?? 3240);

/**
 * Reports and documents e2e (WS6b) against the DEV-ONLY documents server (packages/core/testing/documents-dev-server.ts):
 * the real app on in-memory PGlite with the café group, its payroll history and a new hire.
 * Run: bun run --cwd apps/web build && bunx playwright test -c e2e/ws6b/playwright.ws6b.config.ts
 * Specs are named *.ws6b.ts so the root config does not pick them up.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.ws6b.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure", acceptDownloads: true },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node packages/core/testing/documents-dev-server.ts",
    cwd: "../..",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: { PORT: String(PORT) },
  },
});
