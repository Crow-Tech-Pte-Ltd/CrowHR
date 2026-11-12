import { randomBytes } from "../crypto/tokens.ts";

/**
 * Demo companies (openspec change add-demo-companies): a server started with `DEMO_COMPANIES=1`
 * gives any visitor a private copy of the fictional sample company, signed in by picking a
 * person, deleted after `ttlHours`. The host builds this object (apps/server) and passes it as
 * `deps.demoCompanies`; without it every demo-company route answers 404.
 */
export interface DemoCompaniesDeps {
  /** Hours a demo company lives from the moment it is handed out (DEMO_COMPANY_TTL_HOURS, default 72). */
  ttlHours: number;
  /** Unclaimed copies kept ready (default 3). 0 = seed on demand only. */
  poolSize: number;
  /** Live demo companies at most, pool included (default 300). */
  maxLive: number;
  /** Starts per network (client IP; IPv6 /64) per clock hour (default 5). */
  hourlyLimitPerNetwork: number;
  /** Starts per network per UTC day (default 20). */
  dailyLimitPerNetwork: number;
  /** Bytes of uploads (receipts, documents, logo) one demo company may hold (default 25 MB). */
  uploadQuotaBytes: number;
  /**
   * Seeds one copy of the sample company into the app's own database and file store, inserting
   * the organisation with `slug`, `demoExpiresAt` and `demoClaimedAt` (the demo flag can only be
   * set on insert). Must leave nothing behind when it throws. Core calls it one at a time.
   */
  provision(input: DemoProvisionInput): Promise<{ orgId: string }>;
  /** Picker labels for the sample company's people, by account email; null for other people. */
  personaInfo?(email: string): DemoPersonaInfo | null;
}

export interface DemoProvisionInput {
  /** `demo-` + 12 base32 characters: the visitor's key to this copy. */
  slug: string;
  expiresAt: Date;
  /** Null for a pool copy; the hand-out time when seeded for a waiting visitor. */
  claimedAt: Date | null;
  /** "Today" for the copy's history (real time on a server). */
  now: Date;
}

export interface DemoPersonaInfo {
  /** owner, hr, payroll, manager, employee. */
  key: string;
  label: string;
  blurb: string;
  /** Position among the featured people (0 first). */
  order: number;
}

export const DEMO_COMPANY_DEFAULTS = {
  ttlHours: 72,
  poolSize: 3,
  maxLive: 300,
  hourlyLimitPerNetwork: 5,
  dailyLimitPerNetwork: 20,
  uploadQuotaBytes: 25 * 1024 * 1024,
} as const;

/** A pool copy that nobody claimed within this many hours is replaced (its history is "today"'s). */
export const POOL_COPY_MAX_AGE_HOURS = 24;

/** Expired demo companies deleted per scheduler tick. */
export const PURGE_BATCH = 5;

/** Message for every route a demo company refuses (design decision 7). */
export const NOT_IN_DEMO_COMPANY =
  "Not available in a demo company. Sign-in, security and email settings stay as they are, so the demo works for everyone the same way.";

/**
 * A demo company a visitor may use right now: the server offers demo companies, it was handed
 * out (pool copies are not usable before that) and it has not expired. Expired copies are
 * refused at once, before the sweep deletes them.
 */
export function isLiveDemoCompany(
  deps: { demoCompanies?: DemoCompaniesDeps },
  org: { demoExpiresAt: Date | null; demoClaimedAt: Date | null },
  now: Date,
): boolean {
  return !!deps.demoCompanies && !!org.demoExpiresAt && !!org.demoClaimedAt && org.demoExpiresAt > now;
}

/** Short names of demo companies: `demo-` and 12 characters of lower-case base32 (60 random bits). */
export const DEMO_SLUG_PATTERN = /^demo-[a-z2-7]{12}$/;

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export function newDemoSlug(): string {
  const bytes = randomBytes(12);
  return `demo-${Array.from(bytes, (b) => BASE32[b & 31]).join("")}`;
}

/**
 * The network a start counts against: the IPv4 address, or the /64 of an IPv6 address (one
 * household or office). `unknown` when the host can't tell the client's address.
 */
export function networkKey(ip: string | null): string {
  if (!ip) return "unknown";
  const text = ip.trim().toLowerCase();
  if (!text.includes(":")) return `v4:${text}`;
  const groups = expandIpv6(text);
  if (!groups) return `ip:${text}`;
  // IPv4-mapped (::ffff:a.b.c.d) counts as that IPv4 address.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [a, b] = [groups[6] as number, groups[7] as number];
    return `v4:${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return `v6:${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

function expandIpv6(text: string): number[] | null {
  let s = text;
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const parts = tail.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
    const [a, b, c, d] = parts as [number, number, number, number];
    s = `${s.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 2 && fill < 1)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => Number.parseInt(g, 16));
}
