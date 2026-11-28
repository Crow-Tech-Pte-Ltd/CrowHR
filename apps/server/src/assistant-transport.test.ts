import { createApp, schema } from "@crowhr/core";
import {
  clientAs,
  createTestDb,
  createTestDeps,
  seedEmployee,
  seedMember,
  seedOrg,
  type TestDb,
} from "@crowhr/core/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Base64Url } from "../../../packages/core/src/crypto/tokens.ts";
import { serveAssistant } from "./assistant-transport.ts";

describe("remote MCP authorization", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(() => db.close());

  it("binds consent, codes and tools to the selected company and the current member", async () => {
    const publicUrl = "https://hr.example.org";
    const deps = createTestDeps(db.db, { publicUrl, assistantEnabled: true });
    const app = createApp(deps, { assistantTransport: serveAssistant });
    const org = await seedOrg(deps, { slug: "first-company" });
    const otherOrg = await seedOrg(deps, { slug: "other-company" });
    const employeeId = await seedEmployee(deps, org.id);
    const otherEmployeeId = await seedEmployee(deps, org.id);
    const member = await seedMember(deps, org.id, { roles: ["owner"], employeeId });
    const rosterId = deps.ids.newId();
    const starts = new Date(deps.clock.now().getTime() + 2 * 3_600_000);
    const day = starts.toISOString().slice(0, 10);
    await db.db
      .insert(schema.rosters)
      .values({ id: rosterId, orgId: org.id, scopeKey: "*:*", weekStart: day, status: "published" });
    const times = {
      rosterId,
      orgId: org.id,
      version: 1,
      publishedAt: deps.clock.now(),
      date: day,
      endsAt: new Date(starts.getTime() + 3_600_000),
    };
    await db.db.insert(schema.publishedShifts).values([
      { ...times, id: deps.ids.newId(), employeeId, startsAt: starts, note: "Private roster note" },
      { ...times, id: deps.ids.newId(), employeeId: otherEmployeeId, startsAt: new Date(starts.getTime() - 3_600_000) },
    ]);
    const owner = await clientAs(app, deps, member);
    const other = await clientAs(app, deps, await seedMember(deps, otherOrg.id, { roles: ["owner"] }));
    const resourcePath = `/mcp/${org.slug}`;
    const resource = publicUrl + resourcePath;
    const config = "/api/v1/assistant/settings";
    const register = "/mcp/oauth/register";
    const authorize = "/mcp/oauth/authorize";
    const token = "/mcp/oauth/token";
    const redirect = "https://claude.ai/api/mcp/auth_callback";

    expect((await app.request(resourcePath)).status).toBe(404);
    expect((await owner.put(config, { enabled: true })).status).toBe(200);
    expect((await other.put(config, { enabled: true })).status).toBe(200);
    const challenge = await app.request(resourcePath);
    expect(challenge.status).toBe(401);
    const metadata = challenge.headers.get("www-authenticate")?.match(/resource_metadata="([^"]+)"/)?.[1];
    expect(metadata).toBeTruthy();
    expect(await (await app.request(metadata ?? "/")).json()).toMatchObject({
      resource,
      authorization_servers: [publicUrl],
    });

    expect((await owner.post(register, { redirect_uris: ["https://untrusted.example/callback"] })).status).toBe(400);
    const registration = await owner.post(register, { redirect_uris: [redirect], token_endpoint_auth_method: "none" });
    expect(registration.status).toBe(201);
    const clientId = ((await registration.json()) as { client_id: string }).client_id;
    const verifier = "A".repeat(43);
    const req = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      resource,
      state: "assistant-client-state",
      response_type: "code",
      code_challenge_method: "S256",
      code_challenge: await sha256Base64Url(verifier),
    });
    const landing = await app.request(`${authorize}?${req}`);
    expect(landing.status).toBe(302);
    expect(landing.headers.get("location")).toMatch(/^\/sign-in\/first-company\?assistant=/);
    const consent = await owner.get(`${authorize}?${req}`);
    expect(consent.status).toBe(200);
    expect(consent.headers.get("content-security-policy")).toContain(
      "form-action 'self' https://chatgpt.com https://claude.ai",
    );
    expect(await consent.text()).toContain("Allow read-only access");
    const post = (client: typeof owner, path: string, values: URLSearchParams) =>
      client.request(path, { method: "POST", body: values });
    req.set("decision", "allow");
    expect((await post(other, authorize, req)).status).toBe(400);
    const approved = await post(owner, authorize, req);
    expect(approved.status).toBe(303);
    const callback = new URL(approved.headers.get("location") ?? "/");
    expect(callback.searchParams.get("state")).toBe("assistant-client-state");

    const exchange = new URLSearchParams({
      grant_type: "authorization_code",
      code: callback.searchParams.get("code") ?? "",
      code_verifier: "B".repeat(43),
      client_id: clientId,
      redirect_uri: redirect,
      resource,
    });
    expect((await post(owner, token, exchange)).status).toBe(400);
    exchange.set("code_verifier", verifier);
    const issued = await post(owner, token, exchange);
    expect(issued.status).toBe(200);
    const session = (await issued.json()) as { access_token: string; refresh_token: string };
    expect((await post(owner, token, exchange)).status).toBe(400);

    const rpc = (method: string, params?: object, path = resourcePath, access = session.access_token) =>
      app.request(path, {
        method: "POST",
        headers: {
          authorization: `Bearer ${access}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
    expect((await rpc("tools/list", undefined, `/mcp/${otherOrg.slug}`)).status).toBe(401);
    const init = await rpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.status).toBe(200);
    expect(await init.json()).toMatchObject({ result: { serverInfo: { name: "Crow HR" } } });
    const listed = await rpc("tools/list", {});
    expect(listed.status).toBe(200);
    const tools = (await listed.json()) as {
      result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] };
    };
    expect(tools.result.tools.map((tool) => tool.name).sort()).toEqual([
      "my_annual_leave_balance",
      "my_next_shift",
      "my_pending_approval_count",
    ]);
    expect(tools.result.tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
    const count = await rpc("tools/call", { name: "my_pending_approval_count", arguments: {} });
    expect(await count.json()).toMatchObject({ result: { structuredContent: { pending: 0 } } });
    const shift = await rpc("tools/call", { name: "my_next_shift", arguments: {} });
    expect(await shift.json()).toMatchObject({
      result: {
        structuredContent: {
          shift: { date: day, startsAt: starts.toISOString(), endsAt: times.endsAt.toISOString() },
          timeZone: "Asia/Singapore",
        },
      },
    });
    const leave = await rpc("tools/call", { name: "my_annual_leave_balance", arguments: {} });
    expect(await leave.json()).toMatchObject({ result: { structuredContent: { year: expect.any(Number) } } });
    const rest = await app.request("/api/v1/me", { headers: { authorization: `Bearer ${session.access_token}` } });
    expect(rest.status).toBe(401);

    const refresh = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refresh_token,
      client_id: clientId,
      resource,
    });
    const rotated = await post(owner, token, refresh);
    expect(rotated.status).toBe(200);
    const renewed = (await rotated.json()) as typeof session;
    expect((await rpc("tools/list")).status).toBe(401);
    expect((await rpc("tools/list", undefined, resourcePath, renewed.access_token)).status).toBe(200);
    await db.db
      .update(schema.memberships)
      .set({ status: "suspended" })
      .where(eq(schema.memberships.id, member.membershipId));
    expect((await rpc("tools/list", undefined, resourcePath, renewed.access_token)).status).toBe(401);
    await db.db
      .update(schema.memberships)
      .set({ status: "active" })
      .where(eq(schema.memberships.id, member.membershipId));

    const list = "/api/v1/assistant/connections";
    const connections = ((await (await owner.get(list)).json()) as { connections: { id: string }[] }).connections;
    expect(connections).toHaveLength(1);
    const connection = `${list}/${connections[0]?.id}`;
    expect((await other.delete(connection)).status).toBe(204);
    expect((await rpc("tools/list", undefined, resourcePath, renewed.access_token)).status).toBe(200);
    expect((await owner.delete(connection)).status).toBe(204);
    expect((await rpc("tools/list", undefined, resourcePath, renewed.access_token)).status).toBe(401);
    refresh.set("refresh_token", renewed.refresh_token);
    expect((await post(owner, token, refresh)).status).toBe(400);
    expect((await owner.put(config, { enabled: false })).status).toBe(200);
    expect((await app.request(resourcePath)).status).toBe(404);
  });
});
