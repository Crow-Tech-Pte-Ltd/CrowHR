import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
/** A second, fresh server for the first-run setup wizard (it must start without an organisation). */
const SETUP_PORT = PORT + 1;
/** Fixed one-time code for the setup server only (SETUP_CODE is meant for automated installs). */
export const E2E_SETUP_CODE = "ACDE-FGHJ-KMNP-QRTU";
const E2E_SECRET_KEY = "ZTJlLW9ubHktdGhyb3dhd2F5LWtleS0zMi1ieXRlcyE";

/**
 * @playwright/test is pinned to 1.64.1, which uses Chromium build 1248 — the
 * build already present in ~/.cache/ms-playwright locally, so nothing is
 * downloaded. CI installs it with `playwright install chromium`.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /setup\.spec\.ts/ },
    {
      name: "setup",
      testMatch: /setup\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${SETUP_PORT}` },
    },
  ],
  globalSetup: "./e2e/global-setup.ts",
  webServer: [
    {
      // Serves the built web app (`bun run build` first; `bun run e2e` does both). The seed step
      // creates the fictional organisation and members through the normal schema (no backdoor).
      command: process.env.DATABASE_URL
        ? "node e2e/seed.ts && node apps/server/src/main.ts"
        : "rm -rf test-results/e2e-db && node e2e/seed.ts && node apps/server/src/main.ts",
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        // CI points this at a real Postgres service; locally PGlite needs no server.
        DATABASE_URL: process.env.DATABASE_URL ?? "pglite:./test-results/e2e-db",
        ...(process.env.SHOTS_DIR ? { SHOTS_DIR: process.env.SHOTS_DIR } : {}),
        HOST: "127.0.0.1",
        PORT: String(PORT),
        DATA_DIR: "./test-results/data",
        FILE_STORAGE_DIR: "./test-results/files",
        LOG_LEVEL: "warn",
        PUBLIC_URL: `http://127.0.0.1:${PORT}`,
        // Fixed throwaway key for e2e only.
        CROWHR_SECRET_KEY: E2E_SECRET_KEY,
      },
    },
    {
      // First-run setup: always a fresh in-memory database, because setup creates the organisation.
      command: "node apps/server/src/main.ts",
      url: `http://127.0.0.1:${SETUP_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: "pglite:memory",
        HOST: "127.0.0.1",
        PORT: String(SETUP_PORT),
        DATA_DIR: "./test-results/setup-data",
        LOG_LEVEL: "warn",
        PUBLIC_URL: `http://127.0.0.1:${SETUP_PORT}`,
        CROWHR_SECRET_KEY: E2E_SECRET_KEY,
        SETUP_CODE: E2E_SETUP_CODE,
      },
    },
  ],
});
