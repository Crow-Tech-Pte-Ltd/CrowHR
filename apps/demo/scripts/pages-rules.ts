/**
 * The subset of Cloudflare Pages' `_headers` and `_redirects` semantics the demo uses, so the
 * local preview server (and the e2e run against it) behaves like hr.crow.sg will:
 * - `_headers`: blocks of `path pattern` + indented `Name: value` lines; `*` matches any
 *   characters; every matching block applies in file order; `! Name` removes a header set by
 *   an earlier block.
 * - `_redirects`: `from to [status]`, first match wins; `*` in `from` binds `:splat`; status
 *   200 rewrites (serves `to`), 301/302 redirect.
 */
export interface HeaderRule {
  pattern: string;
  set: [string, string][];
  detach: string[];
}

export interface RedirectRule {
  from: string;
  to: string;
  status: number;
}

const toRegex = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "(.*)")}$`);

export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      current = { pattern: raw.trim(), set: [], detach: [] };
      rules.push(current);
      continue;
    }
    if (!current) throw new Error(`Header line before any path: ${raw}`);
    const line = raw.trim();
    if (line.startsWith("!")) {
      current.detach.push(line.slice(1).trim().toLowerCase());
      continue;
    }
    const i = line.indexOf(":");
    if (i <= 0) throw new Error(`Bad header line: ${raw}`);
    current.set.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  return rules;
}

export function headersFor(rules: readonly HeaderRule[], path: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rule of rules) {
    if (!toRegex(rule.pattern).test(path)) continue;
    for (const name of rule.detach) out.delete(name);
    for (const [name, value] of rule.set) {
      const key = name.toLowerCase();
      out.set(key, out.has(key) ? `${out.get(key)}, ${value}` : value);
    }
  }
  return out;
}

export function parseRedirects(text: string): RedirectRule[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [from, to, status] = l.split(/\s+/);
      if (!from || !to) throw new Error(`Bad redirect line: ${l}`);
      return { from, to, status: status ? Number(status) : 302 };
    });
}

export function matchRedirect(rules: readonly RedirectRule[], path: string): { to: string; status: number } | null {
  for (const rule of rules) {
    const m = toRegex(rule.from).exec(path);
    if (m) return { to: rule.to.replace(":splat", m[1] ?? ""), status: rule.status };
  }
  return null;
}
