import type { App } from "../src/app.ts";
import type { TestClient } from "./http.ts";
import type { MockIdp } from "./mock-oidc.ts";

/**
 * Drives one SSO round-trip: our start route → the mock IdP "login" → our callback.
 * Returns the callback response (a redirect into the app or back to the sign-in page).
 */
export async function ssoRoundTrip(
  http: TestClient,
  idp: MockIdp,
  providerId: string,
  query = "",
): Promise<{ start: Response; callback: Response; location: string }> {
  const start = await http.get(`/api/v1/auth/oidc/${providerId}/start${query}`);
  if (start.status !== 302) return { start, callback: start, location: "" };
  const callbackUrl = await idp.login(start.headers.get("location") as string);
  const callback = await http.get(`${callbackUrl.pathname}${callbackUrl.search}`);
  return { start, callback, location: callback.headers.get("location") ?? "" };
}

export type { App };
