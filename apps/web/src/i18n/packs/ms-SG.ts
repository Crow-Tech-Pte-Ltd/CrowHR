export const messages = import.meta.glob<Record<string, string>>("../catalogs/*.ms-SG.json", {
  eager: true,
  import: "default",
});
