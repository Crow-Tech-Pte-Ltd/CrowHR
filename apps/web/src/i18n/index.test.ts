import { describe, expect, it } from "vitest";
import { loadLocale, preferredLocale, translate } from "./index.ts";

const catalogs = import.meta.glob<Record<string, string>>("./catalogs/*.json", { eager: true, import: "default" });
const translatedLocales = ["ms-SG", "ta-SG", "zh-SG"] as const;

function placeholders(message: string): string[] {
  return [...new Set(message.match(/\{[A-Za-z][A-Za-z0-9_]*\}/g))].sort();
}

describe("web localisation", () => {
  it("uses the first supported browser language and defaults to Singapore English", () => {
    expect(preferredLocale(["ja-JP", "zh-Hans-SG", "en"])).toBe("zh-SG");
    expect(preferredLocale(["ms-MY", "ta-SG"])).toBe("ms-SG");
    expect(preferredLocale(["ta-IN"])).toBe("ta-SG");
    expect(preferredLocale(["fr-FR"])).toBe("en-SG");
    expect(preferredLocale([])).toBe("en-SG");
  });

  it("keeps feature messages and their named placeholders present in every translated language", () => {
    const features = new Set(Object.keys(catalogs).map((file) => file.split("/").at(-1)?.split(".")[0]));
    expect(features.size).toBeGreaterThan(0);
    for (const feature of features) {
      const messages = translatedLocales.map((locale) => {
        const file = `./catalogs/${feature}.${locale}.json`;
        const dictionary = catalogs[file];
        expect(dictionary, file).toBeDefined();
        return dictionary ?? {};
      });
      const keys = Object.keys(messages[0] ?? {}).sort();
      expect(keys.length, feature).toBeGreaterThan(0);
      for (const [index, dictionary] of messages.entries()) {
        const locale = translatedLocales[index];
        expect(Object.keys(dictionary).sort(), `${feature} ${locale}`).toEqual(keys);
        for (const [source, translated] of Object.entries(dictionary)) {
          expect(translated.trim(), `${feature} ${locale}: ${source}`).not.toBe("");
          expect(placeholders(translated), `${feature} ${locale}: ${source}`).toEqual(placeholders(source));
        }
      }
    }
  });

  it("loads just the requested pack, falls back to English and preserves inserted values as text", async () => {
    await loadLocale("zh-SG");
    expect(translate("ta-SG", "company", "Unknown {name}", { name: "<A & B>" })).toBe("Unknown <A & B>");
    expect(translate("zh-SG", "company", "Missing details: {fields}.", { fields: "CPF" })).toBe("请填写：CPF。");
    expect(translate("en-SG", "company", "Missing details: {fields}.", { fields: "CPF" })).toBe(
      "Missing details: CPF.",
    );
  });
});
