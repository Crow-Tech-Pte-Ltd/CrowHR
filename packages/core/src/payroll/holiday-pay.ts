import { dailyRate, publicHolidays, RulesNotAvailableError, roundHalfUpToCent } from "@crowhr/sg-rules";
import type { PayrollRun } from "../db/schema/payroll.ts";
import type { AppDeps } from "../deps.ts";
import { dayInfo, employmentNear, loadEmployeesTime, mondayIndex, scheduleOn } from "../leave/calendar.ts";
import { attachRosters } from "../scheduling/feeds.ts";
import type { PayInput } from "./engine/types.ts";

const SOURCE = "https://www.mom.gov.sg/employment-practices/public-holidays-entitlement-and-pay";
/** Off-day holidays: gross pay when policy chooses pay; rest-day holidays remain substitute days. */
export async function appendHolidayPay(deps: AppDeps, run: PayrollRun, inputs: PayInput[]) {
  if (run.kind === "off_cycle" && run.offCycleReason === "bonus") return;
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
      if (comp?.payBasis !== "monthly" || !schedule?.days || unknown.length) {
        input.snapshotIssues.push({
          code: "PH_GROSS_RATE_REQUIRED",
          severity: "blocking",
          message: `Public holiday ${h.name} (${h.date}) needs one day's gross pay. ${unknown.length ? `Classify ${unknown.map((a) => a.name).join(", ")} for the EA gross rate in Payroll allowance settings (exclude travelling, food and housing allowances).` : "Automatic off-day holiday pay currently requires a monthly rate and fixed work week. Add an other earning with holidayDate and the agreed daily gross amount before paying this run."}`,
          source: SOURCE,
        });
        continue;
      }
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
