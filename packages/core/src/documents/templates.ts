import { ketRequirements } from "@crowhr/sg-rules";
import type { LetterKind } from "../db/schema/documents.ts";
import { fieldDef, suggestField } from "./fields.ts";
import { anchorsUsed, type Block, fieldsUsed, type MarkdownIssue, parseMarkdown } from "./markdown.ts";

/**
 * Template validation (add-documents specs "Letter templates and merge fields", "KET template").
 * Unknown fields are named with their line and a suggestion; full NRIC is refused; a KET template
 * must keep every mandatory item's anchor and merge fields (MOM's list, from `@crowhr/sg-rules`).
 */

/** Which merge fields carry each MOM KET item (research/sg-regulatory.md §7, sg-rules `KET_RULES`). */
export const KET_ITEM_FIELDS: Record<string, readonly string[]> = {
  employer_name: ["org.legal_name"],
  employee_name: ["employee.full_name"],
  job_title: ["employment.job_title", "terms.main_duties"],
  start_date: ["employment.start_date"],
  duration: ["terms.duration"],
  working_arrangements: ["employment.working_hours", "employment.working_days", "employment.rest_day"],
  salary_period: ["terms.salary_period"],
  basic_salary: ["compensation.basic_pay"],
  fixed_allowances: ["compensation.fixed_allowances"],
  fixed_deductions: ["terms.fixed_deductions"],
  overtime_period: ["terms.overtime_period"],
  overtime_rate: ["terms.overtime_rate"],
  other_salary: ["terms.other_salary"],
  leave: ["terms.leave_types"],
  medical_benefits: ["terms.medical_benefits"],
  probation: ["employment.probation_period"],
  notice: ["employment.notice_period"],
  place_of_work: ["employment.place_of_work"],
};

/** Mandatory KET items as at `asAt`: every MOM item except the optional place of work. */
export function mandatoryKetItems(asAt: string) {
  return ketRequirements({ asAt }).items.filter((i) => i.condition !== "optional");
}

export interface TemplateCheck {
  blocks: Block[];
  issues: MarkdownIssue[];
  fields: string[];
}

export function validateTemplate(kind: LetterKind, body: string, asAt: string): TemplateCheck {
  const { blocks, issues } = parseMarkdown(body);
  const used = fieldsUsed(blocks);
  for (const f of used) {
    if (fieldDef(f.id)) continue;
    if (/^employee\.(nric|fin|id_number|nric_full)$/.test(f.id)) {
      issues.push({
        line: f.line,
        message: `Full NRIC/FIN is not a merge field (line ${f.line}). Use employee.nric_masked.`,
      });
      continue;
    }
    const hint = suggestField(f.id);
    issues.push({
      line: f.line,
      message: `Unknown field ${f.id} on line ${f.line}.${hint ? ` Did you mean ${hint}?` : ""}`,
    });
  }
  if (kind === "ket") {
    const anchors = new Set(anchorsUsed(blocks));
    const ids = new Set(used.map((f) => f.id));
    for (const item of mandatoryKetItems(asAt)) {
      const need = KET_ITEM_FIELDS[item.id] ?? [];
      const missing = need.filter((id) => !ids.has(id));
      if (!anchors.has(item.id) || missing.length) {
        issues.push({
          line: 0,
          message: `The KET template must keep the mandatory item "${item.label}" (<!-- ket:${item.id} --> with ${need.map((n) => `{{${n}}}`).join(", ")}).`,
        });
      }
    }
  }
  issues.sort((a, b) => a.line - b.line);
  return { blocks, issues, fields: [...new Set(used.map((f) => f.id))] };
}

/** The category each kind is filed under by default (offer and KET: Contract & KETs). */
export function defaultCategoryKey(kind: LetterKind): "contract" | "letters" {
  return kind === "offer" || kind === "ket" ? "contract" : "letters";
}

const SIGN_OFF = `Yours sincerely,

**{{signatory.name}}**
{{signatory.title}}
{{org.legal_name}}`;

/**
 * The default KET template, one section per MOM mandatory item (in MOM's order), each with its
 * anchor and merge fields. Organisations may reword it but not remove an item.
 */
export const DEFAULT_KET_TEMPLATE = `# Key Employment Terms

Issued on {{today}} under the Employment Act. Please keep this document for your records.

<!-- ket:employer_name -->
## 1. Employer
{{org.legal_name}} (UEN {{org.uen}}), {{org.address}}

<!-- ket:employee_name -->
## 2. Employee
{{employee.full_name}} (NRIC/FIN {{employee.nric_masked}}), employee number {{employee.number}}

<!-- ket:job_title -->
## 3. Job title, main duties and responsibilities
**{{employment.job_title}}**, {{employment.department}}

{{terms.main_duties}}

<!-- ket:start_date -->
## 4. Start date of employment
{{employment.start_date}}

<!-- ket:duration -->
## 5. Duration of employment
{{terms.duration}}

<!-- ket:working_arrangements -->
## 6. Working arrangements
| Daily working hours | Working days a week | Rest day |
| --- | --- | --- |
| {{employment.working_hours}} | {{employment.working_days}} | {{employment.rest_day}} |

<!-- ket:salary_period -->
## 7. Salary period
{{terms.salary_period}}

<!-- ket:basic_salary -->
## 8. Basic salary
{{compensation.basic_pay}}

<!-- ket:fixed_allowances -->
## 9. Fixed allowances
{{compensation.fixed_allowances}}

<!-- ket:fixed_deductions -->
## 10. Fixed deductions
{{terms.fixed_deductions}}

<!-- ket:overtime_period -->
## 11. Overtime payment period
{{terms.overtime_period}}

<!-- ket:overtime_rate -->
## 12. Overtime rate of pay
{{terms.overtime_rate}}

<!-- ket:other_salary -->
## 13. Other salary-related components
{{terms.other_salary}}

<!-- ket:leave -->
## 14. Leave
{{terms.leave_types}}

<!-- ket:medical_benefits -->
## 15. Medical benefits
{{terms.medical_benefits}}

<!-- ket:probation -->
## 16. Probation period
{{employment.probation_period}}

<!-- ket:notice -->
## 17. Notice period
{{employment.notice_period}}

<!-- ket:place_of_work -->
## 18. Place of work
{{employment.place_of_work}}

\\pagebreak

## Signed for the employer

${SIGN_OFF}
`;

export const DEFAULT_TEMPLATES: readonly { kind: LetterKind; name: string; body: string }[] = [
  { kind: "ket", name: "Key Employment Terms", body: DEFAULT_KET_TEMPLATE },
  {
    kind: "offer",
    name: "Offer letter",
    body: `# Letter of offer

{{today}}

{{employee.full_name}}
{{employee.address}}

Dear {{employee.preferred_name}},

We are pleased to offer you the position of **{{employment.job_title}}** in our {{employment.department}} department, starting on **{{employment.start_date}}**, reporting to {{employment.manager_name}}.

| Term | Detail |
| --- | --- |
| Employment type | {{employment.employment_type}} |
| Basic salary | {{compensation.basic_pay}} |
| Fixed allowances | {{compensation.fixed_allowances}} |
| Probation | {{employment.probation_period}} |
| Working days | {{employment.working_days}} |

Your Key Employment Terms will be issued to you in writing within 14 days of your start date. Please sign and return a copy of this letter to accept the offer.

${SIGN_OFF}
`,
  },
  {
    kind: "confirmation",
    name: "Confirmation of employment",
    body: `# Confirmation of employment

{{today}}

Dear {{employee.preferred_name}},

We are pleased to confirm your appointment as **{{employment.job_title}}** with effect from **{{employment.probation_end}}**, following the successful completion of your probation. Your manager, {{employment.manager_name}}, has recommended your confirmation.

All other terms of your employment remain unchanged.

${SIGN_OFF}
`,
  },
  {
    kind: "salary_adjustment",
    name: "Salary adjustment",
    body: `# Salary adjustment

{{today}}

Dear {{employee.preferred_name}},

We are pleased to inform you that your basic salary will be **{{compensation.basic_pay}}** with effect from **{{terms.effective_date}}**.

All other terms of your employment remain unchanged.

${SIGN_OFF}
`,
  },
  {
    kind: "employment_certificate",
    name: "Certificate of employment",
    body: `# Certificate of employment

{{today}}

**To whom it may concern**

This is to certify that **{{employee.full_name}}** (NRIC/FIN {{employee.nric_masked}}) has been employed by {{org.legal_name}} since **{{employment.start_date}}**, and currently holds the position of **{{employment.job_title}}** in the {{employment.department}} department, on a {{employment.employment_type}} basis.

This letter is issued at the employee's request for the purpose of: {{terms.purpose}}.

${SIGN_OFF}
`,
  },
];
