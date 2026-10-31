import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { assertValidFileKey, type FileStore } from "@crowhr/core";

/**
 * FileStore on the local filesystem. Layout:
 *   <root>/blobs/<key>       file bytes
 *   <root>/meta/<key>.json   { contentType, size }
 * Keys are validated by core and re-checked here to stay inside <root>.
 */
export function createDiskFileStore(rootDir: string): FileStore {
  const root = resolve(rootDir);
  const inside = (base: string, key: string, suffix = "") => {
    assertValidFileKey(key);
    const full = resolve(join(root, base, key + suffix));
    if (!full.startsWith(join(root, base) + sep)) throw new Error("File key escapes the storage root.");
    return full;
  };

  return {
    async put(key, data, meta) {
      const blob = inside("blobs", key);
      const metaPath = inside("meta", key, ".json");
      await mkdir(dirname(blob), { recursive: true });
      await mkdir(dirname(metaPath), { recursive: true });
      await writeFile(blob, data);
      await writeFile(metaPath, JSON.stringify({ contentType: meta.contentType, size: data.byteLength }));
      return { key, contentType: meta.contentType, size: data.byteLength };
    },
    async get(key) {
      try {
        const [data, metaRaw] = await Promise.all([
          readFile(inside("blobs", key)),
          readFile(inside("meta", key, ".json"), "utf8"),
        ]);
        const meta = JSON.parse(metaRaw) as { contentType: string };
        return { key, contentType: meta.contentType, size: data.byteLength, data: new Uint8Array(data) };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async delete(key) {
      await rm(inside("blobs", key), { force: true });
      await rm(inside("meta", key, ".json"), { force: true });
    },
  };
}
