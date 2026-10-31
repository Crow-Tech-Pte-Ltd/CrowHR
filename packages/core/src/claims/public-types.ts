/** Wire types of the claims API, for clients (apps/web imports these as types only). */
import type { z } from "zod";
import type {
  claimRowSchema,
  claimSchema,
  claimTypeInputSchema,
  claimTypeSchema,
  eligibleTypeSchema,
  fileSchema,
  summaryRowSchema,
} from "./api-schemas.ts";

export type ClaimTypeDto = z.infer<typeof claimTypeSchema>;
export type ClaimTypeInputDto = z.input<typeof claimTypeInputSchema>;
export type EligibleClaimTypeDto = z.infer<typeof eligibleTypeSchema>;
export type ClaimFileDto = z.infer<typeof fileSchema>;
export type ClaimDto = z.infer<typeof claimSchema>;
export type ClaimLineDto = ClaimDto["lines"][number];
export type ClaimRowDto = z.infer<typeof claimRowSchema>;
export type ClaimSummaryRowDto = z.infer<typeof summaryRowSchema>;
export type { CapPeriod, ClaimCategory, ClaimStatus, PayoutMethod, ReceiptRule } from "../db/schema/claims.ts";
