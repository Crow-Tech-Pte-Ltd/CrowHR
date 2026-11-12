import { describe, expect, it } from "vitest";
import { demoClockOffset, movableSeedClock, offsetClock } from "./clock.ts";

const sg = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 19);

describe("demo clock", () => {
  it("maps any real date onto Saturday 31 Oct 2026, 11:30 in Singapore, then runs", () => {
    const real = new Date("2027-03-05T06:45:12.000Z"); // 14:45:12 in Singapore
    let now = real.getTime();
    const clock = offsetClock(demoClockOffset(real), () => now);
    expect(sg(clock.now())).toBe("2026-10-31T11:30:00");
    now += 90 * 60_000;
    expect(sg(clock.now())).toBe("2026-10-31T13:00:00");
  });

  it("starts at the same time whatever the visitor's own hour (here just after Singapore midnight)", () => {
    const real = new Date("2026-12-31T16:05:00.000Z"); // 00:05 on 1 Jan in Singapore
    expect(sg(offsetClock(demoClockOffset(real), () => real.getTime()).now())).toBe("2026-10-31T11:30:00");
  });

  it("lets the seed walk through history in Singapore time", () => {
    const clock = movableSeedClock("2026-06-22T01:00:00.000Z");
    clock.set("2026-07-21T10:00");
    expect(clock.now().toISOString()).toBe("2026-07-21T02:00:00.000Z");
    expect(() => clock.set("not a date")).toThrow();
  });
});
