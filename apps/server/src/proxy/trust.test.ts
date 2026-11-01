import { describe, expect, it } from "vitest";
import { normaliseIp, parseTrustedProxies, resolveClient, type TrustedProxies } from "./trust.ts";

function trust(raw: string): TrustedProxies {
  const parsed = parseTrustedProxies(raw);
  if (!parsed.ok) throw new Error(`invalid: ${parsed.invalid.join(",")}`);
  return parsed.value;
}

const headers = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()];

describe("parseTrustedProxies", () => {
  it("accepts IPv4, IPv6, CIDRs and aliases", () => {
    const t = trust("10.0.0.1, 172.16.0.0/12, 2001:db8::/32, ::1, loopback");
    expect(t.contains("10.0.0.1")).toBe(true);
    expect(t.contains("10.0.0.2")).toBe(false);
    expect(t.contains("172.18.0.5")).toBe(true);
    expect(t.contains("172.32.0.1")).toBe(false);
    expect(t.contains("2001:db8:1::5")).toBe(true);
    expect(t.contains("2001:db9::1")).toBe(false);
    expect(t.contains("127.0.0.1")).toBe(true);
  });

  it("matches IPv4-mapped IPv6 peers against IPv4 ranges", () => {
    const t = trust("172.16.0.0/12");
    expect(t.contains("::ffff:172.18.0.5")).toBe(true);
    expect(t.contains("::ffff:8.8.8.8")).toBe(false);
  });

  it("the private alias covers Docker bridge networks and unique-local IPv6", () => {
    const t = trust("private");
    for (const ip of ["172.17.0.1", "192.168.1.20", "10.1.2.3", "fd00::1", "127.0.0.1"]) {
      expect(t.contains(ip)).toBe(true);
    }
    expect(t.contains("203.0.113.9")).toBe(false);
  });

  it("is empty (trusts nobody) by default", () => {
    const t = trust("");
    expect(t.entries).toEqual([]);
    expect(t.contains("127.0.0.1")).toBe(false);
  });

  it("reports every invalid entry", () => {
    const parsed = parseTrustedProxies("10.0.0.1, 10.0.0.0/33, caddy, 1.2.3.4/8/1, ::1/129, 300.1.1.1");
    expect(parsed).toEqual({ ok: false, invalid: ["10.0.0.0/33", "caddy", "1.2.3.4/8/1", "::1/129", "300.1.1.1"] });
  });
});

describe("normaliseIp", () => {
  it("unwraps mapped addresses, brackets and zones", () => {
    expect(normaliseIp("::ffff:10.0.0.1")).toBe("10.0.0.1");
    expect(normaliseIp("[::1]")).toBe("::1");
    expect(normaliseIp("fe80::1%eth0")).toBe("fe80::1");
    expect(normaliseIp("not-an-ip")).toBeNull();
    expect(normaliseIp(undefined)).toBeNull();
  });
});

describe("resolveClient", () => {
  it("ignores spoofed forwarded headers from an untrusted peer", () => {
    const info = resolveClient(
      {
        peer: "198.51.100.7",
        header: headers({ "x-forwarded-for": "1.2.3.4", "x-forwarded-proto": "https", host: "hr.acme.sg" }),
      },
      trust(""),
    );
    expect(info).toEqual({
      ip: "198.51.100.7",
      peerIp: "198.51.100.7",
      scheme: "http",
      host: "hr.acme.sg",
      viaTrustedProxy: false,
      ignoredForwardedHeaders: true,
    });
  });

  it("behind Caddy: records the real client from a trusted peer", () => {
    const info = resolveClient(
      {
        peer: "::ffff:172.18.0.5",
        header: headers({
          "x-forwarded-for": "203.0.113.9",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "hr.acme.sg",
        }),
      },
      trust("172.16.0.0/12"),
    );
    expect(info).toMatchObject({ ip: "203.0.113.9", peerIp: "172.18.0.5", scheme: "https", host: "hr.acme.sg" });
    expect(info.viaTrustedProxy).toBe(true);
  });

  it("uses the right-most untrusted hop, so a client cannot inject an address", () => {
    const info = resolveClient(
      { peer: "10.0.0.2", header: headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.3" }) },
      trust("10.0.0.0/8"),
    );
    expect(info.ip).toBe("203.0.113.9");
  });

  it("falls back to the left-most hop when every hop is trusted", () => {
    const info = resolveClient(
      { peer: "10.0.0.2", header: headers({ "x-forwarded-for": "10.0.0.9, 10.0.0.3" }) },
      trust("10.0.0.0/8"),
    );
    expect(info.ip).toBe("10.0.0.9");
  });

  it.each([
    ["6.6.6.6, 203.0.113.9:54321", "203.0.113.9"],
    ["6.6.6.6, [2001:db8::9]:54321", "2001:db8::9"],
    ["6.6.6.6, unknown", null],
    ["6.6.6.6, garbage, 10.0.0.3", null],
    ["6.6.6.6, , 10.0.0.3", null],
    ["6.6.6.6, 203.0.113.9:99999", null],
  ])("never walks past an untrusted or unparseable hop: %s", (xff, expected) => {
    const info = resolveClient({ peer: "10.0.0.2", header: headers({ "x-forwarded-for": xff }) }, trust("10.0.0.0/8"));
    expect(info.ip).toBe(expected);
  });

  it("uses the peer when a trusted proxy sends no X-Forwarded-For", () => {
    const info = resolveClient({ peer: "127.0.0.1", header: headers({}) }, trust("loopback"));
    expect(info).toMatchObject({ ip: "127.0.0.1", scheme: "http", viaTrustedProxy: true });
  });

  it("takes the scheme only from a trusted X-Forwarded-Proto, nearest hop last", () => {
    const t = trust("10.0.0.0/8");
    const h = (proto: string) => headers({ "x-forwarded-proto": proto });
    expect(resolveClient({ peer: "10.0.0.2", header: h("http, https") }, t).scheme).toBe("https");
    expect(resolveClient({ peer: "10.0.0.2", header: h("gopher") }, t).scheme).toBe("http");
    expect(resolveClient({ peer: "8.8.8.8", header: h("https") }, t).scheme).toBe("http");
  });

  it("skips garbage XFF entries", () => {
    const info = resolveClient(
      { peer: "10.0.0.2", header: headers({ "x-forwarded-for": "unknown, 203.0.113.9" }) },
      trust("10.0.0.0/8"),
    );
    expect(info.ip).toBe("203.0.113.9");
  });
});
