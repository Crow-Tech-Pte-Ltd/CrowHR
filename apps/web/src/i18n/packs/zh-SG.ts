export const messages = import.meta.glob<Record<string, string>>("../catalogs/*.zh-SG.json", {
  eager: true,
  import: "default",
});
