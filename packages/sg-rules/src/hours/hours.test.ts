import { describe, expect, it } from "vitest";
import { checkProjectedMonthlyOvertime, checkRosterWeek, publicHolidayWorkNote, restDayWorkNote } from "./index.ts";

const week = (minutes: number[], extra: Record<number, { restDay?: boolean; publicHoliday?: boolean }> = {}) =>
  minutes.map((m, i) => ({ date: `2026-11-${String(2 + i).padStart(2, "0")}`, minutes: m, ...(extra[i] ?? {}) }));

describe("checkRosterWeek (MOM hours of work)", () => {
  it("five 8 h days: within normal hours", () => {
    const r = checkRosterWeek({ days: week([480, 480, 480, 480, 480, 0, 0]) });
    expect(r.normalDailyMinutes).toBe(540);
    expect(r.totalMinutes).toBe(2400);
    expect(r.issues).toEqual([]);
    expect(r.days.every((d) => d.overtimeMinutes === 0 && d.issues.length === 0)).toBe(true);
  });

  it("six 10 h days: 2 h beyond normal daily hours each day, 16 h beyond the 44-hour week", () => {
    const r = checkRosterWeek({ days: week([600, 600, 600, 600, 600, 600, 0]) });
    expect(r.normalDailyMinutes).toBe(480);
    expect(r.days[0]?.issues.map((i) => i.message)).toEqual(["2 h beyond normal daily hours (8 h): paid as overtime."]);
    expect(r.issues.map((i) => i.code)).toEqual(["EA_WEEKLY_NORMAL_HOURS"]);
    expect(r.issues[0]?.message).toBe("60 h rostered: 16 h beyond the 44-hour week, paid as overtime.");
    // 8 h normal × 5 = 40, then 4 h normal on Saturday: 44 h normal, 16 h overtime.
    expect(r.days.map((d) => d.overtimeMinutes)).toEqual([120, 120, 120, 120, 120, 360, 0]);
    expect(r.days.at(-1)?.issues).toEqual([]);
  });

  it("a 13 h day breaks the 12-hour maximum", () => {
    const r = checkRosterWeek({ days: week([780, 0, 0, 0, 0, 0, 0]) });
    expect(r.days[0]?.issues.map((i) => i.code)).toEqual(["EA_DAILY_HOURS_LIMIT", "EA_BEYOND_NORMAL_DAILY"]);
    expect(r.days[0]?.issues[0]?.message).toBe("13 h rostered: more than the 12-hour daily maximum.");
  });

  it("all seven days: no rest day", () => {
    const r = checkRosterWeek({ days: week([300, 300, 300, 300, 300, 300, 300]) });
    expect(r.issues.map((i) => i.code)).toEqual(["EA_NO_REST_DAY"]);
  });

  it("rest-day and holiday work count only hours beyond normal daily hours toward the cap", () => {
    const r = checkRosterWeek({
      days: week([480, 480, 480, 480, 480, 570, 0], { 5: { restDay: true }, 0: { publicHoliday: true } }),
    });
    expect(r.days[0]?.capMinutes).toBe(0);
    expect(r.days[5]?.overtimeMinutes).toBe(90);
    expect(r.days[5]?.capMinutes).toBe(90);
    expect(r.days[5]?.issues[0]?.message).toBe("1 h 30 min beyond normal daily hours (8 h): paid as overtime.");
    expect(r.issues).toEqual([]);
  });

  it("rejects bad input", () => {
    expect(() => checkRosterWeek({ days: week([1.5]) })).toThrow(/whole number/);
    expect(() =>
      checkRosterWeek({ days: [...week([0, 0, 0, 0, 0, 0, 0]), { date: "2026-11-09", minutes: 0 }] }),
    ).toThrow(/at most 7/);
    expect(checkRosterWeek({ days: [] }).totalMinutes).toBe(0);
  });
});

describe("checkProjectedMonthlyOvertime", () => {
  it("warns above 72 hours only", () => {
    expect(checkProjectedMonthlyOvertime({ date: "2026-11-01", minutes: 72 * 60 })).toEqual([]);
    const [w] = checkProjectedMonthlyOvertime({ date: "2026-11-01", minutes: 72 * 60 + 30 });
    expect(w?.code).toBe("EA_OT_MONTHLY_LIMIT");
    expect(w?.message).toMatch(/^72 h 30 min of overtime rostered this month/);
  });
});

describe("pay notes for rest-day and public-holiday shifts", () => {
  it("states MOM's multiples", () => {
    expect(restDayWorkNote().message).toBe(
      "Rest-day work: Part 4 staff rostered at your request get 1 day's basic pay for up to half their normal daily hours, 2 days' for more, plus overtime beyond normal hours.",
    );
    expect(publicHolidayWorkNote("Deepavali").message).toMatch(/^Public holiday \(Deepavali\): Part 4 staff/);
    expect(publicHolidayWorkNote("x").source).toMatch(/^https:\/\/www\.mom\.gov\.sg/);
  });
});
