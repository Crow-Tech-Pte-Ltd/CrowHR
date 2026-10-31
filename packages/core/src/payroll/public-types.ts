/** Wire types of the payroll API, for clients (apps/web imports these as types only). */
import type { z } from "zod";
import type {
  employeeDetailSchema,
  ir8aPreviewSchema,
  issueSchema,
  itemInputSchema,
  itemSchema,
  overviewSchema,
  payResultSchema,
  payslipSummarySchema,
  payslipViewSchema,
  rowSchema,
  runSchema,
  runSummarySchema,
  settingsSchema,
} from "./api-schemas.ts";

export type PayrollRunDto = z.infer<typeof runSchema>;
export type PayrollRunSummaryDto = z.infer<typeof runSummarySchema>;
export type PayrollOverviewDto = z.infer<typeof overviewSchema>;
export type PayrollRowDto = z.infer<typeof rowSchema>;
export type PayrollIssueDto = z.infer<typeof issueSchema>;
export type PayrollEmployeeDetailDto = z.infer<typeof employeeDetailSchema>;
export type PayrollResultDto = z.infer<typeof payResultSchema>;
export type PayrollItemDto = z.infer<typeof itemSchema>;
export type PayrollItemInput = z.input<typeof itemInputSchema>;
export type PayslipViewDto = z.infer<typeof payslipViewSchema>;
export type PayslipSummaryDto = z.infer<typeof payslipSummarySchema>;
export type PayrollSettingsDto = z.infer<typeof settingsSchema>;
export type PayrollIr8aPreviewDto = z.infer<typeof ir8aPreviewSchema>;
export type { DeductionCategory } from "./rules.ts";
