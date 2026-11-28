import { z } from "zod";
import { orgScope } from "../access/org-scope.ts";
import { type AuditContext, recordAudit } from "../audit/audit.ts";
import { orgAppearance } from "../db/schema/appearance.ts";
import type { Organisation } from "../db/schema/organisations.ts";
import type { Db } from "../db/types.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { looksPolyglot, sniffType } from "../files/sniff.ts";
import { getCompanyProfile, readCompanyLogo } from "./profile.ts";

const accent = z.string().regex(/^#[0-9a-f]{6}$/i, "Enter a hex colour like #165E85.");
const logoBase64 = z.base64().max(350_000, "Use a PNG logo no larger than 256 KB.");
export const appearanceInput = z.object({
  accent: accent.nullable().default(null),
  logoBase64: logoBase64.nullable().optional(),
  useDocumentLogo: z.boolean().default(false),
});
export type AppearanceInput = z.infer<typeof appearanceInput>;
export const appearanceView = z.object({
  accent: accent.nullable(),
  logoUrl: z.string().nullable(),
  logoSource: z.enum(["custom", "document", "none"]),
});
export const defaultAppearance: z.infer<typeof appearanceView> = { accent: null, logoUrl: null, logoSource: "none" };

function png(value: string): Uint8Array {
  const bytes = Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));
  if (
    bytes.length < 24 ||
    bytes.length > 256 * 1024 ||
    sniffType(bytes) !== "image/png" ||
    looksPolyglot(bytes) ||
    String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR"
  ) {
    throw new AppError("validation_failed", "Choose a PNG logo no larger than 256 KB.");
  }
  const header = new DataView(bytes.buffer);
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  if (width < 1 || height < 1 || width > 2048 || height > 2048) {
    throw new AppError("validation_failed", "Resize the PNG logo to at most 2048 × 2048 pixels.");
  }
  return bytes;
}

export async function saveAppearance(deps: AppDeps, db: Db, ctx: AuditContext, input: AppearanceInput) {
  if (input.logoBase64) png(input.logoBase64);
  const org = orgScope(db, ctx.orgId);
  const updatedAt = deps.clock.now();
  const values = { accent: input.accent?.toUpperCase() ?? null, useDocumentLogo: input.useDocumentLogo, updatedAt };
  await db
    .insert(orgAppearance)
    .values(org.values({ ...values, logoBase64: input.logoBase64 ?? null }))
    .onConflictDoUpdate({
      target: orgAppearance.orgId,
      set: { ...values, ...(input.logoBase64 === undefined ? {} : { logoBase64: input.logoBase64 }) },
    });
  await recordAudit(db, deps, ctx, {
    action: "company_appearance.updated",
    targetType: "organisation",
    targetId: ctx.orgId,
    meta: { accent: values.accent, useDocumentLogo: input.useDocumentLogo },
  });
}

async function readAppearance(deps: AppDeps, orgId: string) {
  const org = orgScope(deps.db, orgId);
  const [row] = await deps.db.select().from(orgAppearance).where(org.where(orgAppearance));
  return row;
}

export async function companyAppearance(deps: AppDeps, org: Organisation | null) {
  if (!org?.slug || org.demoExpiresAt) return defaultAppearance;
  const row = await readAppearance(deps, org.id);
  if (!row) return defaultAppearance;
  const profile = row.useDocumentLogo ? await getCompanyProfile(deps, org.id) : null;
  const logoSource = row.useDocumentLogo ? "document" : row.logoBase64 ? "custom" : "none";
  return {
    accent: row.accent,
    logoSource,
    logoUrl:
      logoSource === "custom" || profile?.logoFileKey
        ? `/api/v1/organisation/appearance/logo?${new URLSearchParams({ org: org.slug, v: (profile?.updatedAt ?? row.updatedAt).toISOString() })}`
        : null,
  } as const;
}

export async function appearanceLogo(deps: AppDeps, org: Organisation | null) {
  if (!org || org.demoExpiresAt) throw new AppError("not_found", "No logo has been uploaded.");
  const row = await readAppearance(deps, org.id);
  if (row?.useDocumentLogo) return (await readCompanyLogo(deps, org.id)).data;
  if (!row?.logoBase64) throw new AppError("not_found", "No logo has been uploaded.");
  return png(row.logoBase64);
}
