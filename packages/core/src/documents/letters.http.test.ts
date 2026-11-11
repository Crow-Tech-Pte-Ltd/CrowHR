import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pdfBytes, uploadDoc } from "../../testing/documents.ts";
import { seedMember } from "../../testing/fixtures.ts";
import { clientAs, type TestClient, testClient } from "../../testing/http.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { documentRetentionReviews, documents, documentVersions, letterTemplates } from "../db/schema/documents.ts";
import { checklistItems, checklists, tenures } from "../db/schema/employees.ts";
import { files } from "../db/schema/files.ts";
import { notifications } from "../db/schema/notifications.ts";

/**
 * Letters, KETs, acknowledgements, letter requests and retention (add-documents tasks 3.3, 3.4,
 * 4.1 and the lead brief's workflow and retention items).
 */
type Template = { id: string; kind: string; name: string; bodyMd: string; version: number; targetCategoryId: string };
type Doc = {
  id: string;
  title: string;
  source: string;
  category: { name: string };
  current: { id: string; version: number; sha256: string; templateVersion: number | null } | null;
  acknowledgement: {
    status: string;
    acknowledgedAt: string | null;
    fileSha256: string | null;
    current: boolean;
  } | null;
  viewed: boolean;
};

const KET_TERMS = {
  "terms.main_duties": "Prepare coffee and serve customers.",
  "terms.fixed_deductions": "None",
  "terms.overtime_period": "Monthly, paid with the salary",
  "terms.overtime_rate": "1.5 times the hourly basic rate",
  "terms.other_salary": "Annual performance bonus at the company's discretion",
  "terms.medical_benefits": "Outpatient GP visits up to S$300 a year",
  "employment.notice_period": "1 month",
  "signatory.title": "Owner",
  // Values the test world has no record for (company profile, probation, leave types).
  "org.uen": "202600001K",
  "org.address": "10 Anson Road, #12-04, Singapore 079903",
  "employment.probation_period": "3 months",
  "terms.leave_types": "Annual leave, sick and hospitalisation leave, childcare leave",
};

describe("letters and acknowledgements", () => {
  let w: LeaveWorld;
  let hr: TestClient;
  let hrPay: TestClient;
  let templates: Record<string, Template>;
  beforeAll(async () => {
    w = await createLeaveWorld({ now: "2026-10-31T01:00:00.000Z" });
    hr = await w.as("hr");
    hrPay = await clientAs(
      w.app,
      w.deps,
      await seedMember(w.deps, w.orgId, { roles: ["hr_admin", "payroll_admin"], displayName: "Lim Jia Hui" }),
    );
    const body = (await (await hr.get("/api/v1/documents/templates")).json()) as { items: Template[] };
    templates = Object.fromEntries(body.items.map((t) => [t.kind, t]));
  });
  afterAll(() => w.close());

  const ok = async <T>(res: Promise<Response> | Response, status = 200): Promise<T> => {
    const r = await res;
    const text = await r.text();
    if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  };

  it("ships default templates for KET, offer, confirmation, salary change and employment certificate", () => {
    expect(Object.keys(templates).sort()).toEqual([
      "confirmation",
      "employment_certificate",
      "ket",
      "offer",
      "salary_adjustment",
    ]);
  });

  it("won't ask for an acknowledgement of a letter filed where the employee can't see it", async () => {
    const cats = (await ok<{ items: { id: string; name: string }[] }>(hr.get("/api/v1/documents/categories"))).items;
    const hrOnly = cats.find((c) => c.name === "Other")?.id as string;
    const ket = templates.ket as Template;
    const [before] = await w.deps.db.select().from(letterTemplates).where(eq(letterTemplates.id, ket.id));
    await w.deps.db.update(letterTemplates).set({ targetCategoryId: hrOnly }).where(eq(letterTemplates.id, ket.id));
    try {
      const count = async () => (await w.deps.db.select().from(documents).where(eq(documents.orgId, w.orgId))).length;
      const docs = await count();
      const res = await hrPay.post("/api/v1/documents/generate", {
        templateId: ket.id,
        employeeId: w.emp.newbie,
        asAt: "2026-07-14",
        overrides: KET_TERMS,
        requestAcknowledgement: true,
      });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/can't acknowledge/);
      expect(await count()).toBe(docs);
    } finally {
      await w.deps.db
        .update(letterTemplates)
        .set({ targetCategoryId: before?.targetCategoryId as string })
        .where(eq(letterTemplates.id, ket.id));
    }
  });

  it("refuses to save a template with an unknown field, naming the line and a suggestion", async () => {
    const body = `${"Line\n".repeat(11)}Pay: {{employee.salary}}`;
    const res = await hr.post("/api/v1/documents/templates", { kind: "custom", name: "Bad", bodyMd: body });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      "Unknown field employee.salary on line 12. Did you mean compensation.basic_pay?",
    );
  });

  it("refuses to save a KET template without a mandatory item", async () => {
    const ket = templates.ket as Template;
    const body = ket.bodyMd.replace(/<!-- ket:working_arrangements -->[\s\S]*?(?=<!-- ket:salary_period -->)/, "");
    const res = await hr.put(`/api/v1/documents/templates/${ket.id}`, { bodyMd: body });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /mandatory item "Working arrangements/,
    );
  });

  it("salary fields need a payroll admin or owner: hr_admin alone gets 403 naming the fields", async () => {
    const res = await hr.post("/api/v1/documents/generate", {
      templateId: templates.offer?.id,
      employeeId: w.emp.newbie,
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /salary fields \(compensation\.basic_pay, compensation\.fixed_allowances\).*payroll admin or owner/,
    );
  });

  it("blocks generation listing missing fields and where to fill them", async () => {
    const res = await hr.post("/api/v1/documents/generate", {
      templateId: templates.confirmation?.id,
      employeeId: w.emp.hr,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; message: string; details: { missing: { id: string; where: string }[] } };
    };
    expect(body.error.code).toBe("missing_fields");
    expect(body.error.details.missing.map((m) => m.id)).toEqual([
      "employment.probation_end",
      "employment.manager_name",
      "signatory.title",
    ]);
    expect(body.error.message).toContain("Manager (set it on the employment record)");
  });

  it("generates a KET as at a date with Singapore formats, files it, and completes Issue KETs", async () => {
    // Siti's onboarding checklist has an open "Issue KETs" item.
    const open = await w.deps.db
      .select({ id: checklistItems.id, status: checklistItems.status })
      .from(checklistItems)
      .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
      .where(and(eq(checklists.employeeId, w.emp.newbie), eq(checklistItems.title, "Issue KETs")));
    const preview = await ok<{ documentId: null; missing: { id: string }[]; values: Record<string, string> }>(
      hrPay.post("/api/v1/documents/generate", {
        templateId: templates.ket?.id,
        employeeId: w.emp.newbie,
        dryRun: true,
      }),
    );
    expect(preview.documentId).toBeNull();
    expect(preview.missing.map((m) => m.id)).toEqual(
      expect.arrayContaining(["terms.main_duties", "terms.medical_benefits"]),
    );
    expect(preview.values["employment.start_date"]).toBe("14 Jul 2026");
    expect(preview.values["compensation.basic_pay"]).toBe("S$4,000.00 a month");
    expect(preview.values["employment.working_days"]).toBe(
      "5 days a week (Monday, Tuesday, Wednesday, Thursday, Friday)",
    );
    expect(preview.values["employment.rest_day"]).toBe("Sunday");
    expect(preview.values["employee.nric_masked"]).toMatch(/^[STFG]\*{4}\d{3}[A-Z]$/);
    const out = await ok<{ documentId: string; values: Record<string, string> }>(
      hrPay.post("/api/v1/documents/generate", {
        templateId: templates.ket?.id,
        employeeId: w.emp.newbie,
        asAt: "2026-07-14",
        overrides: KET_TERMS,
        requestAcknowledgement: true,
      }),
    );
    const doc = await ok<Doc>(hrPay.get(`/api/v1/documents/${out.documentId}`));
    expect(doc).toMatchObject({ source: "generated", category: { name: "Contract & KETs" } });
    expect(doc.current?.templateVersion).toBe(templates.ket?.version);
    const [version] = await w.deps.db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, doc.current?.id as string));
    expect(version?.asAt).toBe("2026-07-14");
    // The snapshot leaves out salary fields; the per-document values HR entered are recorded.
    expect(version?.fieldSnapshot?.["employment.start_date"]).toBe("14 Jul 2026");
    expect(version?.fieldSnapshot).not.toHaveProperty("compensation.basic_pay");
    expect(version?.overrides?.["terms.medical_benefits"]).toBe("Outpatient GP visits up to S$300 a year");
    const file = await hrPay.get(`/api/v1/documents/${out.documentId}/file`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(open.map((o) => o.status)).toEqual(["open"]);
    {
      const [after] = await w.deps.db
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.id, open[0]?.id as string));
      expect(after?.status).toBe("done");
    }
  });

  it("an employee must open a document before acknowledging; the record holds time, IP, UA and hash", async () => {
    const siti = await w.as("newbie");
    const mine = await ok<{ items: Doc[] }>(siti.get("/api/v1/documents?mine=true"));
    const ket = mine.items.find((d) => d.source === "generated") as Doc;
    expect(ket.acknowledgement).toMatchObject({ status: "requested", current: true });
    // Home shows the request.
    const home = await ok<{ items: { kind: string; href: string }[] }>(siti.get("/api/v1/inbox"));
    expect(home.items).toContainEqual(
      expect.objectContaining({ kind: "acknowledgement", href: `/documents?open=${ket.id}` }),
    );
    const early = await siti.post(`/api/v1/documents/${ket.id}/acknowledge`, {});
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: { code: string } }).error.code).toBe("not_viewed");
    // Another employee can't acknowledge it.
    expect((await (await w.as("staff")).post(`/api/v1/documents/${ket.id}/acknowledge`, {})).status).toBe(404);
    const viewer = testClient(w.app, w.deps, { ip: "203.0.113.7", userAgent: "Crow test browser" });
    for (const [k, v] of siti.cookies) viewer.cookies.set(k, v);
    expect((await viewer.get(`/api/v1/documents/${ket.id}/file`)).status).toBe(200);
    const acked = await ok<Doc>(viewer.post(`/api/v1/documents/${ket.id}/acknowledge`, {}));
    expect(acked.acknowledgement).toMatchObject({ status: "acknowledged", fileSha256: ket.current?.sha256 });
    expect((await ok<{ items: { kind: string }[] }>(siti.get("/api/v1/inbox"))).items.map((i) => i.kind)).not.toContain(
      "acknowledgement",
    );
    const rows = await ok<{ items: { ip: string; fileSha256: string; acknowledgedAt: string }[] }>(
      hr.get(`/api/v1/documents/acknowledgements?documentId=${ket.id}`),
    );
    expect(rows.items[0]).toMatchObject({ ip: "203.0.113.7", fileSha256: ket.current?.sha256 });
    // Not revocable: a second call changes nothing.
    await ok(viewer.post(`/api/v1/documents/${ket.id}/acknowledge`, {}));
    const csv = await hr.get("/api/v1/documents/acknowledgements?format=csv");
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect((await csv.text()).split("\r\n")[0]).toBe(
      "Document,Version,Employee no.,Employee,Requested,Acknowledged,File SHA-256,IP address",
    );
    const [ev] = await w.deps.db.select().from(auditEvents).where(eq(auditEvents.action, "document.acknowledged"));
    expect(ev?.targetId).toBe(ket.id);
  });

  it("reminds after 3 and 7 days; a new version needs a new acknowledgement", async () => {
    const cats = (await ok<{ items: { id: string; systemKey: string }[] }>(hr.get("/api/v1/documents/categories")))
      .items;
    const letters = cats.find((c) => c.systemKey === "letters")?.id as string;
    const policy = await ok<Doc>(
      uploadDoc(hr, pdfBytes(40), { employeeId: w.emp.staff, categoryId: letters, title: "Code of conduct" }),
      201,
    );
    await ok(hr.post(`/api/v1/documents/${policy.id}/acknowledgements`, {}));
    expect((await hr.post(`/api/v1/documents/${policy.id}/acknowledgements`, {})).status).toBe(409);
    const count = async () =>
      (await w.deps.db.select().from(notifications).where(eq(notifications.kind, "acknowledgement_requested"))).filter(
        (n) => n.recipientMembershipId === w.m.staff.membershipId,
      ).length;
    expect(await count()).toBe(1);
    w.clock.set("2026-11-03T02:00:00.000Z");
    await w.app.jobs.tick();
    expect(await count()).toBe(2);
    await w.app.jobs.tick();
    expect(await count()).toBe(2);
    w.clock.set("2026-11-07T02:00:00.000Z");
    await w.app.jobs.tick();
    expect(await count()).toBe(3);
    w.clock.set("2026-10-31T01:00:00.000Z");
    hr = await w.as("hr");
    const staff = await w.as("staff");
    await staff.get(`/api/v1/documents/${policy.id}/file`);
    await ok(staff.post(`/api/v1/documents/${policy.id}/acknowledge`, {}));
    const replaced = await hr.request(`/api/v1/documents/${policy.id}/versions`, {
      method: "POST",
      body: pdfBytes(41) as BodyInit,
    });
    expect(replaced.status).toBe(201);
    const after = await ok<Doc>(staff.get(`/api/v1/documents/${policy.id}`));
    expect(after.acknowledgement).toMatchObject({ status: "acknowledged", current: false });
    await ok(hr.post(`/api/v1/documents/${policy.id}/acknowledgements`, {}));
    expect((await ok<Doc>(staff.get(`/api/v1/documents/${policy.id}`))).acknowledgement).toMatchObject({
      status: "requested",
      current: true,
    });
  });

  it("an employee requests an employment letter; HR approves; the PDF lands in their documents", async () => {
    const ravi = await w.as("staff");
    const req = await ok<{ id: string }>(
      ravi.post("/api/v1/documents/requests", { kind: "employment_certificate", purpose: "Bank loan application" }),
      201,
    );
    const tasks = await ok<{ items: { taskId: string; subjectType: string; title: string }[] }>(
      hr.get("/api/v1/approvals/tasks"),
    );
    const task = tasks.items.find((t) => t.subjectType === "document_request");
    expect(task?.title).toBe("Employment letter request");
    await ok(hr.post(`/api/v1/approvals/tasks/${task?.taskId}/decision`, { decision: "approve" }));
    const mine = await ok<{ items: { id: string; status: string; documentId: string | null }[] }>(
      ravi.get("/api/v1/documents/requests"),
    );
    expect(mine.items.find((r) => r.id === req.id)).toMatchObject({ status: "approved" });
    const docId = mine.items.find((r) => r.id === req.id)?.documentId as string;
    const doc = await ok<Doc>(ravi.get(`/api/v1/documents/${docId}`));
    expect(doc).toMatchObject({ source: "generated", category: { name: "Letters" } });
    expect((await ravi.get(`/api/v1/documents/${docId}/file`)).status).toBe(200);
  });

  it("flags an ex-employee's documents for review 12 months after they leave, and never deletes them", async () => {
    const cats = (await ok<{ items: { id: string; systemKey: string }[] }>(hr.get("/api/v1/documents/categories")))
      .items;
    const other = cats.find((c) => c.systemKey === "other")?.id as string;
    const doc = await ok<Doc>(
      uploadDoc(hr, pdfBytes(60), { employeeId: w.emp.other, categoryId: other, title: "Exit interview" }),
      201,
    );
    await w.deps.db
      .update(tenures)
      .set({ lastWorkingDay: "2025-10-30", cessationReason: "resignation" })
      .where(eq(tenures.employeeId, w.emp.other));
    await w.app.jobs.tick();
    const flags = await ok<{ items: { id: string; documentId: string; reviewFrom: string }[] }>(
      hr.get("/api/v1/documents/retention"),
    );
    const flag = flags.items.find((f) => f.documentId === doc.id);
    expect(flag?.reviewFrom).toBe("2026-10-30");
    // Another sweep doesn't duplicate; nothing was deleted.
    await w.app.jobs.tick();
    expect(
      (await w.deps.db.select().from(documentRetentionReviews).where(eq(documentRetentionReviews.documentId, doc.id)))
        .length,
    ).toBe(1);
    const [row] = await w.deps.db.select().from(documents).where(eq(documents.id, doc.id));
    expect(row?.deletedAt).toBeNull();
    const [f] = await w.deps.db
      .select()
      .from(files)
      .where(eq(files.sha256, doc.current?.sha256 as string));
    expect(f?.deletedAt).toBeNull();
    // HR keeps it for four more months: from 31 Oct that is 28 Feb (the month's last day, not 3 Mar).
    await ok(hr.post(`/api/v1/documents/retention/${flag?.id}/resolve`, { resolution: "keep", keepMonths: 4 }), 204);
    const [kept] = await w.deps.db
      .select()
      .from(documentRetentionReviews)
      .where(eq(documentRetentionReviews.id, flag?.id as string));
    expect(kept?.keepUntil).toBe("2027-02-28");
    // No new flag until then.
    await w.app.jobs.tick();
    expect((await ok<{ items: unknown[] }>(hr.get("/api/v1/documents/retention"))).items).toHaveLength(0);
  });
});
