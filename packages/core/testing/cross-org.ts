import { getTableColumns, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { type App, allV1Modules } from "../src/app.ts";
import * as schema from "../src/db/schema/index.ts";
import type { Db } from "../src/db/types.ts";
import { type ApiModule, describeRoute, fullPath, pathParamNames } from "../src/http/route.ts";
import type { TestClient } from "./http.ts";

/**
 * Cross-organisation isolation sweep (access-control "Organisation data isolation"; roadmap
 * merge-hotspot 5). Discovers every non-public v1 route that takes a path parameter, calls it
 * as an owner of org A with the IDs of org B's records, and expects 404 every time.
 *
 * New modules need no registration: mount the module in V1_MODULES, seed org B with at least
 * one row of each of your tables, and the sweep covers your routes. Mutating routes need
 * `example.body` (a body that passes validation) or they are reported as untestable. Routes that
 * take no record ID in their path params may set `crossOrgExempt: "<reason>"`.
 */
export async function foreignIds(db: Db, orgId: string, opts: { perTable?: number } = {}): Promise<string[]> {
  const perTable = opts.perTable ?? 50;
  const ids = new Set<string>([orgId]);
  for (const table of Object.values(schema) as unknown[]) {
    if (!is(table, PgTable)) continue;
    const cols = getTableColumns(table) as Record<string, { name: string }>;
    const names = Object.values(cols).map((c) => c.name);
    if (!names.includes("org_id")) continue;
    const idCol = names.includes("id")
      ? "id"
      : names.includes("state_hash")
        ? "state_hash"
        : names.includes("token_hash")
          ? "token_hash"
          : null;
    if (!idCol) continue;
    const name = (table as unknown as Record<symbol, string>)[Symbol.for("drizzle:Name")];
    const rows = await db.execute<{ id: string }>(
      sql.raw(`select ${idCol}::text as id from "${name}" where org_id = '${orgId}' order by 1 limit ${perTable}`),
    );
    for (const row of (rows as unknown as { rows?: { id: string }[] }).rows ?? (rows as unknown as { id: string }[]))
      ids.add(row.id);
  }
  return [...ids];
}

export interface CrossOrgResult {
  checked: string[];
  failures: string[];
  untestable: string[];
}

export async function sweepCrossOrg(input: {
  app: App;
  /** A client signed in as an owner of org A (the attacker's own organisation). */
  ownerOfA: TestClient;
  /** IDs of records belonging to org B. */
  idsOfB: string[];
  /** Defaults to every built-in v1 module. */
  modules?: readonly ApiModule[];
  /** Requests in flight at once (default 8). Results are reported in route/ID order either way. */
  concurrency?: number;
}): Promise<CrossOrgResult> {
  const modules = input.modules ?? allV1Modules();
  const result: CrossOrgResult = { checked: [], failures: [], untestable: [] };
  const calls: { name: string; id: string; path: string; init: RequestInit & { json?: unknown } }[] = [];
  for (const module of modules) {
    for (const route of module.routes) {
      const params = pathParamNames(route.path);
      if (!params.length || route.access === "public" || route.crossOrgExempt) continue;
      const name = describeRoute(module, route);
      const needsBody = !!route.request?.body && !route.request.body.safeParse({}).success;
      if (needsBody && route.example?.body === undefined) {
        result.untestable.push(`${name}: add \`example.body\` so the sweep can call it`);
        continue;
      }
      result.checked.push(name);
      for (const id of input.idsOfB) {
        let path = fullPath(module, route);
        for (const p of params) path = path.replace(`:${p}`, encodeURIComponent(id));
        calls.push({
          name,
          id,
          path,
          init: {
            method: route.method.toUpperCase(),
            ...(route.request?.body ? { json: route.example?.body ?? {} } : {}),
          },
        });
      }
    }
  }
  const outcomes: (string | null)[] = new Array(calls.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < calls.length) {
      const i = next++;
      const { name, id, path, init } = calls[i] as (typeof calls)[number];
      const res = await input.ownerOfA.request(path, init);
      if (res.status === 400) {
        const body = (await res.json()) as { error?: { details?: { target?: string } } };
        // The foreign ID doesn't fit this parameter's format (e.g. a hash vs a UUID): not a leak.
        if (body.error?.details?.target === "param") continue;
        outcomes[i] = `${name} with ${id}: 400 on the ${body.error?.details?.target ?? "request"} — fix example.body`;
        continue;
      }
      await res.body?.cancel();
      if (res.status !== 404) outcomes[i] = `${name} with ${id}: expected 404, got ${res.status}`;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, input.concurrency ?? 8) }, worker));
  result.failures = outcomes.filter((o): o is string => o !== null);
  return result;
}
