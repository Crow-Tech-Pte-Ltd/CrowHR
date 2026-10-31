import { describe, expect, it } from "vitest";
import { createMockIdp } from "./mock-oidc.ts";

describe("mock OIDC provider", () => {
  it("serves discovery and JWKS at the issuer's path, and refuses other origins", async () => {
    const idp = await createMockIdp({ issuer: "https://idp.test/realms/acme", clientId: "c", clientSecret: "s" });
    const disco = (await (
      await idp.fetch("https://idp.test/realms/acme/.well-known/openid-configuration")
    ).json()) as Record<string, string>;
    expect(disco.issuer).toBe("https://idp.test/realms/acme");
    expect(disco.token_endpoint).toBe("https://idp.test/realms/acme/token");
    const jwks = (await (await idp.fetch(disco.jwks_uri as string)).json()) as { keys: { kid: string; d?: string }[] };
    expect(jwks.keys[0]?.kid).toBe("mock-sig-1");
    expect(jwks.keys[0]?.d).toBeUndefined();
    await expect(idp.fetch("https://elsewhere.test/")).rejects.toThrow("no network");
  });

  it("requires PKCE S256 at authorize and PAR when configured", async () => {
    const idp = await createMockIdp({ issuer: "https://idp.test", clientId: "c", clientSecret: "s" });
    const noPkce = await idp.app.request("https://idp.test/authorize?client_id=c&redirect_uri=https://rp/cb&state=x");
    expect(noPkce.status).toBe(400);
    const par = await createMockIdp({ issuer: "https://idp2.test", clientId: "c", clientSecret: "s", par: true });
    const direct = await par.app.request(
      "https://idp2.test/authorize?client_id=c&code_challenge=x&code_challenge_method=S256",
    );
    expect(direct.status).toBe(400);
  });

  it("redirects back with code, state and iss using the configured user claims", async () => {
    const idp = await createMockIdp({ issuer: "https://idp.test", clientId: "c", clientSecret: "s" });
    idp.nextUser = { sub: "abc", email: "a@b.sg" };
    const cb = await idp.login(
      "https://idp.test/authorize?client_id=c&redirect_uri=https://rp.test/cb&state=st&code_challenge=x&code_challenge_method=S256&nonce=n",
    );
    expect(cb.origin + cb.pathname).toBe("https://rp.test/cb");
    expect(cb.searchParams.get("state")).toBe("st");
    expect(cb.searchParams.get("iss")).toBe("https://idp.test");
    expect(cb.searchParams.get("code")).toBeTruthy();
  });
});
