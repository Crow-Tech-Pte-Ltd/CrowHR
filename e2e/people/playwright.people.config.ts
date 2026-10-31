import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PEOPLE_E2E_PORT ?? 3210);

/**
 * People e2e against the DEV-ONLY people server (packages/core/testing/people-dev-server.ts),
 * which fakes sign-in with personas until the identity workstream lands sessions.
 * Run: bun run --cwd apps/web build && bunx playwright test -c e2e/people/playwright.people.config.ts
 * Specs are named *.people.ts so the root config (real server, no sign-in yet) does not pick them up.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.people.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node packages/core/testing/people-dev-server.ts",
    cwd: "../..",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PORT: String(PORT) },
  },
});
