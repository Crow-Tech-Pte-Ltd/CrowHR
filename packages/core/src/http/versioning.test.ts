import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestDeps } from "../../testing/index.ts";
import { createApp } from "../app.ts";
import type { Db } from "../db/types.ts";
import type { ErrorEnvelope } from "../errors.ts";
import { defineModule, defineRoute } from "./route.ts";

const legacy = defineModule({
  name: "legacy",
  basePath: "/legacy",
  routes: [
    defineRoute({
      method: "get",
      path: "/",
      summary: "An old endpoint",
      access: "public",
      deprecated: { since: "2027-01-01", sunset: "2028-01-01" },
      responses: { 200: z.object({ ok: z.boolean() }) },
      handler: () => ({ ok: true }),
    }),
  ],
});

const app = () => createApp(createTestDeps({} as Db), { modules: [legacy] });

describe("API versioning", () => {
  it("serves modules under /api/v1", async () => {
    const res = await app().request("/api/v1/legacy");
    expect(res.status).toBe(200);
  });

  it("keeps /api/health unversioned", async () => {
    expect((await app().request("/api/v1/health")).status).toBe(404);
  });

  it("answers an unknown version with 404 and the supported versions", async () => {
    const res = await app().request("/api/v9/employees");
    expect(res.status).toBe(404);
    const { error } = (await res.json()) as ErrorEnvelope;
    expect(error.code).toBe("not_found");
    expect(error.details).toEqual({ supportedVersions: ["v1"] });
  });

  it("answers an unknown v1 path with a plain 404", async () => {
    const res = await app().request("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorEnvelope).error.details).toBeUndefined();
  });

  it("sends Deprecation and Sunset headers on deprecated routes", async () => {
    const res = await app().request("/api/v1/legacy");
    expect(res.status).toBe(200);
    expect(res.headers.get("sunset")).toBe("Sat, 01 Jan 2028 00:00:00 GMT");
    expect(res.headers.get("deprecation")).toBe(`@${Date.parse("2027-01-01") / 1000}`);
  });
});
