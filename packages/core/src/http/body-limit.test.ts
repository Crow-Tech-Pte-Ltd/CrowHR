import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestDeps } from "../../testing/index.ts";
import { createApp } from "../app.ts";
import type { Db } from "../db/types.ts";
import { defineModule, defineRoute } from "./route.ts";

const app = () =>
  createApp(createTestDeps({} as Db), {
    modules: [
      defineModule({
        name: "body-test",
        basePath: "/body-test",
        routes: [
          defineRoute({
            method: "post",
            path: "/",
            summary: "Body limit probe",
            access: "public",
            request: { body: z.object({ text: z.string() }) },
            responses: { 200: z.object({ ok: z.boolean() }) },
            handler: () => ({ ok: true }),
          }),
        ],
      }),
    ],
  });

describe("global request body limit", () => {
  it.each([true, false])("rejects oversized JSON with content-length=%s", async (declared) => {
    const body = JSON.stringify({ text: "a".repeat(1024 * 1024) });
    const res = await app().request("/api/v1/body-test", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...(declared ? { "content-length": String(body.length) } : {}) },
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: "file_too_large" } });
  });
  it("rejects wrong content type before consuming the stream", async () => {
    let reads = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          reads++;
          c.enqueue(new TextEncoder().encode("{}"));
          c.close();
        },
      },
      { highWaterMark: 0 },
    );
    const req = new Request("http://localhost/api/v1/body-test", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body,
      duplex: "half",
    } as RequestInit);
    const res = await app().request(req);
    expect(res.status).toBe(400);
    expect(reads).toBe(0);
    await body.cancel();
  });
});
