// Renders an SVG to a square PNG with the repo's Playwright Chromium.
// Usage: node design/app-icon/render.cjs IN.svg OUT.png SIZE
const fs = require("node:fs");
const { chromium } = require("@playwright/test");

(async () => {
  const [, , input, output, size = "1024"] = process.argv;
  const px = Number(size);
  const svg = fs.readFileSync(input, "utf8").replace(/width="\d+" height="\d+"/, `width="${px}" height="${px}"`);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: px, height: px } });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await page.screenshot({ path: output });
  } finally {
    await browser.close();
  }
})();
