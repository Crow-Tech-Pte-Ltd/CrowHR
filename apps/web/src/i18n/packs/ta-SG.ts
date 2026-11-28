export const messages = import.meta.glob<Record<string, string>>("../catalogs/*.ta-SG.json", {
  eager: true,
  import: "default",
});
