import { assertValidFileKey, type FileStore, type StoredFileWithData } from "./file-store.ts";

/** In-memory FileStore. Used by tests and suitable for the browser demo. */
export function createMemoryFileStore(): FileStore {
  const files = new Map<string, StoredFileWithData>();
  return {
    async put(key, data, meta) {
      assertValidFileKey(key);
      const stored = { key, contentType: meta.contentType, size: data.byteLength, data: data.slice() };
      files.set(key, stored);
      return { key, contentType: stored.contentType, size: stored.size };
    },
    async get(key) {
      assertValidFileKey(key);
      const found = files.get(key);
      return found ? { ...found, data: found.data.slice() } : null;
    },
    async delete(key) {
      assertValidFileKey(key);
      files.delete(key);
    },
  };
}
