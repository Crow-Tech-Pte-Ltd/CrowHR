import { expect, test } from "@playwright/test";
import { waitForDemo } from "./helpers.ts";

test.skip(process.env.DEMO_PERFORMANCE !== "1", "Set DEMO_PERFORMANCE=1 for three isolated first-visit measurements.");
for (let sample = 1; sample <= 3; sample++) {
  test(`first visit timing ${sample}`, async ({ page }) => {
    await page.goto("/");
    const boot = await waitForDemo(page);
    expect(boot.timings.seeded).toBe(true);
    console.warn(`DEMO_PERFORMANCE ${JSON.stringify({ sample, ...boot })}`);
  });
}
