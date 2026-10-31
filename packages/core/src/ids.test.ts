import { describe, expect, it } from "vitest";
import { fixedClock } from "./deps.ts";
import { createUuidV7Generator } from "./ids.ts";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("createUuidV7Generator", () => {
  it("produces RFC 9562 version-7 UUIDs", () => {
    const ids = createUuidV7Generator(fixedClock("2026-10-31T01:00:00Z"));
    for (let i = 0; i < 50; i++) expect(ids.newId()).toMatch(UUID_V7);
  });

  it("encodes the clock's millisecond timestamp in the first 48 bits", () => {
    const at = new Date("2026-10-31T01:00:00.123Z");
    const id = createUuidV7Generator(fixedClock(at)).newId();
    const ms = Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);
    expect(ms).toBe(at.getTime());
  });

  it("sorts lexicographically by creation time", () => {
    const early = createUuidV7Generator(fixedClock("2026-01-01T00:00:00Z")).newId();
    const late = createUuidV7Generator(fixedClock("2026-12-31T23:59:59Z")).newId();
    expect([late, early].sort()).toEqual([early, late]);
  });
});
