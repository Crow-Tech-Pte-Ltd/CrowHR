import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveTheme, THEME_KEY } from "./theme.ts";

describe("theme", () => {
  it("System follows the device; Light and Dark override it", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("the pre-paint script reads the same key, and the demo ships the same script", () => {
    const web = readFileSync(new URL("../../public/theme.js", import.meta.url), "utf8");
    const demo = readFileSync(new URL("../../../demo/public/theme.js", import.meta.url), "utf8");
    expect(web).toContain(`localStorage.getItem("${THEME_KEY}")`);
    expect(demo).toBe(web);
  });

  it("both index pages load the pre-paint script in the head, after the theme-color meta tag", () => {
    for (const page of ["../../index.html", "../../../demo/index.html"]) {
      const html = readFileSync(new URL(page, import.meta.url), "utf8");
      const head = html.slice(0, html.indexOf("</head>"));
      expect(head).toContain('<script src="/theme.js"></script>');
      expect(head.indexOf('name="theme-color"')).toBeLessThan(head.indexOf("/theme.js"));
    }
  });
});
