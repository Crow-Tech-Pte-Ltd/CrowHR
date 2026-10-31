import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ClaimsWorld, createClaimsWorld, json, line } from "../../testing/claims.ts";

const transportInput = {
  code: "transport",
  name: "Transport",
  category: "transport",
  receiptRule: "above",
  receiptAboveCents: 2000,
  capPeriod: "none",
};

describe("claim types", () => {
  let w: ClaimsWorld;
  beforeEach(async () => {
    w = await createClaimsWorld();
  });
  afterEach(() => w.t.close());

  it("owners and hr_admins write; payroll_admin reads; employees and managers can't", async () => {
    const created = await (await w.as("hr")).post("/api/v1/claims/types", transportInput);
    expect(created.status).toBe(201);
    const t = await json(created);
    expect(t).toMatchObject({
      code: "TRANSPORT",
      receiptAboveCents: 2000,
      capCents: null,
      archived: false,
      inUse: false,
      taxable: false,
    });
    expect(
      (await (await w.as("owner")).patch(`/api/v1/claims/types/${t.id}`, { capCents: 20_000, capPeriod: "monthly" }))
        .status,
    ).toBe(200);
    expect((await (await w.as("payroll")).get("/api/v1/claims/types")).status).toBe(200);
    expect((await (await w.as("payroll")).post("/api/v1/claims/types", { ...transportInput, code: "X2" })).status).toBe(
      403,
    );
    for (const who of ["staff", "manager"] as const) {
      expect((await (await w.as(who)).get("/api/v1/claims/types")).status).toBe(403);
      expect((await (await w.as(who)).post("/api/v1/claims/types", { ...transportInput, code: "X3" })).status).toBe(
        403,
      );
    }
  });

  it("validates cap and receipt settings with messages that say how to fix them", async () => {
    const hr = await w.as("hr");
    const res = await hr.post("/api/v1/claims/types", {
      ...transportInput,
      receiptRule: "above",
      receiptAboveCents: null,
      capPeriod: "monthly",
    });
    expect(res.status).toBe(400);
    const issues = (await json(res)).error.details.issues.map((i: { path: string }) => i.path).sort();
    expect(issues).toEqual(["capCents", "receiptAboveCents"]);
    await hr.post("/api/v1/claims/types", transportInput);
    const dup = await hr.post("/api/v1/claims/types", { ...transportInput, name: "Taxi" });
    expect(dup.status).toBe(409);
    expect((await json(dup)).error.message).toMatch(/already uses the code TRANSPORT/);
  });

  it("starter set: offered, created on request, not duplicated", async () => {
    const hr = await w.as("hr");
    const offered = await json(await hr.get("/api/v1/claims/types/starter"));
    expect(offered.items.map((t: { code: string }) => t.code)).toEqual([
      "TRANSPORT",
      "MEALS",
      "ENTERTAINMENT",
      "MEDICAL",
      "DENTAL",
      "PHONE",
    ]);
    const res = await hr.post("/api/v1/claims/types/starter", {});
    expect(res.status).toBe(201);
    const made = await json(res);
    expect(made.items).toHaveLength(6);
    expect((await json(await hr.post("/api/v1/claims/types/starter", {}))).items).toHaveLength(6);
    const phone = made.items.find((t: { code: string }) => t.code === "PHONE");
    expect(phone).toMatchObject({ capCents: 5000, capPeriod: "monthly", eligibleEmploymentTypes: ["full_time"] });
  });

  it("a type in use can be archived (and restored) but not deleted; an unused one can be deleted", async () => {
    const hr = await w.as("hr");
    const t = await json(await hr.post("/api/v1/claims/types", transportInput));
    const unused = await json(
      await hr.post("/api/v1/claims/types", { ...transportInput, code: "PARKING", name: "Parking" }),
    );
    await (await w.as("staff")).post("/api/v1/claims", { lines: [line(t.id)] });
    const del = await hr.delete(`/api/v1/claims/types/${t.id}`);
    expect(del.status).toBe(409);
    expect((await json(del)).error.message).toMatch(/Archive it instead/);
    const archived = await json(await hr.post(`/api/v1/claims/types/${t.id}/archive`));
    expect(archived).toMatchObject({ archived: true, inUse: true });
    expect((await json(await hr.get("/api/v1/claims/types"))).items.map((x: { code: string }) => x.code)).toEqual([
      "PARKING",
    ]);
    expect((await json(await hr.get("/api/v1/claims/types?includeArchived=true"))).items).toHaveLength(2);
    // Archived types are not offered and can't be submitted.
    const offered = await json(await (await w.as("staff")).get("/api/v1/claims/eligible-types"));
    expect(offered.items.map((x: { code: string }) => x.code)).toEqual(["PARKING"]);
    expect((await hr.post(`/api/v1/claims/types/${t.id}/restore`)).status).toBe(200);
    expect((await hr.delete(`/api/v1/claims/types/${unused.id}`)).status).toBe(204);
  });

  it("eligibility by employment type and probation: hidden from the form, 422 not_eligible on submit", async () => {
    const hr = await w.as("hr");
    const phone = await json(
      await hr.post("/api/v1/claims/types", {
        code: "PHONE",
        name: "Phone allowance claim",
        category: "phone",
        receiptRule: "never",
        capPeriod: "none",
        eligibleEmploymentTypes: ["full_time"],
      }),
    );
    const training = await json(
      await hr.post("/api/v1/claims/types", {
        code: "TRAINING",
        name: "Training",
        category: "training",
        receiptRule: "never",
        capPeriod: "none",
        availableDuringProbation: false,
      }),
    );
    const intern = await w.as("intern");
    const offered = (await json(await intern.get("/api/v1/claims/eligible-types"))).items.map(
      (t: { code: string }) => t.code,
    );
    expect(offered).not.toContain("PHONE");
    expect(offered).not.toContain("TRAINING");
    const res = await intern.post("/api/v1/claims", { lines: [line(phone.id)], submit: true });
    expect(res.status).toBe(422);
    expect((await json(res)).error).toMatchObject({
      code: "not_eligible",
      message: expect.stringContaining("only for full-time staff"),
    });
    const probation = await intern.post("/api/v1/claims", { lines: [line(training.id)], submit: true });
    expect(probation.status).toBe(422);
    expect((await json(probation)).error.message).toMatch(/available after probation/);
    // Full-time staff past probation get both.
    const staffOffered = (await json(await (await w.as("staff")).get("/api/v1/claims/eligible-types"))).items.map(
      (t: { code: string }) => t.code,
    );
    expect(staffOffered).toEqual(expect.arrayContaining(["PHONE", "TRAINING"]));
  });

  it("settings: submission window", async () => {
    const hr = await w.as("hr");
    expect(await json(await hr.get("/api/v1/claims/settings"))).toEqual({ submissionWindowDays: 90, scanning: false });
    expect((await hr.put("/api/v1/claims/settings", { submissionWindowDays: 3 })).status).toBe(400);
    expect(await json(await hr.put("/api/v1/claims/settings", { submissionWindowDays: 60 }))).toEqual({
      submissionWindowDays: 60,
      scanning: false,
    });
    expect((await (await w.as("payroll")).put("/api/v1/claims/settings", { submissionWindowDays: 60 })).status).toBe(
      403,
    );
  });
});
