import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { html } from "hono/html";
import { z } from "zod";
import { csrfProtection } from "../auth/csrf.ts";
import { authenticate } from "../auth/sessions.ts";
import type { AppContext, AppEnv } from "../context.ts";
import { assistantClientId, assistantProvider } from "./clients.ts";
import { authenticateAssistant, exchangeToken, issueCode, policyAllows } from "./grants.ts";
import { ASSISTANT_SCOPE, assistantAvailable, assistantOrg, assistantResource } from "./settings.ts";

const ROOT = "/mcp/oauth";
const AUTHORIZE = `${ROOT}/authorize`;
const METADATA = "/.well-known/oauth-protected-resource";
const AUTH_METADATA = "/.well-known/oauth-authorization-server";
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const client = z.string().min(1).max(512);
const resource = z.string().max(550);
const authorization = z.object({
  response_type: z.literal("code"),
  client_id: client,
  redirect_uri: z.string().max(300),
  resource,
  code_challenge_method: z.literal("S256"),
  code_challenge: token,
  scope: z.literal(ASSISTANT_SCOPE).default(ASSISTANT_SCOPE),
  state: z.string().min(1).max(512),
});
const exchange = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    code: token,
    code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
    client_id: client,
    redirect_uri: z.string().max(300),
    resource,
  }),
  z.object({ grant_type: z.literal("refresh_token"), refresh_token: token, client_id: client, resource }),
]);

function parameters(values: URLSearchParams) {
  const entries = Object.fromEntries(values);
  return Object.keys(entries).length === values.size ? entries : null;
}

async function form(c: AppContext) {
  if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(c.req.header("content-type") ?? "")) return null;
  return parameters(new URLSearchParams(await c.req.text()));
}

const issuer = (c: AppContext) => new URL(c.var.deps.publicUrl).origin;

async function findResource(c: AppContext, value: string) {
  const prefix = `${issuer(c)}/mcp/`;
  if (!value.startsWith(prefix)) return null;
  const slug = value.slice(prefix.length);
  return assistantOrg(c.var.deps, slug);
}

function consentPage(c: AppContext, title: string, content: ReturnType<typeof html>, status: 200 | 400 | 403 = 200) {
  c.header("referrer-policy", "no-referrer");
  return c.html(
    html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Crow HR</title>
<style>
html{color-scheme:light dark}body{font:1rem/1.55 system-ui;max-width:32rem;margin:8vh auto;padding:0 1.25rem}
button{font:inherit;padding:.45rem .85rem;margin:.3rem .5rem .3rem 0}a,button{min-height:2rem}h1{line-height:1.2}
</style></head><body><main><h1>${title}</h1>${content}</main></body></html>`,
    status,
  );
}

const invalidAuthorization = (c: AppContext) =>
  consentPage(
    c,
    "Can't connect this assistant",
    html`<p>Check the connector URL and OAuth settings, then try connecting again from your assistant.</p>`,
    400,
  );

export type AssistantTransport = (c: AppContext) => Promise<Response>;

export function assistantHttp(transport?: AssistantTransport) {
  const app = new Hono<AppEnv>();
  const guard = async (c: AppContext, next: () => Promise<void>) => {
    c.header("cache-control", "no-store");
    if (!assistantAvailable(c.var.deps) || !transport) return c.notFound();
    await next();
  };
  app.use("/mcp/*", guard, bodyLimit({ maxSize: 65_536 }));
  app.use(AUTH_METADATA, guard);
  app.use(`${METADATA}/*`, guard);
  app.use(AUTHORIZE, authenticate(), csrfProtection());

  app.get(AUTH_METADATA, (c) => {
    const base = issuer(c);
    return c.json({
      issuer: base,
      authorization_endpoint: base + AUTHORIZE,
      token_endpoint: `${base}${ROOT}/token`,
      registration_endpoint: `${base}${ROOT}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [ASSISTANT_SCOPE],
      authorization_response_iss_parameter_supported: true,
    });
  });

  app.get(`${METADATA}/mcp/:org`, async (c) => {
    const org = await assistantOrg(c.var.deps, c.req.param("org"));
    if (!org?.slug) return c.notFound();
    return c.json({
      resource: assistantResource(c.var.deps, org.slug),
      authorization_servers: [issuer(c)],
      scopes_supported: [ASSISTANT_SCOPE],
      bearer_methods_supported: ["header"],
    });
  });

  app.post(`${ROOT}/register`, async (c) => {
    const metadata = z
      .object({
        redirect_uris: z.array(z.string().max(300)).length(1),
        token_endpoint_auth_method: z.literal("none").optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    const uri = metadata.success ? metadata.data.redirect_uris[0] : undefined;
    const provider = uri && assistantProvider(uri);
    if (!uri || !provider)
      return c.json(
        {
          error: "invalid_client_metadata",
          error_description: "Register the supported ChatGPT or Claude callback using a public OAuth client.",
        },
        400,
      );
    return c.json(
      {
        client_id: assistantClientId(uri),
        client_name: provider,
        redirect_uris: [uri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201,
    );
  });

  app.on(["GET", "POST"], AUTHORIZE, async (c) => {
    const requestUrl = new URL(c.req.url);
    if (requestUrl.search.length > 4096) return invalidAuthorization(c);
    const values = c.req.method === "GET" ? parameters(requestUrl.searchParams) : await form(c);
    const result = authorization.safeParse(values);
    if (!result.success) return invalidAuthorization(c);
    const input = result.data;
    const provider = assistantProvider(input.redirect_uri);
    if (!provider || input.client_id !== assistantClientId(input.redirect_uri)) return invalidAuthorization(c);
    const org = await findResource(c, input.resource);
    if (!org?.slug) return c.notFound();
    const auth = c.var.auth;
    if (auth?.session.kind !== "browser" || auth.orgId !== org.id || auth.membershipStatus !== "active") {
      if (c.req.method !== "GET") return invalidAuthorization(c);
      return c.redirect(
        `/sign-in/${encodeURIComponent(org.slug)}?${new URLSearchParams({ assistant: requestUrl.search.slice(1) })}`,
        302,
      );
    }
    if (!(await policyAllows(c, auth))) {
      return consentPage(
        c,
        "Two-step verification required",
        html`<p>Open <a href="/me/sessions">Sessions</a> to set up two-step verification, then start the connection again.</p>`,
        403,
      );
    }
    if (c.req.method === "POST") {
      if (c.req.header("origin") !== issuer(c)) return invalidAuthorization(c);
      const redirect = new URL(input.redirect_uri);
      redirect.searchParams.set("state", input.state);
      redirect.searchParams.set("iss", issuer(c));
      if (values?.decision === "deny") {
        redirect.searchParams.set("error", "access_denied");
      } else if (values?.decision === "allow") {
        const code = await issueCode(c, auth, input);
        if (!code) return c.notFound();
        redirect.searchParams.set("code", code);
      } else {
        return invalidAuthorization(c);
      }
      c.header("referrer-policy", "no-referrer");
      return c.redirect(redirect.href, 303);
    }
    return consentPage(
      c,
      `Connect ${provider} to Crow HR`,
      html`
      <p>Signed in as <strong>${auth.user.email}</strong> at <strong>${org.name}</strong>.</p>
      <p>${provider} can look up your available leave, next published shift and the number of approvals waiting for you. Results are shared with ${provider} and may appear in your chats.</p>
      <p>You can disconnect at any time in Crow HR under AI assistants.</p>
      <form method="post" action="${AUTHORIZE}">
        ${Object.entries(input).map(([name, value]) => html`<input type="hidden" name="${name}" value="${value}">`)}
        <button type="submit" name="decision" value="deny">Cancel</button>
        <button type="submit" name="decision" value="allow">Allow read-only access</button>
      </form>`,
    );
  });

  app.post(`${ROOT}/token`, async (c) => {
    const request = exchange.safeParse(await form(c));
    if (!request.success) return c.json({ error: "invalid_request" }, 400);
    const org = await findResource(c, request.data.resource);
    const result = org && (await exchangeToken(c, org.id, request.data));
    if (!result) return c.json({ error: "invalid_grant" }, 400);
    return c.json(result);
  });

  app.all("/mcp/:org", async (c) => {
    const origin = c.req.header("origin");
    if (origin && ![issuer(c), "https://chatgpt.com", "https://claude.ai"].includes(origin)) {
      return c.json({ error: "invalid_origin" }, 403);
    }
    const org = await assistantOrg(c.var.deps, c.req.param("org"));
    if (!org?.slug || !transport) return c.notFound();
    const auth = await authenticateAssistant(c, org.id, assistantResource(c.var.deps, org.slug));
    if (!auth) {
      c.header(
        "www-authenticate",
        `Bearer resource_metadata="${issuer(c)}${METADATA}/mcp/${org.slug}", scope="${ASSISTANT_SCOPE}"`,
      );
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("auth", auth);
    return transport(c);
  });

  app.all("/mcp/*", (c) => c.notFound());
  app.all(METADATA, (c) => c.notFound());
  app.all(`${METADATA}/*`, (c) => c.notFound());
  return app;
}
