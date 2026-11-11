import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { demoDataVersion } from "./scripts/data-version.ts";
import { forbidServerModules } from "./scripts/forbidden-modules.ts";
import { precompressPgliteAssets } from "./scripts/precompress.ts";
import { preloadApp } from "./scripts/preload-app.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// PGlite's binaries, imported by URL in packages/demo/src/pglite-assets.ts (not in its exports map).
const pgliteDist = dirname(createRequire(here("../../packages/demo/package.json")).resolve("@electric-sql/pglite"));

/**
 * The demo is apps/web, unchanged, plus a boot script (src/main.tsx) that starts the in-browser
 * API worker before the web app's own entry runs.
 *
 * Routes are not code-split here, on purpose: the whole app downloads (modulepreload) while the
 * database boots, so every screen opens at once afterwards. Splitting them (TanStack's code
 * splitter needs its route generator running, which apps/web owns) measured slower: on a
 * throttled 4G-like connection, Home took ~0.9 s instead of ~0.3 s after picking a persona, and
 * the first boot was no faster.
 */
export default defineConfig({
  plugins: [react(), preloadApp(), forbidServerModules()],
  define: {
    __DEMO_DATA_VERSION__: JSON.stringify(demoDataVersion()),
  },
  // PGlite ships its own WASM and data files, resolved with `new URL(…, import.meta.url)`.
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  resolve: {
    alias: [
      { find: "pglite-dist", replacement: pgliteDist },
      // apps/web lazy-loads the Sentry SDK from here only when the server enables it; the demo never does.
      { find: /^\.\/monitoring-sdk\.ts$/, replacement: here("src/monitoring-off.ts") },
    ],
  },
  worker: { format: "es", plugins: () => [forbidServerModules(), precompressPgliteAssets()] },
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
  build: {
    sourcemap: false,
    // The web app is one chunk on purpose (see above): ~1.1 MB, ~300 kB gzip.
    chunkSizeWarningLimit: 1200,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { main: here("index.html"), "demo-sw": here("../../packages/demo/src/service-worker.ts") },
      output: {
        // The service worker must live at the site root to control `/`, under a stable name.
        entryFileNames: (chunk) => (chunk.name === "demo-sw" ? "demo-sw.js" : "assets/[name]-[hash].js"),
      },
    },
  },
});
