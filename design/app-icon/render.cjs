// Renders an SVG to a square PNG with the repo's Playwright Chromium.
// Usage: node design/app-icon/render.cjs IN.svg OUT.png SIZE|WIDTHxHEIGHT
const fs = require("node:fs");
const { chromium } = require("@playwright/test");

(async () => {
  const [, , input, output, size = "1024"] = process.argv;
  const [width, height = width] = size.split("x").map(Number);
  const svg = fs
    .readFileSync(input, "utf8")
    .replace(/width="\d+" height="\d+"/, `width="${width}" height="${height}"`);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await page.screenshot({ path: output });
  } finally {
    await browser.close();
  }
})();
