import { dailyRate, publicHolidays, RulesNotAvailableError, roundHalfUpToCent } from "@crowhr/sg-rules";
import type { PayrollRun } from "../db/schema/payroll.ts";
import type { AppDeps } from "../deps.ts";
import { dayInfo, employmentNear, loadEmployeesTime, mondayIndex, scheduleOn } from "../leave/calendar.ts";
import { attachRosters } from "../scheduling/feeds.ts";
import { dateLabel } from "./engine/dates.ts";
import { isBonusRun, type PayInput } from "./engine/types.ts";

const SOURCE = "https://www.mom.gov.sg/employment-practices/public-holidays-entitlement-and-pay";
/** Off-day holidays: gross pay when policy chooses pay; rest-day holidays remain substitute days. */
export async function appendHolidayPay(deps: AppDeps, run: PayrollRun, inputs: PayInput[]) {
  if (isBonusRun(run)) return;
  const times = await loadEmployeesTime(
    deps.db,
    run.orgId,
    inputs.map((i) => i.employee.id),
  );
  await attachRosters(deps.db, run.orgId, times, run.periodStart, run.periodEnd);
  let gazetted: readonly { date: string; name: string }[] = [];
  try {
    gazetted = publicHolidays(Number(run.month.slice(0, 4)));
  } catch (err) {
    if (!(err instanceof RulesNotAvailableError)) throw err;
  }
  for (const input of inputs) {
    const t = times.get(input.employee.id);
    if (t?.settings.offDayHoliday !== "extra_pay") continue;
    const holidays = new Map([...gazetted, ...t.orgHolidays].map((h) => [h.date, h]));
    for (const h of holidays.values()) {
      if (
        h.date < run.periodStart ||
        h.date > run.periodEnd ||
        h.date < input.employment.hireDate ||
        (input.employment.lastWorkingDay && h.date > input.employment.lastWorkingDay)
      )
        continue;
      if (!employmentNear(t, h.date)?.eaCovered) continue;
      const schedule = scheduleOn(t, h.date)?.version;
      const dayType = schedule?.days?.[mondayIndex(h.date)]?.type ?? dayInfo(t, h.date).dayType;
      if (dayType !== "off") continue;
      if (input.items.some((i) => i.id === `holiday:${input.employee.id}:${h.date}`)) continue;
      const comp = input.compensation.find((c) => c.from <= h.date && (!c.to || c.to > h.date));
      const allowances = input.allowances.filter((a) => a.from <= h.date && (!a.to || a.to > h.date));
      const unknown = allowances.filter((a) => a.grossRateIncluded === null || a.grossRateIncluded === undefined);
      const automatic = comp?.payBasis === "monthly" && !!schedule?.days;
      if (!automatic || unknown.length) {
        const day = `${h.name} (${dateLabel(h.date)}) falls on an off day, so it is paid as one extra day's gross pay.`;
        const codes = [...new Set(unknown.map((a) => a.code))].sort();
        input.snapshotIssues.push({
          code: "PH_GROSS_RATE_REQUIRED",
          severity: "blocking",
          message: automatic
            ? `${day} Classify ${unknown.map((a) => a.name).join(", ")} for the gross rate of pay in Payroll → Allowance treatment (include fixed salary allowances; exclude travelling, food and housing allowances), or enter the day's gross pay as holiday pay in this employee's run items.`
            : `${day} Crow HR works it out only for monthly-rated staff on a fixed week: enter the day's gross pay as holiday pay in this employee's run items.`,
          source: SOURCE,
          ref: {
            holidayDate: h.date,
            holidayName: h.name,
            ...(automatic && codes.length ? { allowanceCodes: codes } : {}),
          },
        });
        continue;
      }
      if (!schedule?.days || !comp) continue;
      const workingDaysPerWeek = schedule.days.reduce(
        (n, d) => n + (d.type === "working" ? 1 : d.type === "half" ? 0.5 : 0),
        0,
      );
      const monthlyCents =
        comp.amountCents + allowances.filter((a) => a.grossRateIncluded).reduce((n, a) => n + a.amountCents, 0);
      const amountCents = roundHalfUpToCent(dailyRate({ monthlyCents, workingDaysPerWeek, kind: "gross" }).exact);
      input.items.push({
        id: `holiday:${input.employee.id}:${h.date}`,
        kind: "other_earning",
        label: `Public holiday: ${h.name} (off day)`,
        amountCents,
        wageClass: "OW",
        cpfLiable: true,
        awPayableDate: null,
        minutes: null,
        days: null,
        date: h.date,
        periodStart: null,
        periodEnd: null,
        deductionCategory: null,
        source: "attendance",
      });
    }
  }
}
