import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestDeps } from "../../testing/index.ts";
import { createApp } from "../app.ts";
import type { Db } from "../db/types.ts";
import type { ErrorEnvelope } from "../errors.ts";
import { type ValidationIssue, validate } from "./validate.ts";

const body = z.object({
  name: z.string().min(1),
  email: z.email(),
  employmentType: z.enum(["full_time", "part_time"]),
  salaryCents: z.number().int().nonnegative(),
  address: z.object({ postalCode: z.string().regex(/^\d{6}$/, "Enter a 6-digit Singapore postal code.") }),
});

function appWithRoute() {
  const app = createApp(createTestDeps({} as Db));
  app.post("/test", validate("json", body), (c) => {
    const parsed = c.req.valid("json");
    // Type-level check: parsed is the schema's output type.
    const cents: number = parsed.salaryCents;
    return c.json({ ok: true, cents });
  });
  app.get("/test", validate("query", z.object({ page: z.coerce.number().int().min(1) })), (c) =>
    c.json({ page: c.req.valid("query").page }),
  );
  return app;
}

const post = (json: unknown) =>
  appWithRoute().request("/test", {
    method: "POST",
    body: JSON.stringify(json),
    headers: { "content-type": "application/json" },
  });

describe("validate()", () => {
  it("passes parsed, typed input to the handler", async () => {
    const res = await post({
      name: "Tan Mei Ling",
      email: "mei.ling@example.sg",
      employmentType: "full_time",
      salaryCents: 450_000,
      address: { postalCode: "018956" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cents: 450_000 });
  });

  it("rejects invalid input with one actionable issue per field", async () => {
    const res = await post({ name: "", email: "nope", employmentType: "contractor", address: { postalCode: "12" } });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as ErrorEnvelope;
    expect(error.code).toBe("validation_failed");
    const issues = (error.details as { issues: ValidationIssue[] }).issues;
    expect(Object.fromEntries(issues.map((i) => [i.path, i.message]))).toEqual({
      name: "This field must not be empty.",
      email: "Enter a valid email address, like name@company.sg.",
      employmentType: "Choose one of: full_time, part_time.",
      salaryCents: "This field is required.",
      "address.postalCode": "Enter a 6-digit Singapore postal code.",
    });
  });

  it("returns validation_failed for malformed JSON", async () => {
    const res = await appWithRoute().request("/test", {
      method: "POST",
      body: "{nope",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorEnvelope).error.code).toBe("validation_failed");
  });

  it("validates query strings", async () => {
    const app = appWithRoute();
    expect((await app.request("/test?page=2")).status).toBe(200);
    const res = await app.request("/test?page=0");
    expect(res.status).toBe(400);
  });
});
