import * as oidc from "openid-client";
import { SECRET_PURPOSES } from "../../crypto/secret-box.ts";
import type { SsoProvider } from "../../db/schema/auth.ts";
import type { AppDeps } from "../../deps.ts";
import { importDecryptionKey, importSigningKey } from "./keys.ts";
import { PRESETS } from "./presets.ts";

/** The fixed callback URL of a provider (design decision 9). Register this at the IdP. */
export function callbackUrl(publicUrl: string, providerId: string): string {
  return `${publicUrl.replace(/\/$/, "")}/api/v1/auth/oidc/${providerId}/callback`;
}

export function jwksUrl(publicUrl: string, providerId: string): string {
  return `${publicUrl.replace(/\/$/, "")}/api/v1/auth/oidc/${providerId}/jwks.json`;
}

function fetchOptions(deps: Pick<AppDeps, "httpFetch">, issuer: string) {
  const execute = new URL(issuer).protocol === "http:" ? [oidc.allowInsecureRequests] : [];
  return {
    ...(deps.httpFetch
      ? {
          [oidc.customFetch]: ((url: string, init: RequestInit) =>
            (deps.httpFetch as typeof fetch)(url, init)) as oidc.CustomFetch,
        }
      : {}),
    execute,
  };
}

/** Fetches the discovery document and checks its issuer. Used when saving a provider. */
export async function discover(
  deps: Pick<AppDeps, "httpFetch">,
  issuer: string,
  clientId: string,
): Promise<oidc.Configuration> {
  return oidc.discovery(new URL(issuer), clientId, undefined, oidc.None(), fetchOptions(deps, issuer));
}

const cache = new Map<string, { at: number; config: oidc.Configuration }>();
const CACHE_MS = 60 * 60_000;

/** A ready openid-client Configuration for a saved provider (discovery cached for an hour). */
export async function providerConfig(deps: AppDeps, provider: SsoProvider): Promise<oidc.Configuration> {
  const key = `${provider.id}:${provider.updatedAt.getTime()}`;
  const hit = cache.get(key);
  const now = deps.clock.now().getTime();
  if (hit && now - hit.at < CACHE_MS) return hit.config;

  const preset = PRESETS[provider.kind];
  let auth: oidc.ClientAuth;
  const metadata: Partial<oidc.ClientMetadata> = {};
  let privateJwks: { keys: JsonWebKey[] } | null = null;
  if (preset.privateKeyJwt) {
    if (!provider.privateJwksEnc) throw new Error("Provider has no relying-party keys.");
    privateJwks = JSON.parse(await deps.secretBox.decrypt(SECRET_PURPOSES.ssoPrivateJwks, provider.privateJwksEnc));
    const { key, kid } = await importSigningKey(privateJwks as { keys: JsonWebKey[] });
    auth = oidc.PrivateKeyJwt(key, {
      [oidc.modifyAssertion]: (header: Record<string, unknown>) => {
        header.kid = kid;
      },
    });
    metadata.token_endpoint_auth_method = "private_key_jwt";
  } else {
    if (!provider.clientSecretEnc) throw new Error("Provider has no client secret.");
    const secret = await deps.secretBox.decrypt(SECRET_PURPOSES.ssoClientSecret, provider.clientSecretEnc);
    auth = oidc.ClientSecretPost(secret);
  }
  if (preset.idTokenEncrypted) {
    metadata.id_token_encrypted_response_alg = "ECDH-ES+A256KW";
    metadata.id_token_encrypted_response_enc = "A256CBC-HS512";
  }
  const config = await oidc.discovery(
    new URL(provider.issuer),
    provider.clientId,
    metadata,
    auth,
    fetchOptions(deps, provider.issuer),
  );
  // openid-client trusts TLS for ID tokens from the token endpoint by default; the spec requires
  // the signature itself to be verified against the IdP's JWKS.
  oidc.enableNonRepudiationChecks(config);
  if (preset.idTokenEncrypted && privateJwks) {
    const dec = await importDecryptionKey(privateJwks);
    if (dec)
      oidc.enableDecryptingResponses(config, ["A256CBC-HS512", "A256GCM", "A128CBC-HS256"], {
        key: dec.key,
        kid: dec.kid,
        alg: dec.alg,
      });
  }
  cache.set(key, { at: now, config });
  return config;
}
