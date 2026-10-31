import { eq } from "drizzle-orm";
import { z } from "zod";
import { orgScope } from "../access/org-scope.ts";
import { type CompanyProfile, companyProfiles } from "../db/schema/organisation.ts";
import { organisations } from "../db/schema/organisations.ts";
import type { AppDeps } from "../deps.ts";
import { type Actor, assertCanWrite } from "../employees/access.ts";
import { diffOf, recordAudit } from "../employees/audit-helpers.ts";
import type { PeoplePorts } from "../employees/ports.ts";
import { isUniqueViolation, parseInput } from "../employees/validation.ts";
import { AppError } from "../errors.ts";
import { isValidUen, normaliseUen, UEN_FORMAT_MESSAGE, validateCsn } from "./uen.ts";

const optionalText = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v === "" ? null : v))
  .nullish();

export const companyProfileInput = z
  .object({
    legalName: z.string().trim().min(1, "Enter the company's legal name as registered with ACRA.").max(200),
    tradingName: optionalText,
    uen: z.string().transform(normaliseUen).refine(isValidUen, { message: UEN_FORMAT_MESSAGE }),
    csn: z
      .string()
      .transform(normaliseUen)
      .transform((v) => (v === "" ? null : v))
      .nullish(),
    addressBlock: optionalText,
    addressStreet: optionalText,
    addressUnit: optionalText,
    addressBuilding: optionalText,
    postalCode: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .refine((v) => v === null || /^\d{6}$/.test(v), {
        message: "Enter a 6-digit Singapore postal code, like 018956.",
      })
      .nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.csn) {
      const check = validateCsn(v.csn, v.uen);
      if (!check.ok) ctx.addIssue({ code: "custom", path: ["csn"], message: check.message });
    }
  });

export type CompanyProfileInput = z.input<typeof companyProfileInput>;

export interface CompanyProfileView {
  legalName: string;
  tradingName: string | null;
  uen: string;
  csn: string | null;
  address: {
    block: string | null;
    street: string | null;
    unit: string | null;
    building: string | null;
    postalCode: string | null;
  };
  hasLogo: boolean;
  timeZone: "Asia/Singapore";
  currency: "SGD";
  /** UEN, CSN and address complete: payroll may be finalised. */
  payrollReady: boolean;
  missingForPayroll: string[];
  updatedAt: string;
}

export function missingForPayroll(p: CompanyProfile | null): string[] {
  if (!p) return ["uen", "csn", "address"];
  const missing: string[] = [];
  if (!p.uen) missing.push("uen");
  if (!p.csn) missing.push("csn");
  if (!p.addressStreet || !p.postalCode) missing.push("address");
  return missing;
}

export function toView(p: CompanyProfile): CompanyProfileView {
  const missing = missingForPayroll(p);
  return {
    legalName: p.legalName,
    tradingName: p.tradingName,
    uen: p.uen,
    csn: p.csn,
    address: {
      block: p.addressBlock,
      street: p.addressStreet,
      unit: p.addressUnit,
      building: p.addressBuilding,
      postalCode: p.postalCode,
    },
    hasLogo: p.logoFileKey !== null,
    timeZone: "Asia/Singapore",
    currency: "SGD",
    payrollReady: missing.length === 0,
    missingForPayroll: missing,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function getCompanyProfile(deps: AppDeps, orgId: string): Promise<CompanyProfile | null> {
  const org = orgScope(deps.db, orgId);
  const [row] = await deps.db.select().from(companyProfiles).where(org.where(companyProfiles));
  return row ?? null;
}

/** For payroll finalisation (spec: blocked until UEN, CSN and address are complete). */
export async function assertPayrollReadyProfile(deps: AppDeps, orgId: string): Promise<void> {
  const missing = missingForPayroll(await getCompanyProfile(deps, orgId));
  if (missing.length) {
    throw new AppError(
      "conflict",
      `Complete the company profile before finalising payroll: ${missing.join(", ")} missing (Settings → Company).`,
      { reason: "company_profile_incomplete", missing },
    );
  }
}

export async function saveCompanyProfile(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  raw: unknown,
): Promise<CompanyProfileView> {
  assertCanWrite(actor, "structure");
  const input = parseInput(companyProfileInput, raw);
  const before = await getCompanyProfile(deps, actor.orgId);
  const values = {
    legalName: input.legalName,
    tradingName: input.tradingName ?? null,
    uen: input.uen,
    csn: input.csn ?? null,
    addressBlock: input.addressBlock ?? null,
    addressStreet: input.addressStreet ?? null,
    addressUnit: input.addressUnit ?? null,
    addressBuilding: input.addressBuilding ?? null,
    postalCode: input.postalCode ?? null,
    updatedAt: deps.clock.now(),
  };
  const row = await deps.db
    .transaction(async (tx) => {
      const [saved] = await tx
        .insert(companyProfiles)
        .values({ orgId: actor.orgId, ...values })
        .onConflictDoUpdate({ target: companyProfiles.orgId, set: values })
        .returning();
      // Keep the foundation's organisations.name/uen in step with the legal entity.
      await tx
        .update(organisations)
        .set({ name: input.tradingName || input.legalName, uen: input.uen, updatedAt: deps.clock.now() })
        .where(eq(organisations.id, actor.orgId));
      const { updatedAt: _u, ...after } = values;
      await recordAudit(tx, ports, actor, {
        action: before ? "company_profile.updated" : "company_profile.created",
        targetType: "organisation",
        targetId: actor.orgId,
        diff: diffOf(before as Record<string, unknown> | null, after),
      });
      return saved as CompanyProfile;
    })
    .catch((err: unknown) => {
      if (isUniqueViolation(err)) {
        throw new AppError("conflict", "Another organisation on this server already uses this UEN.", {
          reason: "uen_taken",
        });
      }
      throw err;
    });
  return toView(row);
}

const LOGO_TYPES = new Map([
  ["image/png", "png"],
  ["image/svg+xml", "svg"],
]);
export const MAX_LOGO_BYTES = 1024 * 1024;

export async function saveCompanyLogo(
  deps: AppDeps,
  ports: PeoplePorts,
  actor: Actor,
  file: { data: Uint8Array; contentType: string },
): Promise<void> {
  assertCanWrite(actor, "structure");
  const ext = LOGO_TYPES.get(file.contentType);
  if (!ext) throw new AppError("validation_failed", "Upload the logo as a PNG or SVG file.", { field: "logo" });
  if (file.data.byteLength > MAX_LOGO_BYTES) {
    throw new AppError("validation_failed", "The logo must be at most 1 MB. Export a smaller PNG or use SVG.", {
      field: "logo",
    });
  }
  const profile = await getCompanyProfile(deps, actor.orgId);
  if (!profile) throw new AppError("conflict", "Save the company profile (legal name and UEN) before adding a logo.");
  const key = `org/${actor.orgId}/company/logo.${ext}`;
  await deps.fileStore.put(key, file.data, { contentType: file.contentType });
  await deps.db.transaction(async (tx) => {
    await tx
      .update(companyProfiles)
      .set({ logoFileKey: key, logoContentType: file.contentType, updatedAt: deps.clock.now() })
      .where(actor.org.where(companyProfiles));
    await recordAudit(tx, ports, actor, {
      action: "company_profile.logo_updated",
      targetType: "organisation",
      targetId: actor.orgId,
      meta: { contentType: file.contentType, size: file.data.byteLength },
    });
  });
}

export async function readCompanyLogo(deps: AppDeps, orgId: string) {
  const profile = await getCompanyProfile(deps, orgId);
  if (!profile?.logoFileKey) throw new AppError("not_found", "No logo has been uploaded.");
  const file = await deps.fileStore.get(profile.logoFileKey);
  if (!file) throw new AppError("not_found", "No logo has been uploaded.");
  return file;
}
