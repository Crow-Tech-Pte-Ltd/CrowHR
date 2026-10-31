import { describe, expect, it } from "vitest";
import { distanceMetres, ipAllowed, ipInCidr, parseCidr, parseIp } from "./network.ts";

describe("attendance network checks", () => {
  it("matches IPv4 CIDR ranges", () => {
    expect(ipInCidr("203.0.113.7", "203.0.113.0/24")).toBe(true);
    expect(ipInCidr("203.0.114.7", "203.0.113.0/24")).toBe(false);
    expect(ipInCidr("10.1.2.3", "10.0.0.0/8")).toBe(true);
    expect(ipInCidr("10.1.2.3", "10.1.2.3")).toBe(true);
    expect(ipInCidr("1.2.3.4", "0.0.0.0/0")).toBe(true);
    expect(parseCidr("300.1.1.1/8")).toBeNull();
    expect(parseCidr("1.2.3.4/33")).toBeNull();
    expect(parseCidr("1.2.3.4/x")).toBeNull();
    expect(parseCidr("1.2.3.4/8/2")).toBeNull();
    expect(parseIp("1.2.3")).toBeNull();
  });

  it("matches IPv6 ranges, compressed forms and IPv4-mapped addresses", () => {
    expect(ipInCidr("2001:db8::1", "2001:db8::/32")).toBe(true);
    expect(ipInCidr("2001:db9::1", "2001:db8::/32")).toBe(false);
    expect(ipInCidr("2001:0db8:0000:0000:0000:0000:0000:0001", "2001:db8::1/128")).toBe(true);
    expect(ipInCidr("fe80::1%eth0", "fe80::/10")).toBe(true);
    expect(ipInCidr("::ffff:203.0.113.9", "203.0.113.0/24")).toBe(true);
    expect(ipInCidr("::ffff:203.0.113.9", "::ffff:203.0.113.0/120")).toBe(true);
    expect(ipInCidr("203.0.113.9", "2001:db8::/32")).toBe(false);
    expect(parseIp("2001:db8::1::2")).toBeNull();
    expect(parseIp("2001:db8:zz::1")).toBeNull();
    expect(parseIp("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(parseIp("::ffff:300.1.1.1")).toBeNull();
  });

  it("allows any network when no ranges are set, and nothing without an IP", () => {
    expect(ipAllowed(null, [])).toBe(true);
    expect(ipAllowed(null, ["10.0.0.0/8"])).toBe(false);
    expect(ipAllowed("10.0.0.1", ["192.168.0.0/16", "10.0.0.0/8"])).toBe(true);
  });

  it("measures distance with haversine", () => {
    // Tanjong Pagar MRT to Raffles Place MRT: about 1.3 km.
    const d = distanceMetres({ latitude: 1.2764, longitude: 103.8458 }, { latitude: 1.284, longitude: 103.8515 });
    expect(d).toBeGreaterThan(1_000);
    expect(d).toBeLessThan(1_300);
    expect(distanceMetres({ latitude: 1.3, longitude: 103.8 }, { latitude: 1.3, longitude: 103.8 })).toBe(0);
  });
});
