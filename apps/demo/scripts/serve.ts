/**
 * Static preview server for the built demo (or the combined site), with Cloudflare Pages'
 * `_headers`/`_redirects` behaviour (pages-rules.ts) and gzip for compressible types, so local
 * runs and the e2e see the same CSP, rewrites and 404s as production. Local only: binds 127.0.0.1.
 *
 *   node scripts/serve.ts [dir]      (PORT, default 5181)
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { headersFor, matchRedirect, parseHeaders, parseRedirects } from "./pages-rules.ts";

const root = process.env.DEMO_E2E_DIST ?? process.argv[2] ?? fileURLToPath(new URL("../dist", import.meta.url));
const port = Number(process.env.PORT ?? 5181);
const read = (f: string) => (existsSync(join(root, f)) ? readFileSync(join(root, f), "utf8") : "");
const headerRules = parseHeaders(read("_headers"));
const redirectRules = parseRedirects(read("_redirects"));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".gz": "application/gzip",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|wasm|xml)|image\/svg)/;
const gzCache = new Map<string, Buffer>();

function fileFor(path: string): string | null {
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, "");
  const candidates = [rel, join(rel, "index.html"), `${rel}.html`];
  for (const c of candidates) {
    const f = join(root, c);
    if (f.startsWith(root) && existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  let path = decodeURIComponent(url.pathname);
  let status = 200;
  const redirect = matchRedirect(redirectRules, path);
  if (redirect && redirect.status !== 200) {
    res.writeHead(redirect.status, { location: redirect.to });
    res.end();
    return;
  }
  if (redirect) path = redirect.to;
  let file = fileFor(path);
  if (!file) {
    status = 404;
    // Nearest 404.html up the tree, like Pages (the docs ship their own under /docs).
    const parts = path.split("/").filter(Boolean);
    while (!file && parts.length >= 0) {
      const candidate = join(root, ...parts, "404.html");
      if (existsSync(candidate)) file = candidate;
      if (!parts.length) break;
      parts.pop();
    }
  }
  const headers: Record<string, string> = Object.fromEntries(headersFor(headerRules, path));
  if (!file) {
    res.writeHead(404, { ...headers, "content-type": "text/plain" });
    res.end("Not found");
    return;
  }
  let body: Buffer = readFileSync(file);
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  headers["content-type"] = type;
  if (COMPRESSIBLE.test(type) && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) {
    const key = `${file}:${statSync(file).mtimeMs}`;
    const cached = gzCache.get(key) ?? gzipSync(body, { level: 6 });
    gzCache.set(key, cached);
    body = cached;
    headers["content-encoding"] = "gzip";
    headers.vary = "accept-encoding";
  }
  headers["content-length"] = String(body.length);
  res.writeHead(status, headers);
  res.end(req.method === "HEAD" ? undefined : body);
}).listen(port, "127.0.0.1", () => {
  console.warn(`Crow HR demo preview (local only) on http://127.0.0.1:${port} from ${root}`);
});
