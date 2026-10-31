import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";

/**
 * Replaces PGlite's large binaries in the worker bundle with gzip copies (`<file>.gz`), read by
 * packages/demo/src/pglite-assets.ts. Static hosts (Cloudflare Pages included) don't compress
 * `application/octet-stream`, and the filesystem bundle alone is 6 MB raw / 2 MB gzipped.
 */
const PGLITE_BINARY = /(^|\/)(pglite|initdb)-[\w-]+\.(wasm|data)$/;

export function precompressPgliteAssets(): Plugin {
  return {
    name: "crowhr-demo:precompress-pglite",
    apply: "build",
    generateBundle(_, bundle) {
      for (const [fileName, out] of Object.entries(bundle)) {
        if (out.type !== "asset" || !PGLITE_BINARY.test(fileName)) continue;
        const source = typeof out.source === "string" ? new TextEncoder().encode(out.source) : out.source;
        this.emitFile({ type: "asset", fileName: `${fileName}.gz`, source: gzipSync(source, { level: 9 }) });
        delete bundle[fileName];
      }
    },
  };
}
