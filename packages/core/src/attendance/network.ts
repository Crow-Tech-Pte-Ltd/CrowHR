/**
 * Location and network checks for punches (design decision 6). No dependencies: CIDR matching for
 * IPv4 and IPv6 with BigInt, and haversine distance on a spherical Earth.
 */

const EARTH_RADIUS_METRES = 6_371_008.8;

/** Great-circle distance in metres between two WGS84 points (haversine). */
export function distanceMetres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface ParsedIp {
  version: 4 | 6;
  value: bigint;
}

function parseIpv4(s: string): bigint | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let v = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    v = (v << 8n) | BigInt(n);
  }
  return v;
}

function parseIpv6(s: string): bigint | null {
  let text = s.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  // Embedded IPv4 tail (e.g. ::ffff:192.0.2.1) → two hex groups.
  const lastColon = text.lastIndexOf(":");
  if (text.slice(lastColon + 1).includes(".")) {
    const v4 = parseIpv4(text.slice(lastColon + 1));
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4 >> 16n) & 0xffffn).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...Array(fill).fill("0"), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  let v = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    v = (v << 16n) | BigInt(Number.parseInt(g, 16));
  }
  return v;
}

export function parseIp(s: string): ParsedIp | null {
  const text = s.trim();
  if (text.includes(":")) {
    const v = parseIpv6(text);
    if (v === null) return null;
    // IPv4-mapped (::ffff:a.b.c.d) compares as IPv4.
    if (v >> 32n === 0xffffn) return { version: 4, value: v & 0xffffffffn };
    return { version: 6, value: v };
  }
  const v4 = parseIpv4(text);
  return v4 === null ? null : { version: 4, value: v4 };
}

export interface Cidr {
  version: 4 | 6;
  network: bigint;
  prefix: number;
}

/** `203.0.113.0/24`, `2001:db8::/32`, or a single address (full-length prefix). Null when invalid. */
export function parseCidr(s: string): Cidr | null {
  const [addr, len, extra] = s.trim().split("/");
  if (!addr || extra !== undefined) return null;
  const ip = parseIp(addr);
  if (!ip) return null;
  const bits = ip.version === 4 ? 32 : 128;
  // An IPv4-mapped address written as IPv6 with a v6 prefix: convert the prefix.
  let prefix = len === undefined ? bits : Number(len);
  if (len !== undefined && !/^\d{1,3}$/.test(len)) return null;
  if (ip.version === 4 && addr.includes(":") && len !== undefined) prefix -= 96;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null;
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
  return { version: ip.version, network: ip.value & mask, prefix };
}

export function ipInCidr(ip: string, cidr: string | Cidr): boolean {
  const parsed = parseIp(ip);
  const range = typeof cidr === "string" ? parseCidr(cidr) : cidr;
  if (!parsed || !range || parsed.version !== range.version) return false;
  const bits = range.version === 4 ? 32 : 128;
  const mask = range.prefix === 0 ? 0n : ((1n << BigInt(range.prefix)) - 1n) << BigInt(bits - range.prefix);
  return (parsed.value & mask) === range.network;
}

export function ipAllowed(ip: string | null, ranges: readonly string[]): boolean {
  if (!ranges.length) return true;
  if (!ip) return false;
  return ranges.some((r) => ipInCidr(ip, r));
}
