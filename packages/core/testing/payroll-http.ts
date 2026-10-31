import { createApp } from "../src/app.ts";
import type { AppDeps } from "../src/deps.ts";
import { type Person, type SeededCompany, seedCompany } from "../src/testing/payroll-harness.ts";
import { clientAs, createTestDeps, seedMember, type TestClient, type TestDb } from "./index.ts";

/** HTTP helpers for payroll tests (Node-only: uses the test client). */
export interface PayrollHttp<K extends string> {
  co: SeededCompany<K>;
  app: ReturnType<typeof createApp>;
  admin: TestClient;
  owner: TestClient;
  ok<T = Record<string, unknown>>(res: Response | Promise<Response>, status?: number): Promise<T>;
  /** create → compute → submit → approve (owner) → paid. Returns the run id. */
  payRun(
    body: Record<string, unknown>,
    items?: Record<string, unknown>[],
    opts?: { release?: boolean },
  ): Promise<string>;
}

export async function payrollHttp<K extends string>(
  t: TestDb,
  people: (Omit<Person, "key"> & { key: K })[],
  extraDeps: Partial<AppDeps> & Record<string, unknown> = {},
): Promise<PayrollHttp<K>> {
  const co = await seedCompany(createTestDeps(t.db, extraDeps as Partial<AppDeps>), people);
  Object.assign(co.h.deps, extraDeps);
  const app = createApp(co.h.deps);
  const admin = await clientAs(app, co.h.deps, await seedMember(co.h.deps, co.h.orgId, { roles: ["payroll_admin"] }));
  const owner = await clientAs(app, co.h.deps, await seedMember(co.h.deps, co.h.orgId, { roles: ["owner"] }));
  const ok = async <T>(res: Response | Promise<Response>, status = 200): Promise<T> => {
    const r = await res;
    const body = r.status === 204 ? null : await r.json();
    if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${JSON.stringify(body)}`);
    return body as T;
  };
  const api = "/api/v1/payroll";
  return {
    co,
    app,
    admin,
    owner,
    ok,
    async payRun(body, items = [], opts = {}) {
      const run = await ok<{ id: string }>(admin.post(`${api}/runs`, body), 201);
      for (const item of items) await ok(admin.post(`${api}/runs/${run.id}/items`, item), 201);
      await ok(admin.post(`${api}/runs/${run.id}/compute`));
      await ok(admin.post(`${api}/runs/${run.id}/submit`));
      await ok(owner.post(`${api}/runs/${run.id}/decision`, { outcome: "approved" }));
      if (opts.release) await ok(admin.post(`${api}/runs/${run.id}/release`));
      await ok(admin.post(`${api}/runs/${run.id}/mark-paid`));
      return run.id;
    },
  };
}
