import { readFile } from "node:fs/promises";
import { decodeSecretKey, type ServerConfig } from "../config.ts";

/** The current key without generating one (backups, doctor). Null when there is none yet. */
export async function readExistingKey(
  config: Pick<ServerConfig, "CROWHR_SECRET_KEY" | "SECRET_KEY_FILE">,
): Promise<Uint8Array | null> {
  if (config.CROWHR_SECRET_KEY) return config.CROWHR_SECRET_KEY;
  try {
    return decodeSecretKey(await readFile(config.SECRET_KEY_FILE, "utf8"));
  } catch {
    return null;
  }
}
