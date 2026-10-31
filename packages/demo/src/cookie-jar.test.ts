import { describe, expect, it } from "vitest";
import { createCookieJar, parseSetCookie } from "./cookie-jar.ts";

const NOW = Date.parse("2026-10-31T01:00:00Z");

describe("cookie jar", () => {
  it("parses what core sets (hono/cookie)", () => {
    expect(
      parseSetCookie("__Host-crowhr_session=abc.def; Max-Age=43200; Path=/; HttpOnly; Secure; SameSite=Lax", NOW),
    ).toEqual({ name: "__Host-crowhr_session", value: "abc.def", path: "/", expiresAt: NOW + 43_200_000 });
    expect(parseSetCookie("garbage", NOW)).toBeNull();
  });

  it("replays live cookies for matching paths and drops expired ones", () => {
    const jar = createCookieJar();
    jar.set("a=1; Path=/; Max-Age=60", NOW);
    jar.set("b=2; Path=/api/v1", NOW);
    jar.set("c=3; Path=/other", NOW);
    expect(jar.header("/api/v1/me", NOW)).toBe("b=2; a=1");
    expect(jar.header("/api/v10", NOW)).toBe("a=1");
    expect(jar.header("/api/v1/me", NOW + 61_000)).toBe("b=2");
  });

  it("deletes on Max-Age=0 (sign-out) and survives a JSON round trip", () => {
    const jar = createCookieJar();
    jar.set("crowhr_session=tok; Path=/; Max-Age=3600", NOW);
    const restored = createCookieJar(JSON.parse(JSON.stringify(jar.toJSON())));
    expect(restored.header("/api/v1/me", NOW + 1000)).toBe("crowhr_session=tok");
    restored.set("crowhr_session=; Max-Age=0; Path=/", NOW);
    expect(restored.header("/api/v1/me", NOW)).toBeNull();
    expect(restored.get("crowhr_session")).toBeNull();
  });

  it("honours Expires when there is no Max-Age", () => {
    const jar = createCookieJar();
    jar.set(`x=1; Path=/; Expires=${new Date(NOW + 5000).toUTCString()}`, NOW);
    expect(jar.header("/", NOW)).toBe("x=1");
    expect(jar.header("/", NOW + 6000)).toBeNull();
  });
});
