import * as oidc from "openid-client";
import { importDecryptionKey, importSigningKey } from "./keys.ts";

export { generateRpKeys, publicOnly } from "./keys.ts";
export { PRESETS, SINGPASS_ISSUERS, singpassSubject } from "./presets.ts";

export interface DpopKeys {
  private: JsonWebKey;
  public: JsonWebKey;
}

export async function createDpopProof(configuration: oidc.Configuration) {
  const pair = await oidc.randomDPoPKeyPair("ES256", { extractable: true });
  return {
    keys: {
      private: await crypto.subtle.exportKey("jwk", pair.privateKey),
      public: await crypto.subtle.exportKey("jwk", pair.publicKey),
    },
    handle: oidc.getDPoPHandle(configuration, pair),
  };
}

export async function restoreDpopProof(configuration: oidc.Configuration, keys: DpopKeys) {
  const algorithm = { name: "ECDSA", namedCurve: "P-256" };
  const pair = {
    privateKey: await crypto.subtle.importKey("jwk", keys.private, algorithm, false, ["sign"]),
    publicKey: await crypto.subtle.importKey("jwk", keys.public, algorithm, true, ["verify"]),
  };
  return oidc.getDPoPHandle(configuration, pair);
}

export async function singpassConfiguration(
  issuer: string,
  clientId: string,
  keys: { keys: JsonWebKey[] },
  options?: Parameters<typeof oidc.discovery>[4],
): Promise<oidc.Configuration> {
  const { key, kid } = await importSigningKey(keys);
  const auth = oidc.PrivateKeyJwt(key, {
    [oidc.modifyAssertion]: (header: Record<string, unknown>) => {
      header.kid = kid;
      // Singpass requires an explicit typ header on client assertions.
      header.typ = "JWT";
    },
  });
  const configuration = await oidc.discovery(
    new URL(issuer),
    clientId,
    {
      token_endpoint_auth_method: "private_key_jwt",
      id_token_encrypted_response_alg: "ECDH-ES+A256KW",
      id_token_encrypted_response_enc: "A256CBC-HS512",
    },
    auth,
    options,
  );
  oidc.enableNonRepudiationChecks(configuration);
  const decryption = await importDecryptionKey(keys);
  if (decryption) {
    oidc.enableDecryptingResponses(configuration, ["A256CBC-HS512", "A256GCM", "A128CBC-HS256"], {
      key: decryption.key,
      kid: decryption.kid,
      alg: decryption.alg,
    });
  }
  return configuration;
}
