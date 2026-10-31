import { and, eq, ne, sql } from "drizzle-orm";
import { employees } from "../db/schema/employees.ts";
import { organisations } from "../db/schema/organisations.ts";
import type { Db } from "../db/types.ts";
import { AppError } from "../errors.ts";
import { normaliseEmail, normalisePhone } from "./contact.ts";
import { maskIdNumber, validateIdNumber } from "./nric.ts";
import type { PeoplePorts } from "./ports.ts";
import { fieldError } from "./validation.ts";

/** Encrypts an ID number and derives its blind index and display mask. Validates the checksum first. */
export async function sealIdNumber(
  ports: PeoplePorts,
  idType: "nric" | "fin" | "other",
  raw: string,
  field = "idNumber",
): Promise<{ enc: string; hmac: string; masked: string; value: string }> {
  const check = validateIdNumber(idType, raw);
  if (!check.ok) throw fieldError(field, check.message);
  const [enc, hmac] = await Promise.all([
    ports.secretBox.encrypt("nric", check.value),
    ports.secretBox.blindIndex("nric", check.value),
  ]);
  return { enc, hmac, masked: maskIdNumber(check.value), value: check.value };
}

/** 409 `duplicate_id_number` (including former employees), pointing at the rehire flow. */
export async function assertIdNumberFree(db: Db, orgId: string, hmac: string, exceptEmployeeId?: string) {
  const [existing] = await db
    .select({ id: employees.id, name: employees.legalName, number: employees.employeeNumber })
    .from(employees)
    .where(
      and(
        eq(employees.orgId, orgId),
        eq(employees.idNumberHmac, hmac),
        exceptEmployeeId ? ne(employees.id, exceptEmployeeId) : undefined,
      ),
    );
  if (existing) {
    throw new AppError(
      "duplicate_id_number",
      `This ID number already belongs to ${existing.name} (${existing.number}). Rehire this person instead.`,
      {
        existingEmployeeId: existing.id,
        existingEmployeeNumber: existing.number,
        rehireHref: `/people/${existing.id}?action=rehire`,
      },
    );
  }
}

/** Serialises employee-number allocation per organisation by locking the org row. */
export async function nextEmployeeNumber(tx: Db, orgId: string): Promise<string> {
  await tx.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, orgId)).for("update");
  const [row] = await tx
    .select({
      max: sql<
        number | null
      >`max(nullif(regexp_replace(${employees.employeeNumber}, '^E', ''), '')::int) filter (where ${employees.employeeNumber} ~ '^E[0-9]+$')`,
    })
    .from(employees)
    .where(eq(employees.orgId, orgId));
  const next = Number(row?.max ?? 0) + 1;
  return `E${String(next).padStart(4, "0")}`;
}

/** The work email must be unique among active employees (it is the invitation address). */
export async function assertWorkEmailFree(
  db: Db,
  orgId: string,
  email: string,
  today: string,
  exceptEmployeeId?: string,
) {
  const result = await db.execute<{ id: string; name: string }>(sql`
    select e.id, e.legal_name as name from employees e
     where e.org_id = ${orgId}
       and lower(e.work_email) = ${normaliseEmail(email)}
       ${exceptEmployeeId ? sql`and e.id <> ${exceptEmployeeId}` : sql``}
       and exists (
         select 1 from tenures t
          where t.org_id = e.org_id and t.employee_id = e.id
            and (t.last_working_day is null or t.last_working_day >= ${today})
       )
     limit 1
  `);
  const rows = (result as unknown as { rows: { id: string; name: string }[] }).rows ?? [];
  if (rows[0]) {
    throw new AppError(
      "conflict",
      `${rows[0].name} already uses this work email. Each active employee needs their own.`,
      {
        reason: "work_email_taken",
        issues: [{ path: "workEmail", message: "This work email is already used by another active employee." }],
      },
    );
  }
}

export function phoneOrError(raw: string | null | undefined, field: string): string | null {
  if (!raw) return null;
  const r = normalisePhone(raw);
  if (!r.ok) throw fieldError(field, r.message);
  return r.value;
}
