import { BlockList, isIP } from "node:net";

/**
 * Reverse-proxy trust (self-hosting spec "Reverse proxy trust").
 *
 * The app serves plain HTTP. `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`
 * are honoured only when the direct TCP peer is listed in `TRUSTED_PROXIES`. Everything else
 * (cookie security, generated links) derives from `PUBLIC_URL`, never from request headers.
 */

/** Shorthands accepted in TRUSTED_PROXIES, so Docker users need not know their bridge subnet. */
export const PROXY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  loopback: ["127.0.0.0/8", "::1/128"],
  // RFC 1918 + IPv6 unique-local + loopback: covers Docker bridge networks and LAN proxies.
  private: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7", "127.0.0.0/8", "::1/128"],
};

export interface TrustedProxies {
  /** Normalised entries as written (aliases expanded), for diagnostics. */
  readonly entries: readonly string[];
  contains(address: string | null | undefined): boolean;
}

export type ParseResult = { ok: true; value: TrustedProxies } | { ok: false; invalid: string[] };

/** Trusts nobody: the default when TRUSTED_PROXIES is empty. */
export const NO_TRUSTED_PROXIES: TrustedProxies = { entries: [], contains: () => false };

/** `::ffff:203.0.113.9` → `203.0.113.9`; strips IPv6 zone ids; returns null for non-IPs. */
export function normaliseIp(address: string | null | undefined): string | null {
  if (!address) return null;
  let a = address.trim();
  if (a.startsWith("[") && a.endsWith("]")) a = a.slice(1, -1);
  const zone = a.indexOf("%");
  if (zone !== -1) a = a.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(a);
  if (mapped?.[1]) a = mapped[1];
  return isIP(a) ? a.toLowerCase() : null;
}

/** Parses a comma-separated list of IPs, CIDRs and the aliases `loopback` / `private`. */
export function parseTrustedProxies(raw: string | undefined): ParseResult {
  const list = new BlockList();
  const entries: string[] = [];
  const invalid: string[] = [];
  const tokens = (raw ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const add = (token: string): boolean => {
    const [addr, prefixText, extra] = token.split("/");
    if (extra !== undefined || !addr) return false;
    const ip = normaliseIp(addr);
    if (!ip) return false;
    const family = isIP(ip) === 4 ? "ipv4" : "ipv6";
    if (prefixText === undefined) {
      list.addAddress(ip, family);
      entries.push(ip);
      return true;
    }
    if (!/^\d{1,3}$/.test(prefixText)) return false;
    const prefix = Number(prefixText);
    if (prefix > (family === "ipv4" ? 32 : 128)) return false;
    list.addSubnet(ip, prefix, family);
    entries.push(`${ip}/${prefix}`);
    return true;
  };
  for (const token of tokens) {
    const alias = PROXY_ALIASES[token.toLowerCase()];
    if (alias) {
      for (const cidr of alias) add(cidr);
    } else if (!add(token)) {
      invalid.push(token);
    }
  }
  if (invalid.length) return { ok: false, invalid };
  return {
    ok: true,
    value: {
      entries,
      contains(address) {
        const ip = normaliseIp(address);
        if (!ip || entries.length === 0) return false;
        return list.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
      },
    },
  };
}

export interface ClientInfo {
  /** Best-known client IP: the TCP peer, or the right-most untrusted X-Forwarded-For hop. */
  ip: string | null;
  /** Direct TCP peer (the proxy, when there is one). */
  peerIp: string | null;
  /** Request scheme as seen by the client: X-Forwarded-Proto from a trusted proxy, else the socket's. */
  scheme: "http" | "https";
  /** Host the client asked for: X-Forwarded-Host from a trusted proxy, else Host. */
  host: string | null;
  /** True when the peer is a trusted proxy (forwarded headers were honoured). */
  viaTrustedProxy: boolean;
  /** True when forwarded headers were present but ignored because the peer is not trusted. */
  ignoredForwardedHeaders: boolean;
}

export interface ResolveClientInput {
  peer: string | null | undefined;
  /** Scheme of the socket itself (always `http` for this server). */
  socketScheme?: "http" | "https";
  header(name: string): string | undefined;
}

const lastListValue = (value: string | undefined) => {
  if (!value) return undefined;
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[parts.length - 1];
};

/**
 * Computes the client IP and scheme once per request.
 * - Untrusted peer: the peer is the client and every X-Forwarded-* header is ignored.
 * - Trusted peer: walk X-Forwarded-For from the right, skipping trusted proxies; the first
 *   untrusted address is the client (a client can prepend fake hops, never append them).
 */
export function resolveClient(input: ResolveClientInput, trusted: TrustedProxies): ClientInfo {
  const peerIp = normaliseIp(input.peer);
  const socketScheme = input.socketScheme ?? "http";
  const xff = input.header("x-forwarded-for");
  const xfp = input.header("x-forwarded-proto");
  const xfh = input.header("x-forwarded-host");
  const hasForwarded = Boolean(xff || xfp || xfh);
  const host = input.header("host") ?? null;

  if (!peerIp || !trusted.contains(peerIp)) {
    return {
      ip: peerIp,
      peerIp,
      scheme: socketScheme,
      host,
      viaTrustedProxy: false,
      ignoredForwardedHeaders: hasForwarded,
    };
  }

  let ip: string | null = peerIp;
  if (xff) {
    const hops = xff
      .split(",")
      .map((h) => normaliseIp(h))
      .filter((h): h is string => h !== null);
    let candidate: string | null = null;
    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = hops[i] as string;
      candidate = hop;
      if (!trusted.contains(hop)) break;
    }
    if (candidate) ip = candidate;
  }
  const proto = lastListValue(xfp)?.toLowerCase();
  const scheme = proto === "https" || proto === "http" ? proto : socketScheme;
  return {
    ip,
    peerIp,
    scheme,
    host: lastListValue(xfh) ?? host,
    viaTrustedProxy: true,
    ignoredForwardedHeaders: false,
  };
}
