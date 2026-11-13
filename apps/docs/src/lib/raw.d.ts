/** Vite imports a file as a string with `?raw` (used for the AI setup prompt). */
declare module "*.md?raw" {
  const text: string;
  export default text;
}
