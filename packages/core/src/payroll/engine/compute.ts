import {
  CPF_RATE_TABLES,
  type CpfMonthResult,
  computeCpf,
  computeOvertimePay,
  computeSdl,
  computeShg,
  cpfAgeBandLabel,
  determineShgFunds,
  estimateLevy,
  RulesNotAvailableError,
  resolveRules,
  type SdlResult,
  SgRulesInputError,
  type ShgFund,
  WORK_PATTERNS,
  type WorkingStep,
} from "@crowhr/sg-rules";
import {
  awTopUpRecoveryDeadline,
  CPF_ACT_S7,
  CPF_MISTAKES_SOURCE,
  CPF_RECOVERY_FAQ,
  CPF_WAGES_SOURCE,
  checkDeductions,
  DEDUCTION_CATEGORIES,
  type DeductionCategory,
  EA_S21,
  MOM_DEDUCTIONS_SOURCE,
  MOM_INCOMPLETE_MONTH_SOURCE,
  MOM_PAYING_SALARY_SOURCE,
  overtimeDueBy,
  paymentDeadlines,
} from "../rules.ts";
import { addDays, dateLabel, maxDate, monthLabel, sgd } from "./dates.ts";
import { prorate, roundHalfUp, workingDaysBetween } from "./proration.ts";
import {
  ENGINE_VERSION,
  type MonthCharged,
  type PayInput,
  type PayIssue,
  type PayLine,
  type PayResult,
  type RuleRef,
  type WorkingLine,
  type WorkingSection,
} from "./types.ts";

const EMPTY_CHARGED: MonthCharged = {
  cpfTotalCents: 0,
  cpfEmployeeCents: 0,
  cpfAwTopUpEmployeeCents: 0,
  cpfEmployerCents: 0,
  shgCents: {},
  sdlUnits1e4Cent: 0,
};

const FUND_ORDER: readonly ShgFund[] = ["CDAC", "ECF", "MBMF", "SINDA"];

function mapSteps(section: WorkingSection, steps: readonly WorkingStep[]): WorkingLine[] {
  return steps.map((s) => ({ section, code: s.code, text: s.text }));
}

function errorIssue(err: unknown, what: string): PayIssue {
  if (err instanceof SgRulesInputError || err instanceof RulesNotAvailableError) {
    return {
      code: err instanceof RulesNotAvailableError ? "RULES_NOT_AVAILABLE" : "RULES_INPUT_REJECTED",
      severity: "blocking",
      message: `${what}: ${err.message}`,
      source: null,
    };
  }
  throw err;
}

function earning(
  code: string,
  category: PayLine["category"],
  label: string,
  amountCents: number,
  wageClass: PayLine["wageClass"],
  cpfLiable: boolean,
  detail: string | null,
  itemId: string | null,
): PayLine {
  return { code, kind: "earning", category, label, amountCents, wageClass, cpfLiable, detail, itemId };
}

const sumShg = (m: Partial<Record<ShgFund, number>>) => Object.values(m).reduce((s, v) => s + (v ?? 0), 0);

/**
 * Pay for one employee in one run. Pure: the result depends only on `input`, so recomputing a stored
 * snapshot gives the same result (and the same canonical-JSON hash).
 */
export function computeEmployeePay(input: PayInput): PayResult {
  const { run, employee, employment } = input;
  const issues: PayIssue[] = [...input.snapshotIssues];
  const working: WorkingLine[] = [];
  const rules: RuleRef[] = [];
  const lines: PayLine[] = [];
  const isBonusRun = run.kind === "off_cycle" && run.offCycleReason === "bonus";
  const lastWorkingDayInPeriod =
    employment.lastWorkingDay !== null &&
    employment.lastWorkingDay >= run.periodStart &&
    employment.lastWorkingDay <= run.periodEnd;

  rules.push({
    family: "MOM incomplete month",
    id: "monthly gross / working days × days worked",
    effectiveFrom: "2025-01-01",
    effectiveTo: null,
    source: MOM_INCOMPLETE_MONTH_SOURCE,
  });

  // 1. Basic pay and allowances (not in a bonus-only run).
  let basicCents = 0;
  let nplCents = 0;
  let allowanceOw = 0;
  let allowanceNonCpf = 0;
  let fullMonthlyOw = 0;
  let prorated = false;
  let monthlyBasicAtEnd: number | null = null;
  let hourly: PayResult["hourly"] = null;
  if (!isBonusRun) {
    const p = prorate(input);
    lines.push(...p.lines);
    working.push(...p.working);
    issues.push(...p.issues);
    basicCents = p.basicCents;
    nplCents = p.nplCents;
    allowanceOw = p.allowanceOwCents;
    allowanceNonCpf = p.allowanceNonCpfCents;
    fullMonthlyOw = p.fullMonthlyOwCents;
    prorated = p.prorated;
    monthlyBasicAtEnd = p.monthlyBasicAtEndCents;
    hourly = p.hourly;
  }
  const allowancesCents = allowanceOw + allowanceNonCpf;

  // 2. Overtime.
  let overtimeOw = 0;
  let overtimeAw = 0;
  let otMinutes = 0;
  const otPeriods: NonNullable<PayResult["overtime"]>["periods"] = [];
  for (const item of input.items.filter((i) => i.kind === "overtime")) {
    const minutes = item.minutes ?? 0;
    otMinutes += minutes;
    if ((item.periodStart === null) !== (item.periodEnd === null)) {
      issues.push({
        code: "OT_PERIOD_INCOMPLETE",
        severity: "blocking",
        message: `Overtime "${item.label}": give both the start and the end of the overtime period, or neither when it is the salary period (MOM payslip item 11).`,
        source: "https://www.mom.gov.sg/employment-practices/salary/itemised-payslips",
      });
    }
    if (minutes <= 0) {
      issues.push({
        code: "OT_HOURS_MISSING",
        severity: "blocking",
        message: `Overtime "${item.label}": enter the overtime hours; a payslip must show the hours worked with the OT pay.`,
        source: "https://www.mom.gov.sg/employment-practices/salary/itemised-payslips",
      });
    }
    // EA s 21(2): due 14 days after the salary period in which the OT was performed.
    const due = overtimeDueBy(item.periodEnd ?? run.periodEnd);
    if (run.payDate > due) {
      issues.push({
        code: "EA_OT_PAID_LATE",
        severity: "warning",
        message: `Overtime "${item.label}"${item.periodEnd ? ` (performed to ${dateLabel(item.periodEnd)})` : ""} must be paid within 14 days after the salary period it was worked in, by ${dateLabel(due)}; the pay date is ${dateLabel(run.payDate)}.`,
        source: EA_S21,
      });
    }
    let pay = item.amountCents;
    if (pay === null) {
      if (monthlyBasicAtEnd === null) {
        issues.push({
          code: "OT_AMOUNT_REQUIRED",
          severity: "blocking",
          message: `Overtime "${item.label}": enter the overtime amount (statutory OT is computed only for monthly-rated staff).`,
          source: null,
        });
        continue;
      }
      try {
        const ot = computeOvertimePay({
          date: item.periodEnd ?? run.periodEnd,
          monthlyBasicCents: monthlyBasicAtEnd,
          isWorkman: employee.isWorkman,
          isManagerOrExecutive: false,
          overtimeMinutes: minutes,
        });
        working.push(...mapSteps("overtime", ot.working));
        for (const i of ot.issues) issues.push({ ...i, source: i.source ?? null });
        if (!ot.eligible) {
          issues.push({
            code: "OT_NOT_STATUTORY",
            severity: "blocking",
            message: `Overtime "${item.label}": the employee is not covered by Part 4 of the Employment Act, so there is no statutory OT rate. Enter the contractual OT amount.`,
            source: resolveRules(run.periodEnd).employmentAct.part4.source,
          });
          continue;
        }
        pay = ot.payCents;
        const rule = resolveRules(run.periodEnd).employmentAct.overtime;
        rules.push({
          family: "EA overtime",
          id: "1.5 × hourly basic",
          effectiveFrom: rule.effectiveFrom,
          effectiveTo: rule.effectiveTo,
          source: rule.source,
        });
      } catch (err) {
        issues.push(errorIssue(err, `Overtime "${item.label}"`));
        continue;
      }
    } else {
      working.push({
        section: "overtime",
        code: "OT_ENTERED",
        text: `${item.label}: ${minutes / 60} h, amount entered ${sgd(pay)}.`,
      });
    }
    // OT for an earlier period paid now is AW of this month (CPF mistakes PDF item 10).
    const earlier = item.periodEnd !== null && item.periodEnd < run.periodStart;
    if (earlier) {
      issues.push({
        code: "OT_EARLIER_PERIOD_AW",
        severity: "warning",
        message: `Overtime "${item.label}" is for ${item.periodStart ? dateLabel(item.periodStart) : "an earlier period"}–${dateLabel(item.periodEnd as string)} and is paid in ${monthLabel(run.month)}, so it is treated as AW of ${monthLabel(run.month)}. If it was payable by the 14th, it is OW of its own month: put it in that month's adjustment instead.`,
        source: CPF_MISTAKES_SOURCE,
      });
      overtimeAw += pay;
    } else overtimeOw += pay;
    otPeriods.push({
      label: item.label || "Overtime",
      periodStart: item.periodStart,
      periodEnd: item.periodEnd,
      minutes,
      payCents: pay,
    });
    lines.push(
      earning(
        `OT_${item.id.slice(-6)}`,
        "overtime",
        item.label || "Overtime",
        pay,
        earlier ? "AW" : "OW",
        true,
        `${minutes / 60} h${item.periodStart && item.periodEnd ? `, ${dateLabel(item.periodStart)}–${dateLabel(item.periodEnd)}` : ""}`,
        item.id,
      ),
    );
  }
  const overtimeCents = overtimeOw + overtimeAw;

  // 3. One-off earnings.
  let additionalOw = 0;
  let additionalAw = 0;
  let additionalNonCpf = 0;
  const awByDate: { date: string; cents: number }[] = [];
  for (const item of input.items.filter((i) => ["bonus", "commission", "backpay", "other_earning"].includes(i.kind))) {
    const amount = item.amountCents ?? 0;
    const wageClass = item.wageClass ?? (item.kind === "bonus" ? "AW" : "OW");
    let detail: string | null = null;
    if (wageClass === "AW") {
      const payable = item.awPayableDate;
      if (!payable) {
        issues.push({
          code: "AW_PAYABLE_DATE_MISSING",
          severity: "blocking",
          message: `"${item.label}" is AW: enter the date it became due and payable (CPF keys the AW ceiling to it).`,
          source: CPF_WAGES_SOURCE,
        });
        continue;
      }
      if (payable < run.periodStart || payable > run.periodEnd) {
        issues.push({
          code: "AW_PAYABLE_OUTSIDE_PERIOD",
          severity: "blocking",
          message: `"${item.label}" is AW payable on ${dateLabel(payable)}, outside this run's period (${dateLabel(run.periodStart)}–${dateLabel(run.periodEnd)}). CPF treats AW in the month it is due and payable: pay it in that month's run or an adjustment of it.`,
          source: CPF_WAGES_SOURCE,
        });
        continue;
      }
      detail = `AW payable ${dateLabel(payable)}`;
      if (item.cpfLiable) awByDate.push({ date: payable, cents: amount });
    }
    if (!item.cpfLiable) additionalNonCpf += amount;
    else if (wageClass === "AW") additionalAw += amount;
    else additionalOw += amount;
    lines.push(
      earning(
        `${item.kind.toUpperCase()}_${item.id.slice(-6)}`,
        "additional",
        item.label,
        amount,
        item.cpfLiable ? wageClass : null,
        item.cpfLiable,
        detail ?? (item.cpfLiable ? null : "not CPF wages"),
        item.id,
      ),
    );
    if (item.kind === "backpay") {
      working.push({
        section: "pay",
        code: "BACKPAY_CLASS",
        text: `${item.label}: classified ${wageClass}. CPF: a retrospective increment decided later is AW of the month paid; an increment paid late by administrative error is OW of the original months (recompute those months instead).`,
      });
    }
  }
  const additionalCents = additionalOw + additionalAw + additionalNonCpf;

  // 4. Wages for CPF, SDL, SHG.
  let owCpf = basicCents - nplCents + allowanceOw + overtimeOw + additionalOw;
  let awCpf = overtimeAw + additionalAw;
  const grossCents = basicCents - nplCents + allowancesCents + overtimeCents + additionalCents;
  const totalWagesCents = owCpf + awCpf;
  const residency = employee.residency;
  if (residency.status === "SPR" && residency.sprDate > run.periodStart && residency.sprDate <= run.periodEnd) {
    if (employment.pattern === null) {
      issues.push({
        code: "CPF_SPR_CONVERSION_ROSTER",
        severity: "blocking",
        message: `SPR status starts ${dateLabel(residency.sprDate)} mid-month for a rostered employee: Crow HR cannot split CPF-liable OW by roster days yet. Work out the OW for days from the SPR date and contact CPF Board, or pay the month in an adjustment once it is supported.`,
        source:
          "https://www.cpf.gov.sg/service/article/do-i-need-to-pay-cpf-contributions-for-my-foreign-employee-who-has-recently-obtained-singapore-permanent-residence-status",
      });
    }
    const pattern = employment.pattern ?? WORK_PATTERNS.FIVE_DAY;
    const winStart = maxDate(run.periodStart, employment.hireDate);
    const winEnd =
      employment.lastWorkingDay && employment.lastWorkingDay < run.periodEnd
        ? employment.lastWorkingDay
        : run.periodEnd;
    const all = workingDaysBetween(winStart, winEnd, pattern);
    const after = workingDaysBetween(maxDate(winStart, residency.sprDate), winEnd, pattern);
    const owBefore = owCpf;
    owCpf = all > 0 ? roundHalfUp(owCpf * Math.round(after * 2), Math.round(all * 2)) : 0;
    const awBefore = awByDate.filter((a) => a.date < residency.sprDate).reduce((s, a) => s + a.cents, 0);
    awCpf -= awBefore;
    working.push({
      section: "cpf",
      code: "CPF_SPR_CONVERSION",
      text: `SPR from ${dateLabel(residency.sprDate)}: CPF-liable OW = ${sgd(owBefore)} × ${after}/${all} working days = ${sgd(owCpf)}${awBefore ? `; AW of ${sgd(awBefore)} payable before the SPR date is not CPF-liable` : ""}. SDL and SHG use all wages.`,
    });
    issues.push({
      code: "CPF_SPR_CONVERSION_PRORATED",
      severity: "warning",
      message: `SPR status starts ${dateLabel(residency.sprDate)}: CPF-liable OW was pro-rated by working days from that date. Check it against the days actually worked after conversion.`,
      source:
        "https://www.cpf.gov.sg/service/article/do-i-need-to-pay-cpf-contributions-for-my-foreign-employee-who-has-recently-obtained-singapore-permanent-residence-status",
    });
  }

  // 5. CPF for the whole month (this run + earlier effective runs), charged as the difference.
  const before = input.monthBefore;
  const others = before?.chargedByOthers ?? EMPTY_CHARGED;
  const replaced = before?.chargedByReplaced ?? EMPTY_CHARGED;
  const monthOw = owCpf + (before?.owCpfCents ?? 0);
  const monthAw = awCpf + (before?.awCpfCents ?? 0);
  const monthWages = totalWagesCents + (before?.totalWagesCents ?? 0);
  if (before && before.runIds.length > 0) {
    working.push({
      section: "cpf",
      code: "CPF_MONTH_CUMULATIVE",
      text: `CPF, SHG and SDL are monthly: ${monthLabel(run.month)} wages = this run (OW ${sgd(owCpf)}, AW ${sgd(awCpf)}) + earlier runs of the month (OW ${sgd(before.owCpfCents)}, AW ${sgd(before.awCpfCents)}). This run charges the month's amount less what earlier runs charged.`,
    });
  }
  working.push({
    section: "cpf",
    code: "CPF_YTD_SOURCE",
    text: `Year-to-date CPF state before ${monthLabel(run.month)}: ${input.cpfStateSource}.`,
  });
  let cpf: CpfMonthResult | null = null;
  let stateAfter = input.cpfStateBefore;
  const lastMonth = employment.lastWorkingDay ? employment.lastWorkingDay.slice(0, 7) : undefined;
  try {
    const r = computeCpf({
      contributionMonth: run.month,
      birthDate: employee.dob,
      residency,
      owCents: monthOw,
      awCents: monthAw,
      yearToDate: input.cpfStateBefore,
      ...(lastMonth ? { employment: { lastMonth } } : {}),
      ...(prorated && fullMonthlyOw > 0 && !lastWorkingDayInPeriod
        ? { awCeilingEstimate: { projectedMonthlyOwCents: fullMonthlyOw } }
        : {}),
    });
    working.push(...mapSteps("cpf", r.working));
    for (const i of r.issues) {
      if (i.severity === "blocking") continue;
      issues.push({ code: i.code, severity: i.severity, message: i.message, source: i.source ?? null });
    }
    if (r.ok) {
      cpf = r;
      stateAfter = r.yearToDateAfter;
      if (r.rateTable) {
        const t = CPF_RATE_TABLES.find((x) => x.id === r.rateTable?.id);
        rules.push({
          family: `CPF rate table ${r.rateTable.publishedTableNo}`,
          id: r.rateTable.id,
          effectiveFrom: r.rateTable.effectiveFrom,
          effectiveTo: t?.effectiveTo ?? null,
          source: r.rateTable.source,
        });
        const set = resolveRules(run.periodStart);
        rules.push({
          family: "CPF OW ceiling",
          id: sgd(set.cpf.owCeiling.monthlyCents),
          effectiveFrom: set.cpf.owCeiling.effectiveFrom,
          effectiveTo: set.cpf.owCeiling.effectiveTo,
          source: set.cpf.owCeiling.source,
        });
        rules.push({
          family: "CPF Annual Salary Ceiling",
          id: sgd(set.cpf.annualSalaryCeiling.annualCents),
          effectiveFrom: set.cpf.annualSalaryCeiling.effectiveFrom,
          effectiveTo: set.cpf.annualSalaryCeiling.effectiveTo,
          source: set.cpf.annualSalaryCeiling.source,
        });
      }
    } else {
      for (const i of r.blockingIssues) {
        issues.push({ code: i.code, severity: "blocking", message: i.message, source: i.source ?? null });
      }
    }
  } catch (err) {
    issues.push(errorIssue(err, "CPF"));
  }
  // A prior-AW shortfall here is the genuine AW-ceiling reconciliation (CPF AW Steps 1-2), whose
  // top-up is payable with this month's contributions. Its employee share is statutory employee CPF
  // that MAY be recovered from wages paid by 30 June of the next year (CPF Act s 7(9), First Schedule
  // para 4(2)); remittance never depends on recovery.
  const shortfall = cpf?.priorAw.shortfall ?? null;
  const monthCpfTotal = (cpf?.totalCents ?? 0) + (shortfall?.totalCents ?? 0);
  const monthTopUpEmployee = shortfall?.employeeCents ?? 0;
  const monthCpfEmployee = (cpf?.employeeCents ?? 0) + monthTopUpEmployee;
  const monthCpfEmployer = monthCpfTotal - monthCpfEmployee;

  // 6. SHG and SDL on all wages of the month.
  let shgFunds: ShgFund[] = [];
  let monthShg: Partial<Record<ShgFund, number>> = {};
  try {
    const passType = employee.workPass?.type;
    const det = determineShgFunds({
      residency:
        residency.status === "SC"
          ? "SC"
          : residency.status === "SPR" && residency.sprDate <= run.periodEnd
            ? "SPR"
            : "FOREIGNER",
      passType:
        passType === "EP" ? "EP" : passType === "S_PASS" ? "S_PASS" : passType === "WP" ? "WORK_PERMIT" : "OTHER",
      race: employee.race,
      isMuslim: employee.isMuslim,
      ...(employee.shgOptedOut ? { elections: { optedOut: [...FUND_ORDER] } } : {}),
    });
    working.push(...mapSteps("shg", det.working));
    for (const i of det.issues)
      issues.push({ code: i.code, severity: i.severity, message: i.message, source: i.source ?? null });
    shgFunds = [...det.funds];
    const shg = computeShg({ month: run.month, totalWagesCents: monthWages, funds: shgFunds });
    working.push(...mapSteps("shg", shg.working));
    for (const i of shg.issues)
      issues.push({ code: i.code, severity: i.severity, message: i.message, source: i.source ?? null });
    monthShg = shg.byFund;
    const set = resolveRules(run.periodStart);
    for (const f of shgFunds) {
      const t = set.shg[f];
      rules.push({
        family: `${f} table`,
        id: `${f} ${t.effectiveFrom}`,
        effectiveFrom: t.effectiveFrom,
        effectiveTo: t.effectiveTo,
        source: t.source,
      });
    }
  } catch (err) {
    issues.push(errorIssue(err, "SHG"));
  }
  let sdl: SdlResult | null = null;
  try {
    sdl = computeSdl({ month: run.month, totalWagesCents: monthWages });
    working.push(...mapSteps("sdl", sdl.working));
    rules.push({
      family: "SDL",
      id: "0.25% (min $2, max $11.25)",
      effectiveFrom: sdl.rate.effectiveFrom,
      effectiveTo: sdl.rate.effectiveTo,
      source: sdl.rate.source,
    });
  } catch (err) {
    issues.push(errorIssue(err, "SDL"));
  }

  // Charged by this run, and what the payslip shows (month − other effective runs).
  const shgShown: Partial<Record<ShgFund, number>> = {};
  const shgCharged: Partial<Record<ShgFund, number>> = {};
  for (const f of FUND_ORDER) {
    const m = monthShg[f] ?? 0;
    const o = others.shgCents[f] ?? 0;
    const r = replaced.shgCents[f] ?? 0;
    if (m !== 0 || o !== 0) shgShown[f] = m - o;
    if (m - o - r !== 0) shgCharged[f] = m - o - r;
  }
  // Regular employee CPF shown on this payslip: the month's regular share less what other runs showed.
  const cpfEmployeeShown =
    monthCpfEmployee - monthTopUpEmployee - (others.cpfEmployeeCents - others.cpfAwTopUpEmployeeCents);
  const cpfEmployerShown = monthCpfEmployer - others.cpfEmployerCents;
  const topUpEmployeeShown = monthTopUpEmployee - others.cpfAwTopUpEmployeeCents;
  const charged: MonthCharged = {
    cpfTotalCents: monthCpfTotal - others.cpfTotalCents - replaced.cpfTotalCents,
    cpfEmployeeCents: monthCpfEmployee - others.cpfEmployeeCents - replaced.cpfEmployeeCents,
    cpfAwTopUpEmployeeCents: monthTopUpEmployee - others.cpfAwTopUpEmployeeCents - replaced.cpfAwTopUpEmployeeCents,
    cpfEmployerCents: monthCpfEmployer - others.cpfEmployerCents - replaced.cpfEmployerCents,
    shgCents: shgCharged,
    sdlUnits1e4Cent: (sdl?.units1e4Cent ?? 0) - others.sdlUnits1e4Cent - replaced.sdlUnits1e4Cent,
  };
  if (cpfEmployeeShown < 0 || sumShg(shgShown) < 0) {
    issues.push({
      code: "CPF_NEGATIVE_AFTER_EARLIER_RUNS",
      severity: "warning",
      message:
        "Earlier runs of this month already deducted more employee CPF or SHG than the month needs. Apply to CPF Board for a refund of the excess; it is not netted here.",
      source: null,
    });
  }

  const shgShownTotal = Math.max(0, sumShg(shgShown));
  const cpfEe = Math.max(0, cpfEmployeeShown);
  if (cpfEe > 0) {
    lines.push({
      code: "CPF_EMPLOYEE",
      kind: "deduction",
      category: "cpf_employee",
      label: "Employee CPF",
      amountCents: cpfEe,
      wageClass: null,
      cpfLiable: false,
      detail: cpf?.rateTable
        ? `CPF Table ${cpf.rateTable.publishedTableNo} (${cpf.rateTable.effectiveFrom.slice(0, 4)}), age ${cpf.ageBand ? cpfAgeBandLabel(cpf.ageBand) : ""}`
        : null,
      itemId: null,
    });
  }
  for (const f of FUND_ORDER) {
    const v = shgShown[f] ?? 0;
    if (v > 0)
      lines.push({
        code: `SHG_${f}`,
        kind: "deduction",
        category: "shg",
        label: `${f} contribution`,
        amountCents: v,
        wageClass: null,
        cpfLiable: false,
        detail: null,
        itemId: null,
      });
  }

  // AW top-up employee share: recover (s 7(9)) when asked, else the employer bears it.
  const recoveryItems = input.items.filter((i) => i.kind === "cpf_aw_recovery");
  const thisShare = Math.max(0, topUpEmployeeShown);
  const deadline = awTopUpRecoveryDeadline(Number(run.month.slice(0, 4)));
  const openEarlier = input.awRecoveryOpen.filter((o) => o.deadline >= run.payDate);
  const expired = input.awRecoveryOpen.filter((o) => o.deadline < run.payDate);
  const availableEarlier = openEarlier.reduce((s, o) => s + o.openCents, 0);
  let recoveredThis = 0;
  let recoveredEarlier = 0;
  if (recoveryItems.length) {
    const wanted = recoveryItems.some((i) => i.amountCents === null)
      ? thisShare + availableEarlier
      : recoveryItems.reduce((s, i) => s + (i.amountCents ?? 0), 0);
    if (wanted > thisShare + availableEarlier) {
      issues.push({
        code: "CPF_RECOVERY_NOT_PERMITTED",
        severity: "blocking",
        message: `Only ${sgd(thisShare + availableEarlier)} of employee CPF on AW top-ups can be recovered from this pay (CPF Act s 7(9): within six months after the end of the year the top-up was payable${expired.length ? `; ${expired.map((e) => monthLabel(e.month)).join(", ")} passed that deadline` : ""}). Reduce the recovery to ${sgd(thisShare + availableEarlier)}. Other CPF arrears from employer error cannot be recovered from later wages.`,
        source: CPF_ACT_S7,
      });
    } else {
      recoveredThis = Math.min(wanted, thisShare);
      recoveredEarlier = wanted - recoveredThis;
    }
  }
  const recovered = recoveredThis + recoveredEarlier;
  const absorbed = thisShare - recoveredThis;
  if (thisShare > 0 && absorbed > 0) {
    issues.push({
      code: "CPF_AW_TOPUP_EMPLOYEE_SHARE",
      severity: "warning",
      message: `CPF on earlier AW is due with this month's contributions (AW ceiling reconciliation): ${sgd(shortfall?.totalCents ?? 0)}, of which ${sgd(thisShare)} is the employee share. You may recover it from wages paid by ${dateLabel(deadline)} (CPF Act s 7(9)) with a "Recover AW top-up CPF" item; otherwise the employer bears it. CPF Board is paid in full either way.`,
      source: CPF_ACT_S7,
    });
  }
  if (recovered > 0) {
    lines.push({
      code: "CPF_AW_RECOVERY",
      kind: "deduction",
      category: "cpf_employee",
      label: "Employee CPF on AW top-up (recovered)",
      amountCents: recovered,
      wageClass: null,
      cpfLiable: false,
      detail: `CPF Act s 7(9), by ${dateLabel(deadline)}`,
      itemId: recoveryItems[0]?.id ?? null,
    });
    rules.push({
      family: "CPF AW top-up recovery",
      id: "CPF Act s 7(9)",
      effectiveFrom: "2025-01-01",
      effectiveTo: null,
      source: CPF_ACT_S7,
    });
  }

  // 7. Other deductions and their Employment Act limits.
  const deductions: { category: DeductionCategory; label: string; amountCents: number }[] = [];
  for (const item of input.items.filter((i) => i.kind === "deduction")) {
    const category = item.deductionCategory ?? "consented";
    const amount = item.amountCents ?? 0;
    if (/\bcpf\b/i.test(item.label) && category !== "court_order") {
      issues.push({
        code: "CPF_ARREARS_RECOVERY_BLOCKED",
        severity: "blocking",
        message: `"${item.label}" looks like a recovery of employee CPF. Employee CPF missed by the employer's oversight or a system error cannot be deducted from later wages (CPF Board); only the narrow non-negligent route in CPF Act s 7(6A), with prior payment and the employee's consent or the Board's permission, allows it. Use "Recover AW top-up CPF" for AW-ceiling reconciliations, or remove this deduction.`,
        source: CPF_RECOVERY_FAQ,
      });
    }
    deductions.push({ category, label: item.label, amountCents: amount });
    lines.push({
      code: `DED_${item.id.slice(-6)}`,
      kind: "deduction",
      category: "deduction",
      label: item.label,
      amountCents: amount,
      wageClass: null,
      cpfLiable: false,
      detail: DEDUCTION_CATEGORIES[category].label,
      itemId: item.id,
    });
  }
  const otherDeductions = deductions.reduce((s, d) => s + d.amountCents, 0);
  const salary = grossCents;
  if (deductions.length > 0 || cpfEe > 0 || recovered > 0) {
    const check = checkDeductions({
      date: run.periodEnd,
      salaryCents: Math.max(0, salary),
      deductions,
      statutoryEmployeeCents: cpfEe + recovered + shgShownTotal,
      finalPay: lastWorkingDayInPeriod,
    });
    issues.push(
      ...check.issues.map((x) => ({
        code: x.code,
        severity: x.severity,
        message: x.message,
        source: x.source ?? null,
      })),
    );
    working.push(...mapSteps("deductions", check.working));
    if (deductions.length > 0) {
      rules.push({
        family: "EA deduction limits",
        id: "EA s 29, s 30(2), s 32",
        effectiveFrom: "2025-01-01",
        effectiveTo: null,
        source: MOM_DEDUCTIONS_SOURCE,
      });
    }
  }

  // 8. Reimbursements (not wages).
  let reimbursementsCents = 0;
  for (const r of [...input.reimbursements].sort((a, b) =>
    a.typeName < b.typeName ? -1 : a.typeName > b.typeName ? 1 : a.claimId < b.claimId ? -1 : 1,
  )) {
    reimbursementsCents += r.amountCents;
  }
  const byType = new Map<string, number>();
  for (const r of input.reimbursements) byType.set(r.typeName, (byType.get(r.typeName) ?? 0) + r.amountCents);
  for (const [typeName, cents] of [...byType.entries()].sort()) {
    lines.push({
      code: `CLAIM_${typeName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
      kind: "reimbursement",
      category: "claim",
      label: `Claims reimbursement: ${typeName}`,
      amountCents: cents,
      wageClass: null,
      cpfLiable: false,
      detail: null,
      itemId: null,
    });
  }

  // 9. Employer costs.
  if (cpfEmployerShown > 0) {
    lines.push({
      code: "CPF_EMPLOYER",
      kind: "employer",
      category: "cpf_employer",
      label: "Employer CPF",
      amountCents: cpfEmployerShown,
      wageClass: null,
      cpfLiable: false,
      detail: shortfall ? `includes the employer share of CPF on earlier AW` : null,
      itemId: null,
    });
  }
  if (absorbed > 0) {
    lines.push({
      code: "CPF_EMPLOYEE_SHARE_ABSORBED",
      kind: "employer",
      category: "cpf_employer",
      label: "Employee CPF on AW top-up, borne by employer",
      amountCents: absorbed,
      wageClass: null,
      cpfLiable: false,
      detail: "not statutory employer CPF",
      itemId: null,
    });
  }
  let fwlCents = 0;
  const pass = employee.workPass;
  if (!isBonusRun && pass && (pass.type === "S_PASS" || pass.type === "WP")) {
    if (pass.type === "WP" && !input.fwl) {
      issues.push({
        code: "FWL_SETTINGS_MISSING",
        severity: "info",
        message: "Set the levy sector, tier and skill in payroll settings to estimate the Work Permit levy.",
        source: null,
      });
    } else {
      try {
        const est = estimateLevy({
          month: run.month,
          pass: pass.type === "WP" ? "WORK_PERMIT" : "S_PASS",
          sector: pass.type === "WP" ? (input.fwl?.sector as string) : "ALL",
          tier: pass.type === "WP" ? (input.fwl?.tier as string) : "ALL",
          skill: pass.type === "WP" ? (input.fwl?.skill ?? null) : null,
          passIssuedOn: pass.issuedOn ?? employment.hireDate,
          ...(pass.cancelledOn
            ? { passEnds: { date: pass.cancelledOn, reason: "CANCELLED" as const } }
            : pass.expiresOn <= run.periodEnd
              ? { passEnds: { date: pass.expiresOn, reason: "EXPIRED" as const } }
              : {}),
        });
        fwlCents = est.estimateCents;
        working.push(...mapSteps("fwl", est.working));
        for (const i of est.issues)
          issues.push({
            code: i.code,
            severity: i.severity === "blocking" ? "warning" : i.severity,
            message: i.message,
            source: i.source ?? null,
          });
        rules.push({
          family: "FWL (estimate)",
          id: `${est.rate.pass} ${est.rate.sector} ${est.rate.tier}${est.rate.skill ? ` ${est.rate.skill}` : ""}`,
          effectiveFrom: est.rate.effectiveFrom,
          effectiveTo: est.rate.effectiveTo,
          source: est.rate.source,
        });
        if (fwlCents > 0)
          lines.push({
            code: "FWL",
            kind: "employer",
            category: "fwl",
            label: "Foreign worker levy (estimate)",
            amountCents: fwlCents,
            wageClass: null,
            cpfLiable: false,
            detail: "MOM's levy bill is authoritative; never deducted from pay",
            itemId: null,
          });
      } catch (err) {
        const i = errorIssue(err, "FWL estimate");
        issues.push({ ...i, severity: "warning" });
      }
    }
  }

  // 10. Net.
  const employeeDeductions = cpfEe + recovered + shgShownTotal + otherDeductions;
  const netCents = grossCents + reimbursementsCents - employeeDeductions;
  const netPayableCents = netCents - (before?.netPaidByReplacedCents ?? 0);
  if (netCents < 0) {
    issues.push({
      code: "NET_NEGATIVE",
      severity: "blocking",
      message: `Net pay is ${sgd(netCents)}. Reduce deductions so that net pay is not negative.`,
      source: MOM_DEDUCTIONS_SOURCE,
    });
  }
  if (run.kind === "adjustment") {
    working.push({
      section: "pay",
      code: "ADJUSTMENT_NET",
      text: `Revised net ${sgd(netCents)} − net already paid ${sgd(before?.netPaidByReplacedCents ?? 0)} = ${netPayableCents >= 0 ? "to pay" : "overpaid"} ${sgd(Math.abs(netPayableCents))}.`,
    });
    if (netPayableCents < 0) {
      issues.push({
        code: "ADJUSTMENT_OVERPAID",
        severity: "warning",
        message: `The employee was overpaid ${sgd(-netPayableCents)}. Recover it with an "Overpaid salary recovery" deduction in a later run (outside the 50% limit).`,
        source: MOM_DEDUCTIONS_SOURCE,
      });
    }
  }

  // 11. Payment deadlines for this employee.
  if (lastWorkingDayInPeriod && employment.lastWorkingDay) {
    const lwd = employment.lastWorkingDay;
    const employerTerminates =
      employment.cessationReason === "dismissal" || employment.cessationReason === "retrenchment";
    const due = employerTerminates
      ? addWorkingDays(lwd, paymentDeadlines(lwd).finalPayWorkingDaysWhenEmployerTerminates)
      : lwd;
    if (run.payDate > due) {
      issues.push({
        code: "EA_FINAL_PAY_LATE",
        severity: "warning",
        message: employerTerminates
          ? `Final pay after the employer ends employment is due on the last day (${dateLabel(lwd)}), or within 3 working days if that is not possible (${dateLabel(due)}). The pay date is ${dateLabel(run.payDate)}: use an off-cycle final pay run.`
          : `Final pay is due on the last day of work (${dateLabel(lwd)}) when notice is served; within 7 days if the employee resigned without notice. The pay date is ${dateLabel(run.payDate)}: consider an off-cycle final pay run.`,
        source: MOM_PAYING_SALARY_SOURCE,
      });
    }
  }

  const employerCost =
    cpfEmployerShown + absorbed + Math.floor(Math.max(0, charged.sdlUnits1e4Cent) / 10_000) + fwlCents;
  return {
    engineVersion: ENGINE_VERSION,
    lines,
    totals: {
      basicCents,
      nplCents,
      allowancesCents,
      overtimeCents,
      additionalCents,
      grossCents,
      reimbursementsCents,
      owCpfCents: owCpf,
      awCpfCents: awCpf,
      totalWagesCents,
      cpfEmployeeCents: cpfEe,
      cpfEmployerCents: cpfEmployerShown,
      shgCents: shgShownTotal,
      otherDeductionsCents: otherDeductions,
      employeeDeductionsCents: employeeDeductions,
      netCents,
      netPayableCents,
      cpfAwRecoveredCents: recovered,
      cpfEmployeeShareAbsorbedCents: absorbed,
      sdlUnits1e4Cent: sdl?.units1e4Cent ?? 0,
      fwlCents,
      employerCostCents: employerCost,
    },
    month: {
      owCpfCents: monthOw,
      awCpfCents: monthAw,
      totalWagesCents: monthWages,
      cpfTotalCents: monthCpfTotal,
      cpfEmployeeCents: monthCpfEmployee,
      cpfEmployerCents: monthCpfEmployer,
      shgCents: monthShg,
      sdlUnits1e4Cent: sdl?.units1e4Cent ?? 0,
    },
    charged,
    cpf: cpf
      ? {
          residencyCategory: cpf.residencyCategory,
          ageBand: cpf.ageBand,
          ageBandLabel: cpf.ageBand ? cpfAgeBandLabel(cpf.ageBand) : null,
          rateTableId: cpf.rateTable?.id ?? null,
          wageBand: cpf.wageBand,
          owSubjectCents: cpf.owSubjectCents,
          awSubjectCents: cpf.awSubjectCents,
          awNotSubjectCents: cpf.awNotSubjectCents,
          awCeiling: cpf.awCeiling ? { ...cpf.awCeiling } : null,
          priorAwShortfallCents: shortfall?.totalCents ?? 0,
          priorAwExcessCents: cpf.priorAw.excess?.totalCents ?? 0,
          exactTotal: cpf.exact.totalCents,
          exactEmployee: cpf.exact.employeeCents,
        }
      : null,
    shgFunds,
    overtime: otMinutes > 0 || overtimeCents > 0 ? { minutes: otMinutes, periods: otPeriods } : null,
    awTopUp:
      thisShare > 0 || recoveredEarlier > 0
        ? {
            employeeShareCents: thisShare,
            recoveredThisRunCents: recoveredThis,
            recoveredEarlierCents: recoveredEarlier,
            absorbedCents: absorbed,
            deadline,
          }
        : null,
    hourly,
    rules: dedupeRules(rules),
    working,
    issues: dedupeIssues(issues),
    stateAfter,
  };
}

function addWorkingDays(date: string, n: number): string {
  let d = date;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d;
}

function dedupeRules(rules: RuleRef[]): RuleRef[] {
  const seen = new Set<string>();
  return rules.filter((r) => {
    const k = `${r.family}|${r.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function dedupeIssues(issues: PayIssue[]): PayIssue[] {
  const seen = new Set<string>();
  const order = { blocking: 0, warning: 1, info: 2 } as const;
  return issues
    .filter((i) => {
      const k = `${i.code}|${i.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((i, idx) => ({ i, idx }))
    .sort((a, b) => order[a.i.severity] - order[b.i.severity] || a.idx - b.idx)
    .map(({ i }) => i);
}
