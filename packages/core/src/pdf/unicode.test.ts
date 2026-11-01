import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPdf, finishPdf } from "./document.ts";

function textOf(bytes: Uint8Array, raster = false) {
  const dir = mkdtempSync(join(tmpdir(), "crowhr-unicode-"));
  try {
    const path = join(dir, "unicode.pdf");
    writeFileSync(path, bytes);
    if (raster) {
      const pgm = execFileSync("pdftoppm", ["-singlefile", "-r", "72", "-gray", path]);
      const header = pgm
        .subarray(0, 100)
        .toString("ascii")
        .match(/^P5\s+(\d+)\s+(\d+)\s+255\s/);
      if (!header) throw new Error("Expected a PGM raster");
      const width = Number(header[1]);
      let ink = 0;
      for (let y = 112; y < 144; y++)
        for (let x = 40; x < 110; x++) if ((pgm[header[0].length + y * width + x] ?? 255) < 128) ink++;
      expect(ink).toBeGreaterThan(100); // CJK outlines must actually paint, not merely have a ToUnicode map.
    }
    return execFileSync("pdftotext", [path, "-"], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true });
  }
}
const meta = { title: "Names", author: "Crow HR", createdAt: new Date("2026-10-31T00:00:00Z") };
describe("Unicode PDF names", () => {
  it("embeds and subsets Chinese and Tamil glyphs with readable text", async () => {
    const text = "王小明 ரவி Kumar";
    const c = await createPdf({ ...meta, text });
    c.text(text, 40, 700, { size: 24 });
    const bytes = await finishPdf(c);
    const extracted = textOf(bytes, true);
    expect(extracted).toContain("王小明");
    expect(extracted.normalize("NFC")).toContain("ரவி");
    expect(bytes.length).toBeLessThan(200_000);
    expect(c.missingGlyphs.size).toBe(0);
  });
  it("keeps Latin-only documents small and reports any still missing glyph", async () => {
    const c = await createPdf(meta);
    c.text("Payroll 🦄", 40, 700);
    expect(c.missingGlyphs.has("🦄")).toBe(true);
    const bytes = await finishPdf(c);
    expect(textOf(bytes)).toContain("Warning: unsupported characters");
    expect(bytes.length).toBeLessThan(200_000);
  });
});
