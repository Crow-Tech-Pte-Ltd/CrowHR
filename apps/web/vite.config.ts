import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** index.html and the module it loads, src/main.tsx. */
const ENTRY = /[\\/]apps[\\/]web[\\/](index\.html|src[\\/]main\.tsx)$/;

/**
 * Chunks for the production build. Without these groups the bundler emits one file per shared
 * module: ~50 small files preloaded by index.html, and ~45 more before Home can render.
 * `?tsr-split` is how the TanStack Router plugin names a route's lazily loaded part.
 */
const chunkGroups = [
  // Everything index.html loads anyway: React, the router, the route tree, the loading screen.
  // Not main.tsx itself: it awaits the monitoring SDK's chunk, which imports this one.
  { name: "app", tags: ["$initial" as const], test: (id: string) => !ENTRY.test(id), priority: 4 },
  // The sign-in screens and what they use (form fields, the reset-password dialog).
  { name: "auth", test: /[\\/]src[\\/]routes[\\/]sign-in\.[^\\/]*\?tsr-split/, priority: 3 },
  // The signed-in shell (sidebar, menus, tooltips, toasts, ⌘K): every signed-in page needs it.
  { name: "shell", test: /[\\/]src[\\/]routes[\\/]_app\.tsx\?tsr-split/, priority: 2 },
  // Icons used on three or more screens, instead of one tiny file per icon.
  { name: "icons", test: /[\\/]lucide-react[\\/]/, minShareCount: 3, priority: 1 },
];

/**
 * Fails the build if a chunk group stopped matching (e.g. after a router plugin upgrade), or if
 * another chunk imports the entry chunk: main.tsx has a top-level await on a dynamic import, so
 * that import would wait for the entry and the entry for it, and the app would never render.
 */
function checkChunkGroups(): Plugin {
  return {
    name: "crowhr:check-chunk-groups",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).flatMap((file) => (file.type === "chunk" ? [file] : []));
      const names = new Set(chunks.map((chunk) => chunk.name));
      const missing = chunkGroups.filter((group) => !names.has(group.name)).map((group) => group.name);
      if (missing.length)
        this.error(`No "${missing.join('", "')}" chunk was built: update chunkGroups in vite.config.ts.`);
      const entry = chunks.find((chunk) => chunk.isEntry);
      if (!entry || !Object.keys(entry.modules).some((id) => ENTRY.test(id)))
        this.error("main.tsx is not in the entry chunk: update ENTRY in vite.config.ts.");
      const importers = chunks.filter((chunk) => [...chunk.imports, ...chunk.dynamicImports].includes(entry.fileName));
      if (importers.length)
        this.error(
          `${importers.map((chunk) => chunk.fileName).join(", ")} import the entry chunk: keep main.tsx out of chunkGroups.`,
        );
    },
  };
}

/**
 * Writes `.br` and `.gz` copies beside each compressible asset, which apps/server sends to browsers
 * that accept them (`serveStatic({ precompressed: true })`). Installs without a compressing reverse
 * proxy then send about a third of the bytes; compressing once at build time also costs the server
 * nothing per request. Source maps are left alone (the Docker image drops them).
 */
function precompressAssets(): Plugin {
  const brotli = promisify(brotliCompress);
  const gz = promisify(gzip);
  let outDir = "dist";
  return {
    name: "crowhr:precompress-assets",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async writeBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => f.startsWith("assets/") && /\.(js|css|svg|json|txt)$/.test(f));
      await Promise.all(
        files.map(async (file) => {
          const path = join(outDir, file);
          const body = await readFile(path);
          if (body.length < 1024) return;
          await writeFile(`${path}.br`, await brotli(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
          await writeFile(`${path}.gz`, await gz(body, { level: 9 }));
        }),
      );
    },
  };
}

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    checkChunkGroups(),
    precompressAssets(),
  ],
  server: {
    port: 5173,
    strictPort: true,
    // `bun run dev` starts apps/server on its default port 8080 alongside Vite.
    proxy: { "/api": "http://127.0.0.1:8080" },
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 700,
    rolldownOptions: { output: { codeSplitting: { groups: chunkGroups } } },
  },
});
