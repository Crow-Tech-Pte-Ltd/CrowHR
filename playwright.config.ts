import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
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
      // The shell smoke tests run without an organisation; the setup redirect is covered by e2e/setup.spec.ts.
      SETUP_GATE: "false",
      LOG_LEVEL: "warn",
      PUBLIC_URL: `http://127.0.0.1:${PORT}`,
      // Fixed throwaway key for e2e only.
      CROWHR_SECRET_KEY: "ZTJlLW9ubHktdGhyb3dhd2F5LWtleS0zMi1ieXRlcyE",
    },
  },
});
