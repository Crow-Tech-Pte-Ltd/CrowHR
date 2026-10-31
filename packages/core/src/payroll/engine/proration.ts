import { incompleteMonthSalary, WORK_PATTERNS, type WorkPattern, workingDaysInMonth } from "@crowhr/sg-rules";
import { EA_S20A_SOURCE, MOM_INCOMPLETE_MONTH_SOURCE } from "../rules.ts";
import { addDays, dateLabel, dayOfWeek, eachDay, maxDate, minDate, sgd } from "./dates.ts";
import type { AllowanceInput, CompensationSegment, PayInput, PayIssue, PayLine, WorkingLine } from "./types.ts";

/**
 * Basic pay and recurring allowances for one employee-month by MOM's incomplete-month formula:
 * monthly gross rate / working days in the month × days actually worked (research §5.5). Applied
 * per compensation segment and per allowance, each rounded half up to the cent (sg-rules
 * `incompleteMonthSalary`); summing the rounded segments is our documented policy (MOM publishes no
 * rule for a mid-month rate change).
 */

export interface ProrationResult {
  lines: PayLine[];
  working: WorkingLine[];
  issues: PayIssue[];
  /** Basic as if no no-pay leave (full monthly, or pro-rated for joining/leaving/rate change). */
  basicCents: number;
  nplCents: number;
  allowanceOwCents: number;
  allowanceNonCpfCents: number;
  /** CPF projection for later months when this month is pro-rated: the full monthly OW. */
  fullMonthlyOwCents: number;
  /** Basic monthly rate in force at the end of the employment window (OT base). */
  monthlyBasicAtEndCents: number | null;
  hourly: { rateCents: number; minutes: number } | null;
  /** True when anything was pro-rated (CPF projection uses `fullMonthlyOwCents`). */
  prorated: boolean;
  window: { start: string; end: string } | null;
}

function blocking(code: string, message: string, source: string | null = MOM_INCOMPLETE_MONTH_SOURCE): PayIssue {
  return { code, severity: "blocking", message, source };
}

/** Working days (multiples of 0.5) between two dates inclusive, by pattern. */
export function workingDaysBetween(from: string, to: string, pattern: WorkPattern): number {
  let half = 0;
  if (from > to) return 0;
  for (const d of eachDay(from, to)) half += (pattern[dayOfWeek(d)] as number) * 2;
  return half / 2;
}

const segmentEnd = (s: { to: string | null }, fallback: string) =>
  s.to ? minDate(addDays(s.to, -1), fallback) : fallback;

function overlaps(from: string, to: string | null, start: string, end: string) {
  return from <= end && (to === null || to > start);
}

export function prorate(input: PayInput): ProrationResult {
  const { run, employment } = input;
  const working: WorkingLine[] = [];
  const issues: PayIssue[] = [];
  const lines: PayLine[] = [];
  const out: ProrationResult = {
    lines,
    working,
    issues,
    basicCents: 0,
    nplCents: 0,
    allowanceOwCents: 0,
    allowanceNonCpfCents: 0,
    fullMonthlyOwCents: 0,
    monthlyBasicAtEndCents: null,
    hourly: null,
    prorated: false,
    window: null,
  };
  const start = maxDate(run.periodStart, employment.hireDate);
  const end = employment.lastWorkingDay ? minDate(run.periodEnd, employment.lastWorkingDay) : run.periodEnd;
  if (start > end) {
    issues.push(
      blocking(
        "NOT_EMPLOYED_IN_PERIOD",
        `Not employed between ${dateLabel(run.periodStart)} and ${dateLabel(run.periodEnd)} (joined ${dateLabel(employment.hireDate)}${employment.lastWorkingDay ? `, last day ${dateLabel(employment.lastWorkingDay)}` : ""}). Remove them from the run.`,
        null,
      ),
    );
    return out;
  }
  out.window = { start, end };
  const pattern: WorkPattern = employment.pattern ?? WORK_PATTERNS.FIVE_DAY;
  const W = workingDaysInMonth(run.month, pattern);
  const segments = input.compensation
    .filter((s) => overlaps(s.from, s.to, start, end))
    .sort((a, b) => (a.from < b.from ? -1 : 1));
  if (segments.length === 0) {
    issues.push(
      blocking(
        "NO_COMPENSATION",
        `No basic pay is recorded for ${dateLabel(start)}–${dateLabel(end)}. Add compensation on the employee's Pay tab, then recompute.`,
        null,
      ),
    );
    return out;
  }
  const npl = input.items.filter((i) => i.kind === "unpaid_leave");
  const hours = input.items.filter((i) => i.kind === "hours");
  const hourlySegs = segments.filter((s) => s.payBasis === "hourly");
  if (hourlySegs.length > 0 && hourlySegs.length !== segments.length) {
    issues.push(
      blocking(
        "PAY_BASIS_CHANGES_IN_PERIOD",
        "Pay basis changes between monthly and hourly within this period. Crow HR cannot split one month across both; pay the hourly part as an 'other earning' and recompute.",
        null,
      ),
    );
    return out;
  }
  const lastSeg = segments[segments.length - 1] as CompensationSegment;

  if (hourlySegs.length > 0) {
    const minutes = hours.reduce((s, i) => s + (i.minutes ?? 0), 0);
    if (hours.length === 0) {
      issues.push(
        blocking(
          "HOURS_MISSING",
          `Hourly-rated at ${centsText(lastSeg.amountCents)}/h: enter the hours worked in this period ("Hours worked" item), then recompute.`,
          null,
        ),
      );
      return out;
    }
    const pay = roundHalfUp(lastSeg.amountCents * minutes, 60);
    out.basicCents = pay;
    out.hourly = { rateCents: lastSeg.amountCents, minutes };
    lines.push(
      line("BASIC", "earning", "basic", "Basic pay", pay, `${minutes / 60} h × ${centsText(lastSeg.amountCents)}`),
    );
    working.push({
      section: "basic",
      code: "BASIC_HOURLY",
      text: `Hourly rate ${centsText(lastSeg.amountCents)} × ${minutes / 60} h = ${centsText(pay)} (rounded half up to the cent).`,
    });
    if (npl.length > 0) {
      issues.push({
        code: "NPL_IGNORED_HOURLY",
        severity: "warning",
        message: "No-pay leave is ignored for hourly-rated staff: pay only the hours worked.",
        source: null,
      });
    }
  } else if (
    employment.pattern === null &&
    !(start === run.periodStart && end === run.periodEnd && segments.length === 1 && npl.length === 0)
  ) {
    // Rostered staff (no fixed week): EA s 20A's denominator is the days the employee is required
    // to work in the month, so pro-ration needs the roster's figures; no week pattern is assumed.
    return rostered(input, out, segments, start, end);
  } else {
    // Assign no-pay leave to segments: by date, else the last segment.
    const nplBySeg = new Map<CompensationSegment, number>();
    for (const item of npl) {
      const days = item.days ?? 0;
      if (item.date && (item.date < start || item.date > end)) {
        issues.push(
          blocking(
            "NPL_OUTSIDE_EMPLOYMENT",
            `No-pay leave on ${dateLabel(item.date)} is outside the days employed in this period (${dateLabel(start)}–${dateLabel(end)}). Correct the date.`,
          ),
        );
        continue;
      }
      const seg = item.date
        ? (segments.find((s) => item.date && s.from <= item.date && (s.to === null || item.date < s.to)) ?? lastSeg)
        : lastSeg;
      nplBySeg.set(seg, (nplBySeg.get(seg) ?? 0) + days);
    }
    const complete = start === run.periodStart && end === run.periodEnd && segments.length === 1;
    let paidTotal = 0;
    let fullTotal = 0;
    const details: string[] = [];
    for (const seg of segments) {
      const segStart = maxDate(start, seg.from);
      const segEndDate = segmentEnd(seg, end);
      const worked = workingDaysBetween(segStart, segEndDate, pattern);
      const nplDays = nplBySeg.get(seg) ?? 0;
      if (complete && nplDays === 0) {
        paidTotal += seg.amountCents;
        fullTotal += seg.amountCents;
        working.push({
          section: "basic",
          code: "BASIC_FULL_MONTH",
          text: `Full month at ${centsText(seg.amountCents)}: no pro-ration.`,
        });
        continue;
      }
      if (nplDays > worked) {
        issues.push(
          blocking(
            "NPL_EXCEEDS_DAYS",
            `No-pay leave of ${nplDays} days is more than the ${worked} working days in ${dateLabel(segStart)}–${dateLabel(segEndDate)}. Correct the days.`,
          ),
        );
        continue;
      }
      const full = complete
        ? seg.amountCents
        : incompleteMonthSalary({ monthlyGrossCents: seg.amountCents, workingDaysInMonth: W, daysWorked: worked })
            .payCents;
      const paid = incompleteMonthSalary({
        monthlyGrossCents: seg.amountCents,
        workingDaysInMonth: W,
        daysWorked: worked - nplDays,
      });
      fullTotal += full;
      paidTotal += paid.payCents;
      out.prorated = true;
      details.push(`${worked} of ${W} working days`);
      working.push({
        section: "basic",
        code: "BASIC_INCOMPLETE_MONTH",
        text: `${dateLabel(segStart)}–${dateLabel(segEndDate)} at ${centsText(seg.amountCents)}/month: ${worked} working days${nplDays ? ` − ${nplDays} days no-pay leave` : ""}. ${paid.working[0]?.text ?? ""}`,
      });
    }
    out.basicCents = fullTotal;
    out.nplCents = fullTotal - paidTotal;
    const nplTotal = [...nplBySeg.values()].reduce((s, d) => s + d, 0);
    lines.push(line("BASIC", "earning", "basic", "Basic salary", fullTotal, complete ? null : details.join("; ")));
    if (out.nplCents > 0) {
      lines.push(
        line(
          "NPL",
          "deduction",
          "npl",
          `No-pay leave (${nplTotal} ${nplTotal === 1 ? "day" : "days"})`,
          out.nplCents,
          null,
        ),
      );
      working.push({
        section: "basic",
        code: "NPL",
        text: `No-pay leave = ${centsText(fullTotal)} − ${centsText(paidTotal)} = ${centsText(out.nplCents)}.`,
      });
    }
  }
  out.monthlyBasicAtEndCents = lastSeg.payBasis === "monthly" ? lastSeg.amountCents : null;

  // Recurring allowances.
  let fullAllowanceOw = 0;
  for (const a of [...input.allowances].sort((x, y) =>
    x.code < y.code ? -1 : x.code > y.code ? 1 : x.id < y.id ? -1 : 1,
  )) {
    if (!overlaps(a.from, a.to, start, end)) continue;
    const r = allowancePay(a, start, end, input, pattern, W, lastSeg, npl);
    if (r.issue) issues.push(r.issue);
    if (r.text) working.push({ section: "allowances", code: "ALLOWANCE", text: r.text });
    if (r.payCents === 0) continue;
    lines.push({
      code: `ALLOWANCE_${a.code.toUpperCase()}`,
      kind: "earning",
      category: "allowance",
      label: a.name,
      amountCents: r.payCents,
      wageClass: a.cpfLiable ? "OW" : null,
      cpfLiable: a.cpfLiable,
      detail: r.detail,
      itemId: null,
    });
    if (r.prorated) out.prorated = true;
    if (a.cpfLiable) {
      out.allowanceOwCents += r.payCents;
      fullAllowanceOw += a.amountCents;
    } else out.allowanceNonCpfCents += r.payCents;
  }
  out.fullMonthlyOwCents = (out.monthlyBasicAtEndCents ?? out.basicCents) + fullAllowanceOw;
  return out;
}

function allowancePay(
  a: AllowanceInput,
  start: string,
  end: string,
  input: PayInput,
  pattern: WorkPattern,
  W: number,
  lastSeg: CompensationSegment,
  npl: PayInput["items"],
): { payCents: number; detail: string | null; text: string | null; issue: PayIssue | null; prorated: boolean } {
  const aStart = maxDate(start, a.from);
  const aEnd = segmentEnd(a, end);
  const whole = aStart === input.run.periodStart && aEnd === input.run.periodEnd;
  const nplDays = npl
    .filter((i) => (i.date ? i.date >= aStart && i.date <= aEnd : aEnd === end))
    .reduce((s, i) => s + (i.days ?? 0), 0);
  if (!a.prorate || lastSeg.payBasis === "hourly" || (whole && nplDays === 0)) {
    return {
      payCents: a.amountCents,
      detail: null,
      text: `${a.name}: ${centsText(a.amountCents)}${a.prorate ? "" : " (not pro-rated by policy)"}${a.cpfLiable ? ", CPF-liable OW" : ", not CPF-liable"}.`,
      issue: null,
      prorated: false,
    };
  }
  const worked = workingDaysBetween(aStart, aEnd, pattern);
  const days = Math.max(0, worked - nplDays);
  const r = incompleteMonthSalary({ monthlyGrossCents: a.amountCents, workingDaysInMonth: W, daysWorked: days });
  return {
    payCents: r.payCents,
    detail: `${days} of ${W} working days`,
    text: `${a.name}: ${r.working[0]?.text ?? ""}${a.cpfLiable ? " CPF-liable OW." : " Not CPF-liable."}`,
    issue: null,
    prorated: true,
  };
}

function line(
  code: string,
  kind: PayLine["kind"],
  category: PayLine["category"],
  label: string,
  amountCents: number,
  detail: string | null,
): PayLine {
  return {
    code,
    kind,
    category,
    label,
    amountCents,
    wageClass: kind === "earning" ? "OW" : null,
    cpfLiable: kind === "earning",
    detail,
    itemId: null,
  };
}

/** Half-up integer division for non-negative numerator. */
export function roundHalfUp(numerator: number, denominator: number): number {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  const q = (n * 2n + d) / (2n * d);
  return Number(q);
}

const centsText = sgd;

/**
 * Incomplete month for rostered staff from entered roster figures: scheduled working days in the
 * month (`scheduled_days`, incl. public holidays) and days worked (`days_worked`, incl. public
 * holidays and paid leave, excl. no-pay leave). Blocks without them (payroll-choices.md §4).
 */
function rostered(
  input: PayInput,
  out: ProrationResult,
  segments: CompensationSegment[],
  start: string,
  end: string,
): ProrationResult {
  const sum = (kind: string) => input.items.filter((i) => i.kind === kind).reduce((t, i) => t + (i.days ?? 0), 0);
  const has = (kind: string) => input.items.some((i) => i.kind === kind);
  if (!has("scheduled_days") || !has("days_worked")) {
    out.issues.push(
      blocking(
        "SCHEDULED_DAYS_REQUIRED",
        `This employee works a roster with no fixed week, and ${dateLabel(start)}–${dateLabel(end)} is not a full month of pay. Enter "Scheduled days" (working days the roster required in ${dateLabel(input.run.periodStart).slice(-8)}, including public holidays) and "Days worked" (including public holidays and paid leave, excluding no-pay leave), then recompute.`,
        EA_S20A_SOURCE,
      ),
    );
    return out;
  }
  const W = sum("scheduled_days");
  const worked = sum("days_worked");
  if (segments.length > 1) {
    out.issues.push(
      blocking(
        "ROSTER_RATE_CHANGE_UNSUPPORTED",
        'Basic pay changes within this month for a rostered employee. Crow HR cannot split roster days between rates yet: pay the period at the later rate and enter the difference as an "Other earning".',
      ),
    );
    return out;
  }
  if (W <= 0 || worked > W) {
    out.issues.push(
      blocking(
        "ROSTER_DAYS_INVALID",
        `Days worked (${worked}) must be between 0 and the scheduled days (${W}), and scheduled days more than 0.`,
      ),
    );
    return out;
  }
  const seg = segments[0] as CompensationSegment;
  const paid = incompleteMonthSalary({ monthlyGrossCents: seg.amountCents, workingDaysInMonth: W, daysWorked: worked });
  out.basicCents = paid.payCents;
  out.prorated = true;
  out.monthlyBasicAtEndCents = seg.amountCents;
  out.window = { start, end };
  out.lines.push({
    code: "BASIC",
    kind: "earning",
    category: "basic",
    label: "Basic salary",
    amountCents: paid.payCents,
    wageClass: "OW",
    cpfLiable: true,
    detail: `${worked} of ${W} scheduled days`,
    itemId: null,
  });
  out.working.push({
    section: "basic",
    code: "BASIC_ROSTER",
    text: `Roster: ${W} scheduled days, ${worked} worked. ${paid.working[0]?.text ?? ""}`,
  });
  if (input.items.some((i) => i.kind === "unpaid_leave")) {
    out.issues.push({
      code: "NPL_IN_DAYS_WORKED",
      severity: "info",
      message:
        "For rostered staff, no-pay leave is reflected in the days worked; separate no-pay leave items are not deducted again.",
      source: null,
    });
  }
  let fullAllowanceOw = 0;
  for (const a of [...input.allowances].sort((x, y) =>
    x.code < y.code ? -1 : x.code > y.code ? 1 : x.id < y.id ? -1 : 1,
  )) {
    if (!overlaps(a.from, a.to, start, end)) continue;
    const pay = a.prorate
      ? incompleteMonthSalary({ monthlyGrossCents: a.amountCents, workingDaysInMonth: W, daysWorked: worked }).payCents
      : a.amountCents;
    out.lines.push({
      code: `ALLOWANCE_${a.code.toUpperCase()}`,
      kind: "earning",
      category: "allowance",
      label: a.name,
      amountCents: pay,
      wageClass: a.cpfLiable ? "OW" : null,
      cpfLiable: a.cpfLiable,
      detail: a.prorate ? `${worked} of ${W} scheduled days` : null,
      itemId: null,
    });
    if (a.cpfLiable) {
      out.allowanceOwCents += pay;
      fullAllowanceOw += a.amountCents;
    } else out.allowanceNonCpfCents += pay;
  }
  out.fullMonthlyOwCents = seg.amountCents + fullAllowanceOw;
  return out;
}
