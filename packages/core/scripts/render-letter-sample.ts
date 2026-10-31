/**
 * DEV ONLY: renders the default KET template with sample values to a PDF, for visual review.
 *   node packages/core/scripts/render-letter-sample.ts <out.pdf>
 */
import { writeFileSync } from "node:fs";
import { parseMarkdown, resolveFields } from "../src/documents/markdown.ts";
import { DEFAULT_KET_TEMPLATE } from "../src/documents/templates.ts";
import { renderLetterPdf } from "../src/pdf/letter.ts";

const values: Record<string, string> = {
  today: "1 Nov 2026",
  "org.legal_name": "Kopi Kaki Pte. Ltd.",
  "org.uen": "201912345K",
  "org.address": "10 Anson Road, #12-04, Singapore 079903",
  "employee.full_name": "Lee Mei Xin",
  "employee.nric_masked": "T****919A",
  "employee.number": "E0025",
  "employment.job_title": "Barista",
  "employment.department": "Operations",
  "terms.main_duties": "Prepare coffee and serve customers at the Tanjong Pagar outlet; keep the bar clean.",
  "employment.start_date": "1 Nov 2026",
  "terms.duration": "Not applicable: this employment has no fixed end date.",
  "employment.working_hours": "9 hours a day",
  "employment.working_days": "5 days a week (Monday, Tuesday, Wednesday, Thursday, Friday)",
  "employment.rest_day": "Sunday",
  "compensation.basic_pay": "S$2,400.00 a month",
};
const { blocks } = parseMarkdown(DEFAULT_KET_TEMPLATE);
const pdf = await renderLetterPdf({
  title: "Key Employment Terms: Lee Mei Xin",
  org: { name: "Kopi Kaki Pte. Ltd.", address: values["org.address"] ?? null, uen: "201912345K" },
  blocks: resolveFields(blocks, (id) => values[id] ?? `Sample value for ${id}`),
  createdAt: new Date("2026-11-01T01:00:00Z"),
  author: "Nur Aisyah",
});
writeFileSync(process.argv[2] ?? "letter-sample.pdf", pdf);
