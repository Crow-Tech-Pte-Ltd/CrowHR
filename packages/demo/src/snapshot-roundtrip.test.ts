import { schema } from "@crowhr/core";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDemoSnapshot } from "../scripts/snapshot.ts";
import { CORE_MIGRATIONS } from "./bundled-migrations.ts";
import { openDemo, validateDemoSnapshot } from "./runtime.ts";
import { readSnapshot } from "./snapshot.ts";

describe("build snapshot round trip", () => {
  let snapshot: Blob;
  beforeAll(async () => {
    snapshot = await readSnapshot(new Response(await buildDemoSnapshot("roundtrip", CORE_MIGRATIONS)));
  });

  it("restores the real seed, anchors to the visitor rather than build time, and preserves that anchor on reload", async () => {
    expect(snapshot.size).toBeGreaterThan(0);
    const pglite = new PGlite({ loadDataDir: snapshot });
    let demo: Awaited<ReturnType<typeof openDemo>> | undefined;
    let realNow = Date.parse("2028-04-15T02:00:00Z");
    try {
      await pglite.waitReady;
      await expect(validateDemoSnapshot(pglite, "stale-version")).rejects.toThrow(/snapshot/);
      await validateDemoSnapshot(pglite, "roundtrip");
      demo = await openDemo({
        pglite,
        origin: "http://127.0.0.1:5181",
        dataVersion: "roundtrip",
        migrations: CORE_MIGRATIONS,
        realNow: () => realNow,
      });
      expect(demo.info.today).toBe("2026-10-31");
      // Every visit opens at 11:30 on the demo Saturday in Singapore, whatever the real time.
      expect(demo.deps.clock.now().toISOString()).toBe("2026-10-31T03:30:00.000Z");
      expect(demo.timings.stages.map((s) => s.stage)).toEqual(["app"]);
      expect(demo.timings.seeded).toBe(true);
      expect(await demo.deps.db.select().from(schema.employees)).toHaveLength(27);
      const versions = await demo.deps.db.select().from(schema.documentVersions);
      const files = await demo.deps.db.select().from(schema.files);
      const ket = versions.find((v) => v.source === "generated");
      const file = files.find((f) => f.id === ket?.fileId);
      expect(file).toBeDefined();
      const stored = await demo.deps.fileStore.get(file?.storageKey as string);
      expect(new TextDecoder().decode(stored?.data.slice(0, 5))).toBe("%PDF-");
      // Encrypted seed fields remain decryptable after restore, not just visible as masked text.
      const providers = await demo.deps.db.select().from(schema.ssoProviders);
      const google = providers.find((p) => p.kind === "google");
      expect(await demo.deps.secretBox.decrypt("sso-client-secret", google?.clientSecretEnc as string)).toBe(
        "demo-not-a-secret",
      );
      const outbox = await demo.outbox();
      expect(outbox.some((m) => m.text.includes("http://127.0.0.1:5181/"))).toBe(true);
      expect(outbox.some((m) => m.text.includes("https://hr.crow.sg/"))).toBe(false);
      await demo.stop();
      realNow += 86_400_000;
      demo = await openDemo({
        pglite,
        origin: "http://127.0.0.1:5181",
        dataVersion: "roundtrip",
        migrations: CORE_MIGRATIONS,
        realNow: () => realNow,
      });
      expect(demo.info.today).toBe("2026-11-01");
      expect(demo.timings.seeded).toBe(false);
    } finally {
      await demo?.stop();
      await pglite.close();
    }
  });
});
