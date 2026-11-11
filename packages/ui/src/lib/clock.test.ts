import { afterEach, describe, expect, it, vi } from "vitest";
import { singaporeToday } from "../components/calendar.tsx";
import { appNow, appNowMs, setAppClockOffset, singaporeTodayIso } from "./clock.ts";

describe("app clock", () => {
  afterEach(() => {
    setAppClockOffset(0);
    vi.useRealTimers();
  });

  it("is the device clock until an offset is set", () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-12T03:00:00Z") });
    expect(appNowMs()).toBe(Date.parse("2026-11-12T03:00:00Z"));
    expect(singaporeTodayIso()).toBe("2026-11-12");
  });

  it("shifts every reading by the offset (the browser demo's 31 Oct 2026)", () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-12T03:00:00Z") });
    setAppClockOffset(Date.parse("2026-10-31T03:00:00Z") - Date.now());
    expect(appNow().toISOString()).toBe("2026-10-31T03:00:00.000Z");
    expect(singaporeTodayIso()).toBe("2026-10-31");
    expect(singaporeToday().getDate()).toBe(31);
  });

  it("uses the Singapore date, not UTC's, between 00:00 and 08:00 SGT", () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-11T17:30:00Z") });
    expect(singaporeTodayIso()).toBe("2026-11-12");
  });

  it("ignores an offset that is not a finite number", () => {
    setAppClockOffset(Number.NaN);
    expect(Math.abs(appNowMs() - Date.now())).toBeLessThan(5);
  });
});
