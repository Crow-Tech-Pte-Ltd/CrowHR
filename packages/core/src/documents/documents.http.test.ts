import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pngBytes } from "../../testing/claims.ts";
import { ooxmlBytes, PDF_BYTES, pdfBytes, replaceDoc, uploadDoc } from "../../testing/documents.ts";
import type { TestClient } from "../../testing/http.ts";
import { createLeaveWorld, type LeaveWorld } from "../../testing/leave.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { files } from "../db/schema/files.ts";
import { notifications } from "../db/schema/notifications.ts";

/**
 * Documents storage and access (add-documents tasks 1.2–1.5 and 2.1): default categories, upload
 * rules and versions, access per role and category, audit, soft delete and purge, expiry and its
 * reminders.
 */
type Doc = {
  id: string;
  title: string;
  expiry: string | null;
  current: { id: string; version: number; sha256: string } | null;
  previousVersions: { version: number; superseded: boolean }[];
};
type Category = { id: string; systemKey: string | null; name: string } & Record<string, unknown>;

describe("documents", () => {
  let w: LeaveWorld;
  let hr: TestClient;
  let cats: Record<string, Category>;
  beforeAll(async () => {
    w = await createLeaveWorld({ now: "2026-10-31T01:00:00.000Z" });
    hr = await w.as("hr");
    const body = (await (await hr.get("/api/v1/documents/categories")).json()) as { items: Category[] };
    cats = Object.fromEntries(body.items.map((c) => [c.systemKey as string, c]));
  });
  afterAll(() => w.close());

  const ok = async <T>(res: Promise<Response> | Response, status = 200): Promise<T> => {
    const r = await res;
    const text = await r.text();
    if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  };

  it("seeds the default categories from the spec table", () => {
    const pick = (k: string) => {
      const c = cats[k] as Category;
      return [c.name, c.sensitivity, c.employeeVisible, c.managerVisible, c.employeeUploadable, c.payrollVisible];
    };
    expect(["contract", "identity", "certificates", "medical", "letters", "other"].map(pick)).toEqual([
      ["Contract & KETs", "normal", true, false, false, false],
      ["Identity & work pass", "normal", true, false, true, false],
      ["Certificates & licences", "normal", true, true, true, false],
      ["Medical", "medical", true, false, true, false],
      ["Letters", "normal", true, false, false, false],
      ["Other", "normal", false, false, false, false],
    ]);
    expect(cats.identity?.auditViews).toBe(true);
    expect(cats.contract?.retentionMonthsAfterExit).toBe(12);
  });

  it("document counts per category: the organisation's for HR, only their own readable ones for others", async () => {
    await ok(
      uploadDoc(hr, pdfBytes(90), { employeeId: w.emp.other, categoryId: cats.medical?.id as string, title: "MC" }),
      201,
    );
    await ok(
      uploadDoc(hr, pdfBytes(91), { employeeId: w.emp.other, categoryId: cats.other?.id as string, title: "Note" }),
      201,
    );
    const counts = async (client: TestClient) =>
      Object.fromEntries(
        (await ok<{ items: Category[] }>(client.get("/api/v1/documents/categories"))).items.map((c) => [
          c.systemKey,
          (c as Category & { documentCount: number }).documentCount,
        ]),
      );
    const forHr = await counts(hr);
    expect(forHr.medical).toBeGreaterThanOrEqual(1);
    expect(forHr.other).toBeGreaterThanOrEqual(1);
    // A colleague learns nothing about others' medical or HR-only documents.
    const staff = await counts(await w.as("staff"));
    expect([staff.medical, staff.other]).toEqual([0, 0]);
  });

  it("refuses to make a medical category manager-visible, and to delete a category in use", async () => {
    const res = await hr.patch(`/api/v1/documents/categories/${cats.medical?.id}`, { managerVisible: true });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /visible only to HR, owners and the employee/,
    );
    const created = await ok<Category>(hr.post("/api/v1/documents/categories", { name: "Training records" }), 201);
    await ok(
      uploadDoc(hr, PDF_BYTES, { employeeId: w.emp.staff, categoryId: created.id, title: "Barista course" }),
      201,
    );
    const del = await hr.delete(`/api/v1/documents/categories/${created.id}`);
    expect(del.status).toBe(409);
    const empty = await ok<Category>(hr.post("/api/v1/documents/categories", { name: "Spare" }), 201);
    expect((await hr.delete(`/api/v1/documents/categories/${empty.id}`)).status).toBe(204);
    expect((await (await w.as("manager")).post("/api/v1/documents/categories", { name: "Mine" })).status).toBe(403);
  });

  it("accepts PDF, images, DOCX and XLSX by content; refuses macros, other files and > 20 MB", async () => {
    const base = { employeeId: w.emp.staff, categoryId: cats.other?.id as string };
    for (const [bytes, name] of [
      [PDF_BYTES, "a.pdf"],
      [pngBytes(1), "a.png"],
      [ooxmlBytes("docx"), "a.docx"],
      [ooxmlBytes("xlsx"), "a.xlsx"],
    ] as const) {
      expect((await uploadDoc(hr, bytes, { ...base, title: name, fileName: name })).status, name).toBe(201);
    }
    const docm = await uploadDoc(hr, ooxmlBytes("docx", { macro: true }), {
      ...base,
      title: "Contract",
      fileName: "contract.docm",
    });
    expect(docm.status).toBe(415);
    expect(((await docm.json()) as { error: { message: string } }).error.message).toBe(
      "Macro-enabled documents are not accepted. Save as .docx or PDF",
    );
    expect((await uploadDoc(hr, ooxmlBytes("xlsx", { macro: true }), { ...base, title: "Sheet" })).status).toBe(415);
    // A ZIP that is not an OOXML package.
    const { concatBytes, zipStoreChunks } = await import("../export/zip.ts");
    const zip = concatBytes(zipStoreChunks([{ name: "a.txt", chunks: [new TextEncoder().encode("x")] }]));
    expect((await uploadDoc(hr, zip, { ...base, title: "Zip" })).status).toBe(415);
    expect((await uploadDoc(hr, new TextEncoder().encode("<html>hi</html>"), { ...base, title: "Html" })).status).toBe(
      415,
    );
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    big.set(PDF_BYTES);
    expect((await uploadDoc(hr, big, { ...base, title: "Huge" })).status).toBe(413);
    // Title rules.
    expect((await uploadDoc(hr, PDF_BYTES, { ...base, title: "x".repeat(121) })).status).toBe(400);
  });

  it("requires an expiry where the category does; employees upload only to their uploadable categories", async () => {
    await ok(hr.patch(`/api/v1/documents/categories/${cats.certificates?.id}`, { expiryRequired: true }));
    const no = await uploadDoc(hr, PDF_BYTES, {
      employeeId: w.emp.staff,
      categoryId: cats.certificates?.id as string,
      title: "Food hygiene",
    });
    expect(no.status).toBe(400);
    const staff = await w.as("staff");
    const mine = await uploadDoc(staff, pngBytes(2), {
      employeeId: w.emp.staff,
      categoryId: cats.certificates?.id as string,
      title: "Forklift licence",
      expiresOn: "2026-11-30",
    });
    expect(mine.status).toBe(201);
    expect(((await mine.json()) as Doc).expiry).toBe("expiring");
    // Not uploadable by employees: Contract & KETs.
    expect(
      (
        await uploadDoc(staff, PDF_BYTES, {
          employeeId: w.emp.staff,
          categoryId: cats.contract?.id as string,
          title: "x",
        })
      ).status,
    ).toBe(403);
    // Someone else's record: indistinguishable from missing.
    expect(
      (
        await uploadDoc(staff, PDF_BYTES, {
          employeeId: w.emp.other,
          categoryId: cats.certificates?.id as string,
          title: "x",
          expiresOn: "2027-01-01",
        })
      ).status,
    ).toBe(404);
    await ok(hr.patch(`/api/v1/documents/categories/${cats.certificates?.id}`, { expiryRequired: false }));
  });

  it("a replacement creates a version and keeps the old one for HR", async () => {
    const pass = await ok<Doc>(
      uploadDoc(hr, pdfBytes(10), {
        employeeId: w.emp.satRest,
        categoryId: cats.identity?.id as string,
        title: "Work permit",
        expiresOn: "2026-11-05",
      }),
      201,
    );
    expect(pass.expiry).toBe("expiring");
    const renewed = await ok<Doc>(replaceDoc(hr, pass.id, pdfBytes(11), { expiresOn: "2028-11-05" }), 201);
    expect(renewed.current?.version).toBe(2);
    expect(renewed.expiry).toBe("valid");
    expect(renewed.previousVersions).toEqual([expect.objectContaining({ version: 1, superseded: true })]);
    const old = renewed.previousVersions[0] as unknown as { id: string };
    expect((await hr.get(`/api/v1/documents/${pass.id}/file?version=${old.id}`)).status).toBe(200);
    // The employee sees the current file only.
    const ahmad = await w.as("satRest");
    const seen = await ok<Doc>(ahmad.get(`/api/v1/documents/${pass.id}`));
    expect(seen.previousVersions).toEqual([]);
    expect((await ahmad.get(`/api/v1/documents/${pass.id}/file?version=${old.id}`)).status).toBe(404);
  });

  it("applies the category flags per role; 404 outside them; downloads are attachments with nosniff", async () => {
    const contract = await ok<Doc>(
      uploadDoc(hr, PDF_BYTES, { employeeId: w.emp.staff, categoryId: cats.contract?.id as string, title: "KET" }),
      201,
    );
    const cert = await ok<Doc>(
      uploadDoc(hr, PDF_BYTES, {
        employeeId: w.emp.staff,
        categoryId: cats.certificates?.id as string,
        title: "First aid",
        expiresOn: "2028-01-01",
      }),
      201,
    );
    const mc = await ok<Doc>(
      uploadDoc(hr, PDF_BYTES, { employeeId: w.emp.staff, categoryId: cats.medical?.id as string, title: "MC 3 Nov" }),
      201,
    );
    const other = await ok<Doc>(
      uploadDoc(hr, PDF_BYTES, {
        employeeId: w.emp.staff,
        categoryId: cats.other?.id as string,
        title: "Internal note",
      }),
      201,
    );
    const status = async (who: Parameters<LeaveWorld["as"]>[0], id: string) =>
      (await (await w.as(who)).get(`/api/v1/documents/${id}`)).status;
    // Manager blocked from contract; sees team certificates; never medical.
    expect(await status("manager", contract.id)).toBe(404);
    expect(await status("manager", cert.id)).toBe(200);
    expect(await status("manager", mc.id)).toBe(404);
    // Employee: own employee-visible categories, medical included; not "Other".
    expect(await status("staff", contract.id)).toBe(200);
    expect(await status("staff", mc.id)).toBe(200);
    expect(await status("staff", other.id)).toBe(404);
    expect(await status("other", contract.id)).toBe(404);
    // Payroll admin: payroll-visible categories only (none by default), never medical.
    expect(await status("payroll", contract.id)).toBe(404);
    await ok(hr.patch(`/api/v1/documents/categories/${cats.contract?.id}`, { payrollVisible: true }));
    expect(await status("payroll", contract.id)).toBe(200);
    await ok(hr.patch(`/api/v1/documents/categories/${cats.contract?.id}`, { payrollVisible: false }));
    expect(await status("owner", mc.id)).toBe(200);
    // Lists apply the same rules.
    const mgrList = await ok<{ items: Doc[] }>(
      (await w.as("manager")).get(`/api/v1/documents?employeeId=${w.emp.staff}`),
    );
    expect(mgrList.items.map((d) => d.title).sort()).toEqual(["First aid", "Forklift licence"]);
    // Download headers.
    const file = await (await w.as("staff")).get(`/api/v1/documents/${contract.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toMatch(/^attachment; filename=/);
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(file.headers.get("content-type")).toBe("application/pdf");
    const inline = await (await w.as("staff")).get(`/api/v1/documents/${contract.id}/file?inline=1`);
    expect(inline.headers.get("content-disposition")).toMatch(/^inline/);
    // Views of medical documents are audited; ordinary ones are not.
    await (await w.as("staff")).get(`/api/v1/documents/${mc.id}/file`);
    const viewed = await w.deps.db.select().from(auditEvents).where(eq(auditEvents.action, "document.viewed"));
    expect(viewed.map((e) => e.targetId)).toContain(mc.id);
    expect(viewed.map((e) => e.targetId)).not.toContain(contract.id);
  });

  it("soft delete hides and audits; only an owner purges, removing the file and tombstoning the row", async () => {
    const mc = await ok<Doc>(
      uploadDoc(hr, pdfBytes(77), {
        employeeId: w.emp.other,
        categoryId: cats.medical?.id as string,
        title: "Medical certificate",
      }),
      201,
    );
    expect((await hr.post(`/api/v1/documents/${mc.id}/purge`, { reason: "x" })).status).toBe(403);
    expect((await hr.delete(`/api/v1/documents/${mc.id}?reason=Uploaded%20to%20wrong%20employee`)).status).toBe(204);
    expect((await (await w.as("other")).get(`/api/v1/documents/${mc.id}`)).status).toBe(404);
    const list = await ok<{ items: Doc[] }>(hr.get(`/api/v1/documents?employeeId=${w.emp.other}`));
    expect(list.items.map((d) => d.id)).not.toContain(mc.id);
    const deleted = await ok<{ items: Doc[] }>(hr.get(`/api/v1/documents?employeeId=${w.emp.other}&deleted=true`));
    expect(deleted.items.map((d) => d.id)).toContain(mc.id);
    const owner = await w.as("owner");
    const [row] = await w.deps.db
      .select()
      .from(files)
      .where(eq(files.sha256, mc.current?.sha256 as string));
    expect(await w.deps.fileStore.get(row?.storageKey as string)).not.toBeNull();
    expect(
      (await owner.post(`/api/v1/documents/${mc.id}/purge`, { reason: "Uploaded to wrong employee" })).status,
    ).toBe(204);
    expect(await w.deps.fileStore.get(row?.storageKey as string)).toBeNull();
    expect((await owner.get(`/api/v1/documents/${mc.id}`)).status).toBe(404);
    const [purge] = await w.deps.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "document.purged"), eq(auditEvents.targetId, mc.id)));
    expect(purge?.meta).toMatchObject({
      reason: "Uploaded to wrong employee",
      titleSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("lists expiring and expired documents, and reminds at 30, 7 and 0 days, once each", async () => {
    const lic = await ok<Doc>(
      uploadDoc(hr, pdfBytes(5), {
        employeeId: w.emp.newbie,
        categoryId: cats.certificates?.id as string,
        title: "Forklift licence",
        expiresOn: "2026-11-30",
      }),
      201,
    );
    const attention = await ok<{ items: Doc[] }>(hr.get("/api/v1/documents?expiry=attention"));
    expect(attention.items.map((d) => d.id)).toContain(lic.id);
    const reminders = async () =>
      (await w.deps.db.select().from(notifications).where(eq(notifications.kind, "document_expiry"))).filter((n) =>
        n.link.includes(lic.id),
      );
    await w.app.jobs.tick();
    const first = await reminders();
    // hr_admin and the employee (the category is visible to employees).
    expect(new Set(first.map((n) => n.recipientMembershipId))).toEqual(
      new Set([w.m.hr.membershipId, w.m.newbie.membershipId]),
    );
    expect(first[0]?.title).toBe("Siti Rahmah's Forklift licence expires on 30 Nov 2026");
    await w.app.jobs.tick();
    expect(await reminders()).toHaveLength(2);
    w.clock.set("2026-11-23T01:00:00.000Z");
    await w.app.jobs.tick();
    expect(await reminders()).toHaveLength(4);
    // A renewal (newer document in the same category with a later expiry) stops the rest.
    hr = await w.as("hr");
    await ok(
      uploadDoc(hr, pdfBytes(6), {
        employeeId: w.emp.newbie,
        categoryId: cats.certificates?.id as string,
        title: "Forklift licence 2028",
        expiresOn: "2028-11-30",
      }),
      201,
    );
    w.clock.set("2026-11-30T01:00:00.000Z");
    await w.app.jobs.tick();
    expect(await reminders()).toHaveLength(4);
    w.clock.set("2026-10-31T01:00:00.000Z");
  });

  it("an older document with a later expiry in the same category doesn't silence a newer one", async () => {
    // A certificate valid until 2028 first; then another one, added later, that expires next month.
    await ok(
      uploadDoc(hr, pdfBytes(7), {
        employeeId: w.emp.satRest,
        categoryId: cats.certificates?.id as string,
        title: "First aid certificate",
        expiresOn: "2028-03-01",
      }),
      201,
    );
    const food = await ok<Doc>(
      uploadDoc(hr, pdfBytes(8), {
        employeeId: w.emp.satRest,
        categoryId: cats.certificates?.id as string,
        title: "Food hygiene certificate",
        expiresOn: "2026-11-25",
      }),
      201,
    );
    await w.app.jobs.tick();
    const sent = (await w.deps.db.select().from(notifications).where(eq(notifications.kind, "document_expiry"))).filter(
      (n) => n.link.includes(food.id),
    );
    expect(sent.map((n) => n.title)).toContain("Ahmad Ismail's Food hygiene certificate expires on 25 Nov 2026");
  });
});
