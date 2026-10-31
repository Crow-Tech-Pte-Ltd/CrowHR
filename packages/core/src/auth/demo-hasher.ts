import { fromBase64Url, timingSafeEqual, toBase64Url, utf8 } from "../crypto/encoding.ts";
import { randomBytes } from "../crypto/tokens.ts";
import type { PasswordHasher } from "../deps.ts";

/**
 * Browser-demo password hasher (design decision 12): PBKDF2-SHA-256 on Web Crypto, 10 000
 * iterations, `$demo-pbkdf2$<iterations>$<salt>$<hash>`. The low cost is acceptable only because
 * demo data is fictional and never leaves the browser. The production argon2id hasher refuses
 * this format, so a demo hash can never authenticate on a server.
 *
 * Lives in core (runtime-agnostic) so packages/demo can inject it; never inject it in apps/server.
 */
export const DEMO_HASH_PREFIX = "$demo-pbkdf2$";
const ITERATIONS = 10_000;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", utf8.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export function createDemoPasswordHasher(): PasswordHasher {
  return {
    async hash(plain) {
      const salt = randomBytes(16);
      return `${DEMO_HASH_PREFIX}${ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(await derive(plain, salt, ITERATIONS))}`;
    },
    async verify(hash, plain) {
      if (!hash.startsWith(DEMO_HASH_PREFIX)) return false;
      const [iter, salt, expected] = hash.slice(DEMO_HASH_PREFIX.length).split("$");
      const iterations = Number(iter);
      if (!salt || !expected || !Number.isInteger(iterations) || iterations < 1000) return false;
      try {
        return timingSafeEqual(toBase64Url(await derive(plain, fromBase64Url(salt), iterations)), expected);
      } catch {
        return false;
      }
    },
    needsRehash: () => false,
  };
}
