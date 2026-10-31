import { WORK_PATTERNS } from "@crowhr/sg-rules";
import { monthBounds } from "../payroll/engine/dates.ts";
import { ENGINE_VERSION, type PayInput, type RunItemInput } from "../payroll/engine/types.ts";

/** A PayInput for engine unit tests: SC born 1990, S$4,000.00/month, Mon–Fri, full October 2026. */
export function payInput(overrides: DeepPartial<PayInput> = {}): PayInput {
  const month = overrides.run?.month ?? "2026-10";
  const { start, end } = monthBounds(month);
  const base: PayInput = {
    engineVersion: ENGINE_VERSION,
    run: {
      id: "run-1",
      kind: "regular",
      offCycleReason: null,
      month,
      periodStart: start,
      periodEnd: end,
      payDate: end,
    },
    employer: { legalName: "Kopi Kaki Pte. Ltd." },
    employee: {
      id: "emp-1",
      employeeNumber: "E0001",
      legalName: "Tan Mei Ling",
      idMasked: "S****567D",
      dob: "1990-04-12",
      residency: { status: "SC" },
      race: ["chinese"],
      isMuslim: false,
      shgOptedOut: false,
      workPass: null,
      isWorkman: false,
    },
    employment: {
      hireDate: "2020-01-06",
      lastWorkingDay: null,
      cessationReason: null,
      pattern: [...WORK_PATTERNS.FIVE_DAY] as unknown as PayInput["employment"]["pattern"],
      weeklyMinutes: 2400,
      jobTitle: "Account Executive",
      department: "Sales",
    },
    compensation: [{ from: "2020-01-06", to: null, payBasis: "monthly", amountCents: 400_000 }],
    allowances: [],
    items: [],
    reimbursements: [],
    cpfStateBefore: { owSubjectCents: 0, awPayments: [] },
    cpfStateSource: "test",
    monthBefore: null,
    fwl: null,
    snapshotIssues: [],
  };
  return merge(base, overrides) as PayInput;
}

let seq = 0;
export function item(partial: Partial<RunItemInput> & Pick<RunItemInput, "kind">): RunItemInput {
  seq++;
  return {
    id: `item-${String(seq).padStart(6, "0")}`,
    label: partial.kind,
    amountCents: null,
    wageClass: null,
    cpfLiable: true,
    awPayableDate: null,
    minutes: null,
    days: null,
    date: null,
    periodStart: null,
    periodEnd: null,
    deductionCategory: null,
    source: "manual",
    ...partial,
  };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object | null ? DeepPartial<T[K]> | T[K] : T[K];
};

function merge(a: unknown, b: unknown): unknown {
  if (b === undefined) return a;
  if (
    Array.isArray(b) ||
    b === null ||
    typeof b !== "object" ||
    a === null ||
    typeof a !== "object" ||
    Array.isArray(a)
  )
    return b;
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>))
    out[k] = merge((a as Record<string, unknown>)[k], v);
  return out;
}
