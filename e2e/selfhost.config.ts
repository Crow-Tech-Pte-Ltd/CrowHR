import { defineConfig, devices } from "@playwright/test";

/**
 * Runs e2e/setup.spec.ts against a real `docker compose` install started by e2e/self-host.sh
 * (no webServer: the containers are the server).
 */
export default defineConfig({
  testDir: ".",
  testMatch: /setup\.spec\.ts/,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.SELFHOST_URL ?? "http://127.0.0.1:18080",
    trace: "retain-on-failure",
  },
  outputDir: "../test-results/selfhost",
});
