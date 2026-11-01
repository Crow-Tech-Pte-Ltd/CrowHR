import type { HistoryInput } from "./history.ts";
import { receiptPng } from "./receipt.ts";

/** Generated, versioned KET PDFs and an explicitly fictional pass attachment, via real APIs. */
export async function seedDocuments({ clock, http, members, people }: HistoryInput) {
  clock.set("2026-10-30T18:00");
  const owner = await http.as(members.owner as string);
  const templates = await owner.get<{ items: { id: string; kind: string }[] }>("/api/v1/documents/templates");
  const ket = templates.items.find((t) => t.kind === "ket");
  if (!ket) throw new Error("Missing default KET template");
  for (const key of ["joiner", "pt1", "barista1"]) {
    await owner.post("/api/v1/documents/generate", {
      templateId: ket.id,
      employeeId: people.employees[key],
      title:
        key === "barista1"
          ? "Updated Key Employment Terms — Jun Jie"
          : `Key Employment Terms — ${key === "joiner" ? "Darren" : "Hui Min"}`,
      signatoryName: "Lim Kah Hui",
      // Fictional company policy terms, not statutory constants. All payroll calculations use sg-rules.
      overrides: {
        "terms.salary_period": "Monthly",
        "terms.main_duties": "Prepare drinks, serve café customers and maintain food hygiene.",
        "terms.fixed_deductions": "None",
        "terms.overtime_period": "Monthly, paid with salary",
        "terms.overtime_rate": "As calculated under the applicable Employment Act rules",
        "terms.other_salary": "Discretionary performance bonus",
        "terms.medical_benefits": "Company GP reimbursement policy (fictional demo terms)",
        "employment.working_hours": "7 hours 20 minutes per shift, with a 60-minute unpaid break; see published roster",
        "employment.working_days": key === "pt1" ? "Tuesday, Thursday and Saturday" : "Monday to Saturday",
        "employment.rest_day": "Sunday",
        "employment.notice_period": "1 month",
        "employment.probation_period": "3 months",
        "terms.leave_types": "Annual leave, sick and hospitalisation leave, applicable family leave",
        "signatory.title": "Managing Director",
      },
      // Darren still needs to acknowledge his first KET; Jun Jie has revised terms to read.
      requestAcknowledgement: key === "barista1" || key === "joiner",
    });
  }
  const hr = await http.as(members.hr as string);
  const categories = await hr.get<{ items: { id: string; systemKey: string }[] }>("/api/v1/documents/categories");
  const identity = categories.items.find((c) => c.systemKey === "identity");
  if (!identity) throw new Error("Missing identity document category");
  const query = new URLSearchParams({
    employeeId: people.employees.spass as string,
    categoryId: identity.id,
    title: "Fictional work pass — Maria — renewal due",
    expiresOn: "2026-11-20",
    notes: "DEMO ONLY. Invented attachment, not an identity document or evidence of a real work pass.",
    fileName: "fictional-work-pass.png",
  });
  // A patterned sample attachment, explicitly marked fictional in its title, filename and notes.
  await hr.upload(
    `/api/v1/documents/upload?${query}`,
    await receiptPng("FICTIONAL DEMO WORK PASS", 0, "2026-11-20"),
    "image/png",
  );
}
