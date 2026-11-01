import initdbWasmUrl from "pglite-dist/initdb.wasm?url";
import pgliteDataUrl from "pglite-dist/pglite.data?url";
import pgliteWasmUrl from "pglite-dist/pglite.wasm?url";

/**
 * PGlite's three large files (Postgres as WebAssembly, initdb, and the filesystem bundle with
 * Postgres's share/ files, ~15 MB together). The demo build stores them gzip-compressed
 * (`<file>.gz`, see apps/demo/scripts/precompress.ts) because static hosts don't compress
 * `application/octet-stream`; here they are fetched in parallel and decompressed with the
 * browser's DecompressionStream while they download (the WebAssembly compiles as it streams), then
 * handed to PGlite, so it downloads nothing itself. Without a `.gz` (Vite dev server), the plain
 * file is used.
 */
async function open(url: string, type: string): Promise<Response> {
  const gz = await fetch(`${url}.gz`).catch(() => null);
  if (gz?.ok && gz.body) {
    // A host that sends `Content-Encoding: gzip` for .gz files has had the browser decode it already.
    const body = gz.headers.get("content-encoding") ? gz.body : gz.body.pipeThrough(new DecompressionStream("gzip"));
    return new Response(body, { headers: { "content-type": type } });
  }
  const plain = await fetch(url);
  if (!plain.ok) throw new Error(`Couldn't download ${url} (${plain.status}).`);
  return plain;
}

export async function pgliteAssets(): Promise<{
  pgliteWasmModule: WebAssembly.Module;
  fsBundle: Blob;
}> {
  const [wasm, data] = await Promise.all([
    open(pgliteWasmUrl, "application/wasm").then((r) => WebAssembly.compileStreaming(r)),
    open(pgliteDataUrl, "application/octet-stream").then((r) => r.blob()),
  ]);
  return { pgliteWasmModule: wasm, fsBundle: data };
}

let initdb: Promise<WebAssembly.Module> | undefined;
/** Snapshot restores and persistent opens skip initdb entirely; download it only for fallback. */
export function initdbAsset() {
  initdb ??= open(initdbWasmUrl, "application/wasm").then((r) => WebAssembly.compileStreaming(r));
  return initdb;
}
