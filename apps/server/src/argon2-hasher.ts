import type { PasswordHasher } from "@crowhr/core";
import { hash, verify } from "@node-rs/argon2";

/**
 * argon2id with OWASP Password Storage Cheat Sheet parameters
 * (m=19 MiB, t=2, p=1): https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#argon2id
 * Output is a PHC string, so parameters can be raised later without breaking old hashes.
 */
export interface Argon2Options {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export const ARGON2ID_OPTIONS: Readonly<Argon2Options> = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

/** `Algorithm.Argon2id` from @node-rs/argon2 (an ambient const enum, so not importable here). */
const ARGON2ID = 2;

export function createArgon2Hasher(options: Partial<Argon2Options> = {}): PasswordHasher {
  const opts = { ...ARGON2ID_OPTIONS, ...options, algorithm: ARGON2ID };
  return {
    hash: (plain) => hash(plain, opts),
    verify: async (phc, plain) => {
      // Only argon2id: a demo (`$demo-pbkdf2$`) or any other hash can never authenticate here.
      if (!phc.startsWith("$argon2id$")) return false;
      try {
        return await verify(phc, plain);
      } catch {
        // Malformed hash string: treat as a failed verification, never as success.
        return false;
      }
    },
    needsRehash: (phc) => {
      const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(phc);
      if (!m) return true;
      const [, mem, time, par] = m.map(Number) as [number, number, number, number];
      return (
        mem < ARGON2ID_OPTIONS.memoryCost || time < ARGON2ID_OPTIONS.timeCost || par < ARGON2ID_OPTIONS.parallelism
      );
    },
  };
}
