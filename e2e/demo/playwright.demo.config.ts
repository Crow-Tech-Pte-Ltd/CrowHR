import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.DEMO_E2E_PORT ?? 5181);

/**
 * Public demo e2e against the BUILT static demo (apps/demo/dist), served by the local preview
 * server that applies Cloudflare Pages' _headers (CSP) and _redirects. No backend exists: every
 * API call is answered by the in-browser worker. Each test gets a fresh browser context, so a
 * fresh IndexedDB: the first load migrates and seeds.
 *
 *   bun run --cwd apps/demo build && bunx playwright test -c e2e/demo/playwright.demo.config.ts
 *
 * Specs are named *.demo.ts so the root config does not pick them up.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.demo.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: "list",
  use: {
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    acceptDownloads: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node apps/demo/scripts/serve.ts apps/demo/dist",
    cwd: "../..",
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(PORT) },
  },
});
