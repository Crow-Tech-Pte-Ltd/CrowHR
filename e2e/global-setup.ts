import { request } from "@playwright/test";
import { apiSignIn, E2E } from "./fixtures.ts";

/** Signs the owner in once; the smoke tests reuse this session (stays under the per-IP sign-in limit). */
export default async function globalSetup() {
  const base = `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;
  const ctx = await request.newContext({ baseURL: base });
  await apiSignIn(ctx, E2E.members.owner.email);
  await ctx.storageState({ path: "test-results/owner.json" });
  await ctx.dispose();
}
