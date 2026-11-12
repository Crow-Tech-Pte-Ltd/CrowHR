import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ClaimsWorld,
  createClaimsWorld,
  insertClaim,
  insertUpload,
  json,
  line,
  pngBytes,
  seedOtherClaimsOrg,
  uploadAs,
} from "../../testing/claims.ts";
import { systemAuditContext } from "../audit/audit.ts";
import { auditEvents } from "../db/schema/audit.ts";
import { files } from "../db/schema/files.ts";
import { tick } from "../jobs/tick.ts";
import { sweepUnattachedReceipts, UNATTACHED_RECEIPT_DAYS } from "./receipt-cleanup.ts";

const DAY = 86_400_000;

/** close-claims-gaps "Unattached receipt cleanup": the `claim_receipt_cleanup` tick transition. */
describe("cleanup of receipts uploaded but never attached", () => {
  let w: ClaimsWorld;
  let transport: string;
  beforeEach(async () => {
    w = await createClaimsWorld({ now: "2026-11-03T02:00:00.000Z" });
    transport = await w.type({ code: "TRANSPORT", name: "Transport" });
  });
  afterEach(() => w.t.close());

  const upload = async (seed: number) => {
    const res = await uploadAs(await w.as("staff"), pngBytes(seed), `receipt-${seed}.png`);
    expect(res.status).toBe(201);
    return (await json(res)).id as string;
  };
  const rowsOf = (ids: string[]) => w.deps.db.select().from(files).where(inArray(files.id, ids));
  const bytesOf = async (id: string) => {
    const [row] = await w.deps.db.select().from(files).where(eq(files.id, id));
    return row ? w.deps.fileStore.get(row.storageKey) : null;
  };
  const removedAudit = (orgId: string) =>
    w.deps.db
      .select({ targetId: auditEvents.targetId, actorType: auditEvents.actorType })
      .from(auditEvents)
      .where(and(eq(auditEvents.orgId, orgId), eq(auditEvents.action, "file.unattached_removed")));
  const sweep = (opts: { limit?: number } = {}) =>
    sweepUnattachedReceipts(w.deps.db, w.deps, {
      now: w.clock.now(),
      audit: (orgId) => systemAuditContext(orgId, "system", "test"),
      ...opts,
    });

  it("deletes unattached receipts older than 7 days on the tick (row, bytes, audit); attached ones stay", async () => {
    expect(UNATTACHED_RECEIPT_DAYS).toBe(7);
    const staff = await w.as("staff");
    const loose = await upload(1);
    const onDraft = await upload(2);
    const onSubmitted = await upload(3);
    const fromDeletedDraft = await upload(4);
    const deletedByUploader = await upload(5);
    await staff.post("/api/v1/claims", { lines: [line(transport, { receiptIds: [onDraft] })] });
    expect(
      (
        await staff.post("/api/v1/claims", {
          lines: [line(transport, { receiptIds: [onSubmitted] })],
          submit: true,
        })
      ).status,
    ).toBe(201);
    const gone = await json(
      await staff.post("/api/v1/claims", { lines: [line(transport, { receiptIds: [fromDeletedDraft] })] }),
    );
    expect((await staff.delete(`/api/v1/claims/${gone.id}`)).status).toBe(204);
    expect((await staff.delete(`/api/v1/claims/receipts/${deletedByUploader}`)).status).toBe(204);
    // Another purpose (a document upload) of the same age is never touched.
    const document = await insertUpload(
      w.deps,
      { orgId: w.orgId, employeeId: w.emp.staff, membershipId: w.m.staff.membershipId },
      { createdAt: w.clock.now(), purpose: "document", seed: 6 },
    );

    // Exactly 7 days old: kept.
    w.clock.advance(7 * DAY);
    expect((await tick(w.deps, w.clock.now())).transitions.claim_receipt_cleanup).toBe(0);
    expect(await rowsOf([loose, fromDeletedDraft, deletedByUploader])).toHaveLength(3);

    // Older than 7 days: the three on no claim line are deleted.
    w.clock.advance(1);
    const looseBytes = await bytesOf(loose);
    expect(looseBytes).not.toBeNull();
    const [looseRow] = await rowsOf([loose]);
    const report = await tick(w.deps, w.clock.now());
    expect(report.errors).toEqual([]);
    expect(report.transitions.claim_receipt_cleanup).toBe(3);
    expect(await rowsOf([loose, fromDeletedDraft, deletedByUploader])).toEqual([]);
    expect(await w.deps.fileStore.get(looseRow?.storageKey as string)).toBeNull();
    expect((await rowsOf([onDraft, onSubmitted, document.id])).map((r) => r.id).sort()).toEqual(
      [onDraft, onSubmitted, document.id].sort(),
    );
    expect(await bytesOf(onDraft)).not.toBeNull();
    expect(await bytesOf(onSubmitted)).not.toBeNull();
    expect(await w.deps.fileStore.get(document.storageKey)).not.toBeNull();
    expect((await removedAudit(w.orgId)).map((a) => a.targetId).sort()).toEqual(
      [loose, fromDeletedDraft, deletedByUploader].sort(),
    );
    expect((await removedAudit(w.orgId)).every((a) => a.actorType === "system")).toBe(true);
    // The receipt is gone for its uploader too (a fresh session: a week has passed).
    expect((await (await w.as("staff")).get(`/api/v1/claims/receipts/${loose}`)).status).toBe(404);

    // Idempotent: nothing more to do.
    expect((await tick(w.deps, w.clock.now())).transitions.claim_receipt_cleanup).toBe(0);
    expect(await removedAudit(w.orgId)).toHaveLength(3);
  });

  it("each organisation's receipts are checked against its own claim lines", async () => {
    const other = await seedOtherClaimsOrg(w);
    const old = new Date(w.clock.now().getTime() - 8 * DAY);
    const looseB = await insertUpload(w.deps, other, { createdAt: old, seed: 21 });
    const attachedB = await insertUpload(w.deps, other, { createdAt: old, seed: 22 });
    const documentB = await insertUpload(w.deps, other, { createdAt: old, purpose: "document", seed: 23 });
    await insertClaim(w.deps, other, {
      status: "approved",
      submittedAt: old,
      lines: [{ currency: "SGD", amountMinor: 1850, rateMicros: null, sgdCents: 1850, receiptIds: [attachedB.id] }],
    });
    // Kopi Kaki's fresh upload is too young to go.
    const fresh = await upload(24);
    expect(await sweep()).toBe(1);
    expect((await rowsOf([looseB.id, attachedB.id, documentB.id, fresh])).map((r) => r.id).sort()).toEqual(
      [attachedB.id, documentB.id, fresh].sort(),
    );
    expect(await w.deps.fileStore.get(looseB.storageKey)).toBeNull();
    expect(await w.deps.fileStore.get(attachedB.storageKey)).not.toBeNull();
    // Audited in Teh Tarik Trading's log, not Kopi Kaki's.
    expect((await removedAudit(other.orgId)).map((a) => a.targetId)).toEqual([looseB.id]);
    expect(await removedAudit(w.orgId)).toEqual([]);
  });

  it("two sweeps at once delete each receipt once, in batches", async () => {
    const ids = [await upload(31), await upload(32), await upload(33)];
    w.clock.advance(8 * DAY);
    const [a, b] = await Promise.all([sweep({ limit: 2 }), sweep({ limit: 2 })]);
    expect(a + b).toBe(3);
    expect(await sweep()).toBe(0);
    expect(await rowsOf(ids)).toEqual([]);
    expect((await removedAudit(w.orgId)).map((x) => x.targetId).sort()).toEqual([...ids].sort());
  });
});
