import { checkEmploymentAge, RulesNotAvailableError, SgRulesInputError } from "@crowhr/sg-rules";

export interface AgeNotice {
  code: string;
  severity: "blocking" | "warning";
  message: string;
  source: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The Employment Act conditions for a young hire on the start date (s 68 and the Employment of
 * Children and Young Persons Regulations, via sg-rules `checkEmploymentAge`): the same check the
 * server runs on hire. Empty when either date is missing or invalid, or the start date is before the
 * encoded rules.
 */
export function ageNotices(dob: string, startDate: string): AgeNotice[] {
  if (!ISO.test(dob) || !ISO.test(startDate) || dob >= startDate) return [];
  try {
    return checkEmploymentAge({ dob, onDate: startDate }).issues.map((i) => ({
      code: i.code,
      severity: i.severity === "blocking" ? "blocking" : "warning",
      message: i.message,
      source: i.source ?? null,
    }));
  } catch (err) {
    if (err instanceof RulesNotAvailableError || err instanceof SgRulesInputError) return [];
    throw err;
  }
}
