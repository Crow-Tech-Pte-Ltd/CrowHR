import { sha256Hex } from "../../crypto/tokens.ts";

/**
 * Canonical JSON: object keys sorted, `undefined` dropped, no whitespace. Two equal values give the
 * same string whatever order their keys were built in, so hashes are stable across runs and hosts.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
  return value;
}

export async function canonicalHash(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}
