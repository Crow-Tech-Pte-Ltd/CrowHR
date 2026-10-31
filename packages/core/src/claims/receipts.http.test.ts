import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ClaimsWorld,
  createClaimsWorld,
  decide,
  json,
  line,
  managerOnlyPolicy,
  pngBytes,
  RECEIPT_BYTES,
  uploadAs,
} from "../../testing/claims.ts";
import { files } from "../db/schema/files.ts";
import type { FileScanner } from "../files/scanner.ts";
import { runScanSweep } from "../files/scanner.ts";
import { tick } from "../jobs/tick.ts";

const enc = (s: string) => new TextEncoder().encode(s);

describe("receipt upload security", () => {
  let w: ClaimsWorld;
  beforeEach(async () => {
    w = await createClaimsWorld();
  });
  afterEach(() => w.t.close());

  it("stores an accepted file under an ID-only key with the detected type", async () => {
    const res = await uploadAs(await w.as("staff"), RECEIPT_BYTES.jpeg, "IMG_2041.HEIC");
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body).toMatchObject({
      mime: "image/jpeg",
      name: "IMG_2041.jpg",
      scanStatus: "unscanned",
      previewable: true,
    });
    const [row] = await w.deps.db.select().from(files).where(eq(files.id, body.id));
    expect(row?.storageKey).toBe(`org/${w.orgId}/files/${body.id}.jpg`);
    expect(row?.ownerEmployeeId).toBe(w.emp.staff);
    expect(row?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses files over 10 MB (declared or streamed) with 413", async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(RECEIPT_BYTES.png);
    const res = await uploadAs(await w.as("staff"), big);
    expect(res.status).toBe(413);
    expect((await json(res)).error.code).toBe("file_too_large");
    // Exactly 10 MB is fine.
    const ok = new Uint8Array(10 * 1024 * 1024);
    ok.set(RECEIPT_BYTES.png);
    expect((await uploadAs(await w.as("staff"), ok)).status).toBe(201);
    expect(await w.deps.db.select().from(files)).toHaveLength(1);
  });

  it("refuses the wrong type whatever the name or Content-Type says (renamed executable)", async () => {
    const staff = await w.as("staff");
    const exe = enc("MZ\x90\x00\x03\x00\x00\x00\x04\x00This program cannot be run in DOS mode.");
    const res = await staff.request("/api/v1/claims/receipts?fileName=receipt.pdf", {
      method: "POST",
      body: exe as BodyInit,
      headers: { "content-type": "application/pdf" },
    });
    expect(res.status).toBe(415);
    expect((await json(res)).error.message).toBe(
      "This file is not a PDF or image. Upload a photo or PDF of the receipt",
    );
    for (const bytes of [enc("GIF89a....."), enc("<svg onload=alert(1)>"), new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])]) {
      expect((await uploadAs(staff, bytes, "photo.png")).status).toBe(415);
    }
    expect((await uploadAs(staff, new Uint8Array(), "empty.png")).status).toBe(400);
    expect(await w.deps.db.select().from(files)).toHaveLength(0);
  });

  it("refuses polyglots (image + ZIP, image + HTML)", async () => {
    const staff = await w.as("staff");
    const gifar = new Uint8Array([
      ...RECEIPT_BYTES.png,
      ...enc("PK\x03\x04evil.class"),
      ...enc("PK\x05\x06"),
      ...new Uint8Array(18),
    ]);
    expect((await uploadAs(staff, gifar, "receipt.png")).status).toBe(415);
    const html = new Uint8Array([...RECEIPT_BYTES.jpeg, ...enc("<html><body><script>fetch('/api/v1/me')</script>")]);
    expect((await uploadAs(staff, html, "receipt.jpg")).status).toBe(415);
  });

  it("ignores path traversal in the file name: the key is built from IDs, the name is sanitised", async () => {
    const res = await uploadAs(await w.as("staff"), RECEIPT_BYTES.png, "../../../../etc/cron.d/evil");
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.name).toBe("evil.png");
    const [row] = await w.deps.db.select().from(files).where(eq(files.id, body.id));
    expect(row?.storageKey).not.toContain("..");
    expect(row?.storageKey).toBe(`org/${w.orgId}/files/${body.id}.png`);
    const dl = await (await w.as("staff")).get(`/api/v1/claims/receipts/${body.id}`);
    expect(dl.headers.get("content-disposition")).toBe('inline; filename="evil.png"');
  });

  it("serves receipts with the detected type, nosniff and a sandbox CSP; PDFs and HEIC as attachments", async () => {
    const staff = await w.as("staff");
    const png = await json(await uploadAs(staff, RECEIPT_BYTES.png));
    const pdf = await json(await uploadAs(staff, RECEIPT_BYTES.pdf, "invoice.pdf"));
    const heic = await json(await uploadAs(staff, RECEIPT_BYTES.heic, "IMG_1.heic"));
    const a = await staff.get(`/api/v1/claims/receipts/${png.id}`);
    expect(a.status).toBe(200);
    expect(a.headers.get("content-type")).toBe("image/png");
    expect(a.headers.get("x-content-type-options")).toBe("nosniff");
    expect(a.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(RECEIPT_BYTES.png);
    const b = await staff.get(`/api/v1/claims/receipts/${pdf.id}`);
    expect(b.headers.get("content-disposition")).toBe('attachment; filename="invoice.pdf"');
    expect(heic.previewable).toBe(false);
    expect((await staff.get(`/api/v1/claims/receipts/${heic.id}`)).headers.get("content-disposition")).toMatch(
      /^attachment/,
    );
  });

  it("another employee's receipt answers 404 — download, attach and delete", async () => {
    const mine = await json(await uploadAs(await w.as("staff"), pngBytes(9)));
    const other = await w.as("other");
    expect((await other.get(`/api/v1/claims/receipts/${mine.id}`)).status).toBe(404);
    expect((await other.delete(`/api/v1/claims/receipts/${mine.id}`)).status).toBe(404);
    const transport = await w.type({ code: "TRANSPORT", receiptRule: "always" });
    const steal = await other.post("/api/v1/claims", { lines: [line(transport, { receiptIds: [mine.id] })] });
    expect(steal.status).toBe(400);
    expect(JSON.stringify(await json(steal))).toContain("a receipt is missing");
    // The manager (not yet an approver) and payroll_admin can't open an unattached upload either.
    expect((await (await w.as("manager")).get(`/api/v1/claims/receipts/${mine.id}`)).status).toBe(404);
    // Unknown IDs look the same.
    expect((await other.get("/api/v1/claims/receipts/0192f0c0-0000-7000-8000-000000000999")).status).toBe(404);
  });

  it("medical receipts: claimant, current approver, owner and hr_admin see them; payroll_admin and a non-approving manager don't", async () => {
    await managerOnlyPolicy(w);
    const medical = await w.type({ code: "MEDICAL", name: "Medical", category: "medical", receiptRule: "always" });
    const staff = await w.as("staff");
    const up = await json(await uploadAs(staff, pngBytes(5)));
    const claim = await json(
      await staff.post("/api/v1/claims", {
        lines: [line(medical, { merchant: "Raffles Medical", description: "Outpatient", receiptIds: [up.id] })],
        submit: true,
      }),
    );
    const url = `/api/v1/claims/receipts/${up.id}`;
    expect((await (await w.as("manager")).get(url)).status).toBe(200);
    expect((await (await w.as("owner")).get(url)).status).toBe(200);
    expect((await (await w.as("hr")).get(url)).status).toBe(200);
    expect((await (await w.as("payroll")).get(url)).status).toBe(404);
    const asPayroll = await json(await (await w.as("payroll")).get(`/api/v1/claims/${claim.id}`));
    expect(asPayroll.lines[0]).toMatchObject({
      typeName: "Medical",
      sgdCents: 1850,
      redactedFields: ["merchant", "description", "receipts"],
    });
    expect(asPayroll.lines[0].merchant).toBeUndefined();
    // Once decided, the manager is no longer the current approver.
    await decide(w, "manager", claim.id, "approve");
    expect((await (await w.as("manager")).get(url)).status).toBe(404);
    const asManager = await json(await (await w.as("manager")).get(`/api/v1/claims/${claim.id}`));
    expect(asManager.lines[0].receipts).toBeUndefined();
    expect((await staff.get(url)).status).toBe(200);
  });

  it("flags a receipt whose hash matches another non-rejected claim, without blocking", async () => {
    const transport = await w.type({ code: "TRANSPORT" });
    const staff = await w.as("staff");
    const first = await json(await uploadAs(staff, pngBytes(77)));
    const c1 = await json(
      await staff.post("/api/v1/claims", { lines: [line(transport, { receiptIds: [first.id] })], submit: true }),
    );
    // Same image uploaded again (new file row, same SHA-256).
    const again = await json(await uploadAs(staff, pngBytes(77)));
    const c2 = await staff.post("/api/v1/claims", {
      lines: [line(transport, { receiptIds: [again.id] })],
      submit: true,
    });
    expect(c2.status).toBe(201);
    const view = await json(await (await w.as("manager")).get(`/api/v1/claims/${(await json(c2)).id}`));
    expect(view.lines[0].duplicates).toEqual([{ fileId: again.id, claimId: c1.id, claimNumber: "C-0001" }]);
    // A rejected original no longer counts.
    await decide(w, "manager", c1.id, "reject", "Duplicate");
    const later = await json(await (await w.as("manager")).get(`/api/v1/claims/${view.id}`));
    expect(later.lines[0].duplicates).toEqual([]);
  });

  it("deletes the uploader's own unattached file; an attached one is in use", async () => {
    const staff = await w.as("staff");
    const a = await json(await uploadAs(staff, pngBytes(1)));
    expect((await staff.delete(`/api/v1/claims/receipts/${a.id}`)).status).toBe(204);
    expect((await staff.get(`/api/v1/claims/receipts/${a.id}`)).status).toBe(404);
    const b = await json(await uploadAs(staff, pngBytes(2)));
    const transport = await w.type({ code: "TRANSPORT" });
    await staff.post("/api/v1/claims", { lines: [line(transport, { receiptIds: [b.id] })] });
    expect((await staff.delete(`/api/v1/claims/receipts/${b.id}`)).status).toBe(409);
  });
});

describe("virus-scan hook", () => {
  const scanner = (verdicts: ("clean" | "infected" | "error")[]): FileScanner & { calls: number } => {
    const s = {
      calls: 0,
      async scan() {
        s.calls++;
        return verdicts.shift() ?? "error";
      },
    };
    return s;
  };

  it("no scanner: receipts are `unscanned` and usable", async () => {
    const w = await createClaimsWorld();
    const res = await json(await uploadAs(await w.as("staff"), RECEIPT_BYTES.png));
    expect(res.scanStatus).toBe("unscanned");
    expect(await runScanSweep(w.deps)).toBe(0);
    expect((await json(await (await w.as("owner")).get("/api/v1/claims/settings"))).scanning).toBe(false);
    await w.t.close();
  });

  it("pending blocks submission until clean; the tick sweep scans", async () => {
    const s = scanner(["clean"]);
    const w = await createClaimsWorld({ scanner: s });
    const staff = await w.as("staff");
    const transport = await w.type({ code: "TRANSPORT", receiptRule: "always" });
    const up = await json(await uploadAs(staff, RECEIPT_BYTES.png));
    expect(up.scanStatus).toBe("pending_scan");
    const draft = await json(await staff.post("/api/v1/claims", { lines: [line(transport, { receiptIds: [up.id] })] }));
    const blocked = await staff.post(`/api/v1/claims/${draft.id}/submit`);
    expect(blocked.status).toBe(400);
    expect((await json(blocked)).error.message).toMatch(/still being scanned/);
    const report = await tick(w.deps, w.clock.now());
    expect(report.transitions.claim_receipt_scan).toBe(1);
    expect((await staff.post(`/api/v1/claims/${draft.id}/submit`)).status).toBe(200);
    expect((await json(await (await w.as("owner")).get("/api/v1/claims/settings"))).scanning).toBe(true);
    await w.t.close();
  });

  it("infected files are deleted and the uploader is told to upload a different one", async () => {
    const w = await createClaimsWorld({ scanner: scanner(["infected"]) });
    const staff = await w.as("staff");
    const up = await json(await uploadAs(staff, RECEIPT_BYTES.png, "scan.png"));
    await runScanSweep(w.deps);
    const [row] = await w.deps.db.select().from(files).where(eq(files.id, up.id));
    expect(row).toMatchObject({ scanStatus: "infected" });
    expect(row?.deletedAt).not.toBeNull();
    expect(await w.deps.fileStore.get(row?.storageKey as string)).toBeNull();
    expect((await staff.get(`/api/v1/claims/receipts/${up.id}`)).status).toBe(404);
    const notes = await json(await staff.get("/api/v1/notifications"));
    expect(JSON.stringify(notes)).toContain("Upload a different file");
    await w.t.close();
  });

  it("errors retry 3 times, then the file is held as scan_failed", async () => {
    const s = scanner(["error", "error", "error", "clean"]);
    const w = await createClaimsWorld({ scanner: s });
    const up = await json(await uploadAs(await w.as("staff"), RECEIPT_BYTES.png));
    await runScanSweep(w.deps);
    await runScanSweep(w.deps);
    let [row] = await w.deps.db.select().from(files).where(eq(files.id, up.id));
    expect(row).toMatchObject({ scanStatus: "pending_scan", scanAttempts: 2 });
    await runScanSweep(w.deps);
    [row] = await w.deps.db.select().from(files).where(eq(files.id, up.id));
    expect(row).toMatchObject({ scanStatus: "scan_failed", scanAttempts: 3 });
    await runScanSweep(w.deps);
    expect(s.calls).toBe(3);
    await w.t.close();
  });
});
