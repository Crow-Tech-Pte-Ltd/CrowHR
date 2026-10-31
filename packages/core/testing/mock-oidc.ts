import { Hono } from "hono";
import * as jose from "jose";

/**
 * In-process OpenID provider for tests (no network). Implements discovery, JWKS, the
 * authorization code flow with PKCE S256, and optionally the Singpass FAPI 2.0 features:
 * pushed authorization requests (required), private_key_jwt client authentication verified
 * against the RP's JWKS, DPoP-bound tokens (proof checked, `dpop_jkt` binding), and ID tokens
 * encrypted to the RP's encryption key.
 *
 * Wire it into core with `createTestDeps(db, { httpFetch: idp.fetch })`. Before driving the
 * browser leg, set `idp.nextUser` to the claims the "user" signs in with.
 */
export interface MockIdpOptions {
  issuer: string;
  clientId: string;
  /** Required for client_secret_post; omit when privateKeyJwt. */
  clientSecret?: string;
  par?: boolean;
  dpop?: boolean;
  privateKeyJwt?: boolean;
  encryptIdToken?: boolean;
  /** The RP's public JWKS (for private_key_jwt and ID-token encryption). */
  rpJwks?: () => Promise<{ keys: jose.JWK[] }>;
}

export interface MockLogin {
  sub: string;
  email?: string;
  email_verified?: boolean;
  hd?: string;
  tid?: string;
  name?: string;
}

interface CodeRecord {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  nonce: string;
  dpopJkt?: string;
  user: MockLogin;
}

export interface MockIdp {
  app: Hono;
  fetch: typeof fetch;
  nextUser: MockLogin;
  /** Tamper switches for negative tests. */
  tamper: {
    badSignature?: boolean;
    wrongAudience?: boolean;
    wrongNonce?: boolean;
    expired?: boolean;
    wrongIssuer?: boolean;
  };
  /** What the IdP saw, for assertions. */
  seen: {
    parRequests: number;
    tokenRequests: { dpop: boolean; clientAuth: string }[];
    authorizeParams: Record<string, string>[];
  };
  /** Follow the IdP's authorize redirect (simulating the user's browser at the IdP). Returns the callback URL. */
  login(authorizeUrl: string): Promise<URL>;
}

function form(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body));
}

export async function createMockIdp(options: MockIdpOptions): Promise<MockIdp> {
  const issuer = options.issuer.replace(/\/$/, "");
  const base = new URL(issuer);
  const prefix = base.pathname.replace(/\/$/, "");
  const signing = await jose.generateKeyPair("RS256", { extractable: true });
  const rogue = await jose.generateKeyPair("RS256", { extractable: true });
  const kid = "mock-sig-1";
  const publicJwk = { ...(await jose.exportJWK(signing.publicKey)), kid, alg: "RS256", use: "sig" };
  const endpoint = (p: string) => `${issuer}${p}`;
  const codes = new Map<string, CodeRecord>();
  const pars = new Map<string, Record<string, string> & { dpopJkt?: string }>();

  const idp: MockIdp = {
    app: new Hono(),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (new URL(url).origin !== base.origin) throw new TypeError(`mock IdP: no network access to ${url}`);
      return idp.app.request(url, init);
    }) as typeof fetch,
    nextUser: { sub: "user-1", email: "user@example.sg", email_verified: true },
    tamper: {},
    seen: { parRequests: 0, tokenRequests: [], authorizeParams: [] },
    async login(authorizeUrl) {
      const res = await idp.app.request(authorizeUrl);
      const location = res.headers.get("location");
      if (res.status !== 302 || !location)
        throw new Error(`mock IdP authorize failed: ${res.status} ${await res.text()}`);
      return new URL(location);
    },
  };

  async function verifyClient(params: Record<string, string>): Promise<string> {
    if (options.privateKeyJwt) {
      if (
        params.client_assertion_type !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer" ||
        !params.client_assertion
      ) {
        throw new Error("private_key_jwt required");
      }
      const jwks = jose.createLocalJWKSet((await options.rpJwks?.()) ?? { keys: [] });
      const { payload } = await jose.jwtVerify(params.client_assertion, jwks, {
        issuer: options.clientId,
        subject: options.clientId,
      });
      const aud = ([] as string[]).concat(payload.aud ?? []);
      if (!aud.some((a) => a === issuer || a.startsWith(issuer))) throw new Error(`bad assertion audience ${aud}`);
      return "private_key_jwt";
    }
    if (params.client_id !== options.clientId || params.client_secret !== options.clientSecret)
      throw new Error("bad client secret");
    return "client_secret_post";
  }

  async function verifyDpop(header: string | undefined, method: string, url: string): Promise<string | undefined> {
    if (!header) return undefined;
    const { payload, protectedHeader } = await jose.jwtVerify(header, jose.EmbeddedJWK, { typ: "dpop+jwt" });
    if (payload.htm !== method || payload.htu !== url) throw new Error("DPoP htm/htu mismatch");
    return jose.calculateJwkThumbprint(protectedHeader.jwk as jose.JWK);
  }

  const app = idp.app;
  app.get(`${prefix}/.well-known/openid-configuration`, (c) =>
    c.json({
      issuer: idp.tamper.wrongIssuer ? `${issuer}/other` : issuer,
      authorization_endpoint: endpoint("/authorize"),
      token_endpoint: endpoint("/token"),
      jwks_uri: endpoint("/jwks"),
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: [options.privateKeyJwt ? "private_key_jwt" : "client_secret_post"],
      ...(options.par
        ? { pushed_authorization_request_endpoint: endpoint("/par"), require_pushed_authorization_requests: true }
        : {}),
      ...(options.dpop ? { dpop_signing_alg_values_supported: ["ES256"] } : {}),
      ...(options.encryptIdToken
        ? {
            id_token_encryption_alg_values_supported: ["ECDH-ES+A256KW"],
            id_token_encryption_enc_values_supported: ["A256CBC-HS512"],
          }
        : {}),
    }),
  );
  app.get(`${prefix}/jwks`, (c) => c.json({ keys: [publicJwk] }));

  app.post(`${prefix}/par`, async (c) => {
    idp.seen.parRequests++;
    const params = form(await c.req.text());
    try {
      await verifyClient(params);
      const jkt = options.dpop ? await verifyDpop(c.req.header("dpop"), "POST", endpoint("/par")) : undefined;
      if (options.dpop && !jkt && !params.dpop_jkt) return c.json({ error: "invalid_dpop_proof" }, 400);
      const uri = `urn:mock:${crypto.randomUUID()}`;
      pars.set(uri, { ...params, ...(jkt || params.dpop_jkt ? { dpopJkt: jkt ?? params.dpop_jkt } : {}) });
      return c.json({ request_uri: uri, expires_in: 60 }, 201);
    } catch (err) {
      return c.json({ error: "invalid_client", error_description: String(err) }, 401);
    }
  });

  app.get(`${prefix}/authorize`, (c) => {
    let params = c.req.query() as Record<string, string> & { dpopJkt?: string };
    if (options.par) {
      const stored = params.request_uri ? pars.get(params.request_uri) : undefined;
      if (!stored) return c.json({ error: "invalid_request", error_description: "PAR required" }, 400);
      params = stored;
    }
    idp.seen.authorizeParams.push({ ...params });
    if (params.client_id !== options.clientId) return c.json({ error: "unauthorized_client" }, 400);
    if (params.code_challenge_method !== "S256" || !params.code_challenge)
      return c.json({ error: "invalid_request", error_description: "PKCE S256 required" }, 400);
    const code = crypto.randomUUID();
    codes.set(code, {
      clientId: params.client_id,
      redirectUri: params.redirect_uri as string,
      codeChallenge: params.code_challenge,
      nonce: params.nonce as string,
      ...(params.dpopJkt ? { dpopJkt: params.dpopJkt } : {}),
      user: { ...idp.nextUser },
    });
    const back = new URL(params.redirect_uri as string);
    back.searchParams.set("code", code);
    back.searchParams.set("state", params.state as string);
    back.searchParams.set("iss", issuer);
    return c.redirect(back.toString(), 302);
  });

  app.post(`${prefix}/token`, async (c) => {
    const params = form(await c.req.text());
    let clientAuth: string;
    try {
      clientAuth = await verifyClient(params);
    } catch (err) {
      return c.json({ error: "invalid_client", error_description: String(err) }, 401);
    }
    const record = codes.get(params.code ?? "");
    codes.delete(params.code ?? "");
    if (!record || record.redirectUri !== params.redirect_uri) return c.json({ error: "invalid_grant" }, 400);
    const expected = jose.base64url.encode(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(params.code_verifier ?? ""))),
    );
    if (expected !== record.codeChallenge)
      return c.json({ error: "invalid_grant", error_description: "PKCE mismatch" }, 400);
    let jkt: string | undefined;
    try {
      jkt = await verifyDpop(c.req.header("dpop"), "POST", endpoint("/token"));
    } catch (err) {
      return c.json({ error: "invalid_dpop_proof", error_description: String(err) }, 400);
    }
    if (options.dpop && (!jkt || (record.dpopJkt && record.dpopJkt !== jkt))) {
      return c.json({ error: "invalid_dpop_proof", error_description: "DPoP proof missing or not bound" }, 400);
    }
    idp.seen.tokenRequests.push({ dpop: !!jkt, clientAuth });
    const now = Math.floor(Date.now() / 1000);
    const { sub, ...claims } = record.user;
    let idToken = await new jose.SignJWT({ ...claims, nonce: idp.tamper.wrongNonce ? "not-the-nonce" : record.nonce })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(issuer)
      .setSubject(sub)
      .setAudience(idp.tamper.wrongAudience ? "someone-else" : record.clientId)
      .setIssuedAt(idp.tamper.expired ? now - 7200 : now)
      .setExpirationTime(idp.tamper.expired ? now - 3600 : now + 300)
      .sign(idp.tamper.badSignature ? rogue.privateKey : signing.privateKey);
    if (options.encryptIdToken) {
      const enc = ((await options.rpJwks?.())?.keys ?? []).find((k) => k.use === "enc");
      if (!enc) return c.json({ error: "server_error", error_description: "no RP encryption key" }, 500);
      idToken = await new jose.CompactEncrypt(new TextEncoder().encode(idToken))
        .setProtectedHeader({ alg: "ECDH-ES+A256KW", enc: "A256CBC-HS512", cty: "JWT", kid: enc.kid })
        .encrypt(await jose.importJWK(enc, "ECDH-ES+A256KW"));
    }
    return c.json({
      access_token: crypto.randomUUID(),
      token_type: jkt ? "DPoP" : "Bearer",
      expires_in: 300,
      id_token: idToken,
      scope: params.scope ?? "openid",
    });
  });

  return idp;
}
