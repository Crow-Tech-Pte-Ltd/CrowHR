/**
 * A tiny cookie jar for the in-browser API. Browsers never let script set a `Cookie` request
 * header or read a `Set-Cookie` response header (both are forbidden names), so cookies cannot
 * travel between the page and an API that runs in a worker. The worker keeps them here instead
 * and replays them on the next request, exactly like a browser would for a same-origin server.
 * Only what core uses is implemented: name, value, Path, Max-Age and Expires. HttpOnly holds by
 * construction (page script never sees this jar); Secure and SameSite are irrelevant because
 * every request is same-origin and never touches the network.
 */
export interface StoredCookie {
  name: string;
  value: string;
  path: string;
  /** Epoch ms, or null for a session cookie (kept until the jar is cleared). */
  expiresAt: number | null;
}

export interface CookieJar {
  /** Applies one `Set-Cookie` header value. */
  set(header: string, now: number): void;
  /** The `Cookie` header for a request path, or null when no cookie applies. */
  header(path: string, now: number): string | null;
  get(name: string): string | null;
  clear(): void;
  toJSON(): StoredCookie[];
}

function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

export function parseSetCookie(header: string, now: number): StoredCookie | null {
  const [pair, ...attrs] = header.split(";");
  const eq = pair?.indexOf("=") ?? -1;
  if (!pair || eq <= 0) return null;
  const cookie: StoredCookie = {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim(),
    path: "/",
    expiresAt: null,
  };
  let maxAge: number | null = null;
  for (const attr of attrs) {
    const i = attr.indexOf("=");
    const key = (i < 0 ? attr : attr.slice(0, i)).trim().toLowerCase();
    const val = i < 0 ? "" : attr.slice(i + 1).trim();
    if (key === "path" && val.startsWith("/")) cookie.path = val;
    else if (key === "max-age" && /^-?\d+$/.test(val)) maxAge = Number(val);
    else if (key === "expires") {
      const at = Date.parse(val);
      if (!Number.isNaN(at)) cookie.expiresAt = at;
    }
  }
  // Max-Age wins over Expires (RFC 6265 §5.3).
  if (maxAge !== null) cookie.expiresAt = maxAge <= 0 ? 0 : now + maxAge * 1000;
  return cookie;
}

export function createCookieJar(initial: readonly StoredCookie[] = []): CookieJar {
  const cookies = new Map<string, StoredCookie>();
  const key = (c: Pick<StoredCookie, "name" | "path">) => `${c.path}\u0000${c.name}`;
  for (const c of initial) cookies.set(key(c), { ...c });
  const live = (now: number) => {
    for (const [k, c] of cookies) if (c.expiresAt !== null && c.expiresAt <= now) cookies.delete(k);
    return [...cookies.values()];
  };
  return {
    set(header, now) {
      const cookie = parseSetCookie(header, now);
      if (!cookie) return;
      if (cookie.expiresAt !== null && cookie.expiresAt <= now) cookies.delete(key(cookie));
      else cookies.set(key(cookie), cookie);
    },
    header(path, now) {
      const matching = live(now)
        .filter((c) => pathMatches(c.path, path))
        // Longer paths first, as browsers order them.
        .sort((a, b) => b.path.length - a.path.length);
      return matching.length ? matching.map((c) => `${c.name}=${c.value}`).join("; ") : null;
    },
    get(name) {
      for (const c of cookies.values()) if (c.name === name) return c.value;
      return null;
    },
    clear() {
      cookies.clear();
    },
    toJSON() {
      return [...cookies.values()].map((c) => ({ ...c }));
    },
  };
}
