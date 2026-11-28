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

interface CachedProvider {
  expiresAt: number;
  version: string;
  config: Promise<oidc.Configuration>;
}

const caches = new WeakMap<AppDeps, Map<string, CachedProvider>>();
const CACHE_MS = 60 * 60_000;
const MAX_PROVIDERS = 128;

export function pruneProviderConfigs(deps: AppDeps, now: number) {
  const cache = caches.get(deps);
  if (!cache) return;
  for (const [id, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(id);
  }
}

/** A ready openid-client Configuration for a saved provider (discovery cached for an hour). */
export async function providerConfig(deps: AppDeps, provider: SsoProvider): Promise<oidc.Configuration> {
  let cache = caches.get(deps);
  if (!cache) {
    cache = new Map();
    caches.set(deps, cache);
  }
  const now = deps.clock.now().getTime();
  const version = JSON.stringify([
    provider.updatedAt.getTime(),
    provider.kind,
    provider.issuer,
    provider.clientId,
    provider.clientSecretEnc,
    provider.privateJwksEnc,
  ]);
  const hit = cache.get(provider.id);
  cache.delete(provider.id);
  if (hit?.version === version && hit.expiresAt > now) {
    cache.set(provider.id, hit);
    return hit.config;
  }
  pruneProviderConfigs(deps, now);
  if (cache.size >= MAX_PROVIDERS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const entry = { version, expiresAt: now + CACHE_MS, config: discoverProvider(deps, provider) };
  cache.set(provider.id, entry);
  try {
    return await entry.config;
  } catch (error) {
    if (cache.get(provider.id) === entry) cache.delete(provider.id);
    throw error;
  }
}

async function discoverProvider(deps: AppDeps, provider: SsoProvider): Promise<oidc.Configuration> {
  const options = fetchOptions(deps, provider.issuer);
  if (provider.kind === "singpass") {
    if (!provider.privateJwksEnc) throw new Error("Provider has no relying-party keys.");
    const privateJwks = JSON.parse(
      await deps.secretBox.decrypt(SECRET_PURPOSES.ssoPrivateJwks, provider.privateJwksEnc),
    );
    return singpassConfiguration(provider.issuer, provider.clientId, privateJwks, options);
  }
  if (!provider.clientSecretEnc) throw new Error("Provider has no client secret.");
  const secret = await deps.secretBox.decrypt(SECRET_PURPOSES.ssoClientSecret, provider.clientSecretEnc);
  const config = await oidc.discovery(
    new URL(provider.issuer),
    provider.clientId,
    undefined,
    oidc.ClientSecretPost(secret),
    options,
  );
  oidc.enableNonRepudiationChecks(config);
  return config;
}
