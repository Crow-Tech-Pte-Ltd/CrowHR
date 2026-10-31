/** Wire types of the people API, for clients (apps/web imports these as types only). */
import type { z } from "zod";
import type {
  changeRequestSchema,
  checklistSchema,
  directoryRowSchema,
  employeeDetailSchema,
  importPreviewSchema,
  workPassSchema,
} from "./api-schemas.ts";

export type DirectoryRowDto = z.infer<typeof directoryRowSchema>;
export type EmployeeDetailDto = z.infer<typeof employeeDetailSchema>;
export type ChangeRequestDto = z.infer<typeof changeRequestSchema>;
export type ChecklistDto = z.infer<typeof checklistSchema>;
export type ImportPreviewDto = z.infer<typeof importPreviewSchema>;
export type WorkPassDto = z.infer<typeof workPassSchema>;
export type { CompanyProfileView } from "../organisation/profile.ts";
export type { SetupChecklist, SetupStep } from "../organisation/setup-checklist.ts";
export type { StructureItem, StructureKind } from "../organisation/structure.ts";
export type { WorkScheduleView } from "../organisation/work-schedules.ts";
export type { ChecklistInboxItem, ChecklistTemplateView } from "./checklists.ts";
export type { EventInput } from "./lifecycle.ts";
export type { HireInput } from "./schemas.ts";
