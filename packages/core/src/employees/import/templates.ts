import type { ImportKind } from "../../db/schema/employees.ts";
import { toCsv } from "./parse.ts";

/**
 * Import templates. Columns map one-to-one to fields. `version` is bumped
 * when columns change so old files are recognised (the payroll change may
 * extend the YTD template).
 */
export interface TemplateColumn {
  name: string;
  required: boolean;
  help: string;
  example: string;
}

export interface ImportTemplate {
  kind: ImportKind;
  version: number;
  fileName: string;
  columns: TemplateColumn[];
}

const col = (name: string, required: boolean, help: string, example: string): TemplateColumn => ({
  name,
  required,
  help,
  example,
});

export const TEMPLATES: Record<ImportKind, ImportTemplate> = {
  employees: {
    kind: "employees",
    // v2 adds workman and manager_or_executive (optional, so v1 files still import).
    version: 2,
    fileName: "crowhr-employees-template-v2.csv",
    columns: [
      col("employee_number", false, "Leave empty to auto-number (E0001…).", ""),
      col("legal_name", true, "As on the NRIC, FIN card or passport.", "Tan Mei Ling"),
      col(
        "preferred_name",
        false,
        "The name they go by, e.g. Hafiz for Muhammad Hafiz bin Ismail. Used in greetings and the directory. Leave empty to use the legal name.",
        "Mei Ling",
      ),
      col("id_type", true, "nric, fin or other.", "nric"),
      col("id_number", true, "NRIC/FIN with check letter, or passport number.", "S1234567D"),
      col("date_of_birth", true, "YYYY-MM-DD or DD/MM/YYYY.", "12/04/1990"),
      col("gender", false, "female, male, other or undisclosed.", "female"),
      col("nationality", false, "Country name.", "Singaporean"),
      col("residency_status", true, "citizen, pr or foreigner.", "citizen"),
      col("pr_start_date", false, "Required for pr: SPR status date on the ICA entry permit.", ""),
      col("race", false, "chinese, malay, indian, eurasian or other (SHG fund).", "chinese"),
      col(
        "religion",
        false,
        "buddhism, christianity, islam, hinduism, taoism, sikhism, other, none or undisclosed.",
        "buddhism",
      ),
      col("work_email", false, "Used for the sign-in invitation.", "meiling@example.sg"),
      col("personal_email", false, "", ""),
      col("mobile", false, "8-digit SG number or +country code.", "91234567"),
      col("hire_date", true, "First day of work.", "2026-01-05"),
      col("job_title", true, "", "Account Executive"),
      col("department", true, "Must match an existing department name.", "Sales"),
      col("team", false, "Existing team name.", ""),
      col("location", false, "Existing location name.", ""),
      col("cost_centre", false, "Existing cost centre code.", ""),
      col("manager_employee_number", false, "Employee number of the manager (existing, or earlier in this file).", ""),
      col("employment_type", true, "full_time, part_time, contract or intern.", "full_time"),
      col("work_schedule", false, "Schedule name; empty = the default schedule.", ""),
      col("probation_end", false, "YYYY-MM-DD or DD/MM/YYYY.", ""),
      col(
        "workman",
        false,
        "yes for a workman (mainly manual work). Employment Act Part 4 covers workmen up to S$4,500 basic pay a month, other employees up to S$2,600. Empty means no.",
        "no",
      ),
      col(
        "manager_or_executive",
        false,
        "yes for a manager or executive (Employment Act Part 4 does not cover them: no statutory overtime, no Part 4 leave carry-forward floor). Empty means no.",
        "no",
      ),
      col("pay_basis", false, "monthly or hourly. Needs payroll access.", "monthly"),
      col("basic_pay", false, "Dollars, up to 2 decimals. Needs payroll access.", "4000.00"),
      col("pass_type", false, "Foreigners: EP, S_PASS, WP, DP_LOC, LTVP_LOC, PEP, ONE, TEP or OTHER.", ""),
      col("pass_number", false, "FIN or work permit number.", ""),
      col("pass_issued_on", false, "", ""),
      col("pass_expires_on", false, "Required with pass_type.", ""),
    ],
  },
  compensation: {
    kind: "compensation",
    version: 1,
    fileName: "crowhr-compensation-template-v1.csv",
    columns: [
      col("employee_number", true, "Existing employee.", "E0001"),
      col("effective_from", true, "YYYY-MM-DD or DD/MM/YYYY.", "2027-01-01"),
      col("pay_basis", true, "monthly or hourly.", "monthly"),
      col("basic_pay", true, "Dollars, up to 2 decimals.", "4200.00"),
      col("reason", false, "", "Annual increment"),
      col("retroactive", false, "yes when dated in a finalised payroll month.", "no"),
    ],
  },
  ytd: {
    kind: "ytd",
    version: 1,
    fileName: "crowhr-ytd-opening-balances-template-v1.csv",
    columns: [
      col("employee_number", true, "Existing employee.", "E0001"),
      col("year", true, "Calendar year, e.g. 2026.", "2026"),
      col("through_month", true, "Last month paid in the previous system: 1-12 or YYYY-MM.", "6"),
      col("ow_ytd", true, "Ordinary wages paid, dollars.", "36000.00"),
      col("ow_cpf_ytd", false, "Ordinary wages subject to CPF (after the OW ceiling), dollars.", "36000.00"),
      col("aw_ytd", true, "Additional wages paid (bonus, AWS), dollars.", "0.00"),
      col("aw_cpf_ytd", false, "Additional wages subject to CPF, dollars.", "0.00"),
      col("cpf_ee_ytd", true, "Employee CPF, dollars.", "7200.00"),
      col("cpf_er_ytd", true, "Employer CPF, dollars.", "6120.00"),
      col("shg_ytd", true, "SHG deductions (CDAC/ECF/MBMF/SINDA), dollars.", "9.00"),
      col("sdl_ytd", false, "SDL paid, dollars.", "54.00"),
    ],
  },
};

export function templateCsv(kind: ImportKind): string {
  const t = TEMPLATES[kind];
  return toCsv(
    t.columns.map((c) => c.name),
    [t.columns.map((c) => c.example)],
  );
}
