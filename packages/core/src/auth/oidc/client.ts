import * as oidc from "openid-client";
import { SECRET_PURPOSES } from "../../crypto/secret-box.ts";
import type { SsoProvider } from "../../db/schema/auth.ts";
import type { AppDeps } from "../../deps.ts";
import { singpassConfiguration } from "./singpass.ts";

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

  const options = fetchOptions(deps, provider.issuer);
  let config: oidc.Configuration;
  if (provider.kind === "singpass") {
    if (!provider.privateJwksEnc) throw new Error("Provider has no relying-party keys.");
    const privateJwks = JSON.parse(
      await deps.secretBox.decrypt(SECRET_PURPOSES.ssoPrivateJwks, provider.privateJwksEnc),
    );
    config = await singpassConfiguration(provider.issuer, provider.clientId, privateJwks, options);
  } else {
    if (!provider.clientSecretEnc) throw new Error("Provider has no client secret.");
    const secret = await deps.secretBox.decrypt(SECRET_PURPOSES.ssoClientSecret, provider.clientSecretEnc);
    config = await oidc.discovery(
      new URL(provider.issuer),
      provider.clientId,
      undefined,
      oidc.ClientSecretPost(secret),
      options,
    );
    oidc.enableNonRepudiationChecks(config);
  }
  cache.set(key, { at: now, config });
  return config;
}
