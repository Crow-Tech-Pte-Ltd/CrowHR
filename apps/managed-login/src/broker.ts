import { createHmac } from "node:crypto";
import { createSecretBox, SECRET_PURPOSES } from "@crowhr/core";
import {
  createDpopProof,
  type DpopKeys,
  PRESETS,
  publicOnly,
  restoreDpopProof,
  singpassSubject,
} from "@crowhr/core/singpass";
import { errors, type KoaContextWithOIDC, Provider } from "oidc-provider";
import * as oidc from "openid-client";
import type { BrokerConfig } from "./config.ts";
import type { BrokerStorage } from "./storage.ts";

export const SINGPASS_CALLBACK_PATH = "/singpass/login";
const AUTHORIZE_PATH = "/authorize";
const MAX_STATE_LENGTH = 500;

export type BrokerAudit = (event: { client: string; outcome: "success" | "failure" }) => void;

type BrokerOptions = Pick<BrokerConfig, "issuer" | "subjectKey" | "attemptKey" | "cookieKeys" | "clients"> & {
  signingKeys: { keys: (JsonWebKey & { kid?: string })[] };
  singpassKeys: { keys: JsonWebKey[] };
  upstream: () => Promise<oidc.Configuration>;
  storage: BrokerStorage;
  audit: BrokerAudit;
};

interface AttemptProof {
  verifier: string;
  nonce: string;
  keys: DpopKeys;
}

export function subjectFor(key: Uint8Array, client: string, issuer: string, subject: string): string {
  const digest = createHmac("sha256", key)
    .update(JSON.stringify([client, issuer, singpassSubject(subject)]))
    .digest("base64url");
  return `${client}:${digest}`;
}

export function createBroker(options: BrokerOptions) {
  const { storage, issuer, audit } = options;
  const clients = options.clients.filter((client) => !client.suspended);
  const active = new Set(clients.map((client) => client.id));
  const secretBox = createSecretBox(options.attemptKey);
  const callback = new URL(SINGPASS_CALLBACK_PATH, issuer).href;
  const origin = new URL(issuer);
  const provider = new Provider(issuer, {
    adapter: storage.adapter,
    clients: clients.map((client) => ({
      client_id: client.id,
      client_secret: client.secret,
      redirect_uris: [client.callback],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      id_token_signed_response_alg: "ES256",
    })),
    jwks: {
      keys: options.signingKeys.keys.map(({ kty, crv, kid, use, alg, x, y, d }) => ({
        kty,
        crv,
        kid,
        use,
        alg,
        x,
        y,
        d,
      })),
    },
    cookies: { keys: options.cookieKeys },
    features: {
      devInteractions: { enabled: false },
      userinfo: { enabled: false },
      rpInitiatedLogout: { enabled: false },
    },
    scopes: ["openid"],
    claims: { openid: ["sub"] },
    responseTypes: ["code"],
    clientAuthMethods: ["client_secret_post"],
    pkce: { required: () => true },
    ttl: { AuthorizationCode: 60, AccessToken: 60, IdToken: 120, Interaction: 600, Session: 600, Grant: 600 },
    routes: { authorization: AUTHORIZE_PATH },
    interactions: { url: () => SINGPASS_CALLBACK_PATH },
    async findAccount(ctx, accountId) {
      const clientId = ctx.oidc.client?.clientId;
      if (!clientId || !active.has(clientId) || !accountId.startsWith(`${clientId}:`)) return undefined;
      return { accountId, claims: () => ({ sub: accountId }) };
    },
    renderError(ctx, out) {
      ctx.set("Cache-Control", "no-store");
      ctx.set("Referrer-Policy", "no-referrer");
      ctx.body = typeof out.error === "string" ? `Sign-in error: ${out.error}` : "Sign-in error.";
    },
  });
  provider.proxy = origin.protocol === "https:";
  // Koa appends user middleware after the provider router. These two service endpoints run before
  // the OIDC router so they can handle the upstream response within the interaction cookie's path.
  provider.middleware.unshift(async (ctx, next) => {
    ctx.set("Referrer-Policy", "no-referrer");
    if (ctx.path === "/health" && ctx.method === "GET") {
      ctx.body = { ok: true };
      return;
    }
    if (ctx.host !== origin.host || ctx.protocol !== origin.protocol.slice(0, -1)) {
      ctx.status = 400;
      ctx.body = "Invalid login service address.";
      return;
    }
    if (
      ctx.path === AUTHORIZE_PATH &&
      (ctx.method !== "GET" || ctx.query.prompt !== "login" || ctx.query.scope !== "openid")
    ) {
      ctx.status = 400;
      ctx.body = "Invalid hosted sign-in request.";
      return;
    }
    if (ctx.path === "/singpass/jwks.json" && ctx.method === "GET") {
      ctx.body = { keys: options.singpassKeys.keys.map(publicOnly) };
      return;
    }
    if (ctx.path !== SINGPASS_CALLBACK_PATH || ctx.method !== "GET") return next();
    ctx.set("Cache-Control", "no-store");
    await handleSingpass(ctx as KoaContextWithOIDC);
  });

  async function handleSingpass(ctx: KoaContextWithOIDC) {
    const params = new URL(ctx.originalUrl, issuer).searchParams;
    const isCallback = params.has("state") || params.has("code") || params.has("error");
    const state = params.get("state");
    let client: string | undefined;
    try {
      const interaction = await provider.interactionDetails(ctx.req, ctx.res);
      const instance = interaction.params.client_id;
      if (typeof instance !== "string" || !active.has(instance) || interaction.prompt.name !== "login") {
        throw new errors.AccessDenied();
      }
      client = instance;
      if (!isCallback) {
        const config = await options.upstream();
        const state = oidc.randomState();
        const verifier = oidc.randomPKCECodeVerifier();
        const nonce = oidc.randomNonce();
        const { keys, handle } = await createDpopProof(config);
        const redirect = await oidc.buildAuthorizationUrlWithPAR(
          config,
          {
            redirect_uri: callback,
            scope: PRESETS.singpass.scopes,
            response_type: "code",
            response_mode: "query",
            state,
            nonce,
            code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
            code_challenge_method: "S256",
            ...PRESETS.singpass.authParams,
          },
          { DPoP: handle },
        );
        const proof: AttemptProof = { verifier, nonce, keys };
        const sealed = await secretBox.encrypt(SECRET_PURPOSES.oidcTransaction, JSON.stringify(proof));
        await storage.saveAttempt({ state, client, interaction: interaction.uid, sealed });
        ctx.redirect(redirect.href);
        return;
      }
      if (!state || state.length > MAX_STATE_LENGTH || params.getAll("state").length !== 1)
        throw new errors.AccessDenied();
      const sealed = await storage.takeAttempt({ state, client, interaction: interaction.uid });
      if (!sealed) throw new errors.AccessDenied();
      const config = await options.upstream();
      const proof = JSON.parse(await secretBox.decrypt(SECRET_PURPOSES.oidcTransaction, sealed)) as AttemptProof;
      const incoming = new URL(callback);
      incoming.search = params.toString();
      const response = await oidc.authorizationCodeGrant(
        config,
        incoming,
        {
          expectedState: state,
          expectedNonce: proof.nonce,
          pkceCodeVerifier: proof.verifier,
          idTokenExpected: true,
        },
        undefined,
        { DPoP: await restoreDpopProof(config, proof.keys) },
      );
      const claims = response.claims();
      if (!claims?.sub || !claims.iss) throw new errors.AccessDenied();
      const accountId = subjectFor(options.subjectKey, client, claims.iss, claims.sub);
      const grant = new provider.Grant({ accountId, clientId: client });
      grant.addOIDCScope("openid");
      const grantId = await grant.save();
      await provider.interactionFinished(
        ctx.req,
        ctx.res,
        {
          login: { accountId, remember: false },
          consent: { grantId },
        },
        { mergeWithLastSubmission: false },
      );
      ctx.respond = false;
      audit({ client, outcome: "success" });
    } catch {
      // Upstream errors can contain callback URLs or provider data. Log only the outcome and client.
      if (client) audit({ client, outcome: "failure" });
      if (ctx.res.headersSent) return;
      ctx.status = 400;
      ctx.body = "Singpass sign-in could not be completed. Return to your company's sign-in page to try again.";
    }
  }
  return provider;
}
