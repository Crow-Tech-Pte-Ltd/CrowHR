import type { z } from "zod";

/**
 * Field sensitivity classes (access-control spec "Field-level sensitivity"):
 * - `salary`: basic pay, allowances, payslip amounts, payroll lines, claim payout on payslip.
 * - `nric`: NRIC/FIN, passport number, work pass number.
 * - `bank`: bank account number and account name.
 * - `medical`: medical-category documents, sick-leave certificates, medical claim receipts.
 */
export type SensitivityClass = "salary" | "nric" | "bank" | "medical";

export const SENSITIVITY_META_KEY = "x-sensitivity";

/**
 * Marks a response field as sensitive. `redact()` drops it for readers without access and
 * the OpenAPI document shows `x-sensitivity`. Put modifiers inside: `sensitive(z.string().optional(), "nric")`.
 */
export function sensitive<T extends z.ZodType>(schema: T, cls: SensitivityClass): T {
  return schema.meta({ [SENSITIVITY_META_KEY]: cls }) as T;
}

/** The sensitivity class declared on a schema (looking through optional/nullable wrappers). */
export function sensitivityOf(schema: z.ZodType): SensitivityClass | undefined {
  let current: z.ZodType | undefined = schema;
  for (let depth = 0; current && depth < 5; depth++) {
    const meta = current.meta() as Record<string, unknown> | undefined;
    const cls = meta?.[SENSITIVITY_META_KEY];
    if (typeof cls === "string") return cls as SensitivityClass;
    const inner: z.ZodType | undefined = (current as unknown as { _zod: { def: { innerType?: z.ZodType } } })._zod.def
      .innerType;
    current = inner;
  }
  return undefined;
}
