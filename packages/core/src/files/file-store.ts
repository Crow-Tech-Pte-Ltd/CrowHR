/**
 * Blob storage for uploaded documents (payslips, pass copies, claim receipts).
 * Server: local disk. Browser demo: in-memory/IndexedDB. Future: S3-compatible.
 *
 * Keys are relative, slash-separated paths made of `[A-Za-z0-9._-]` segments,
 * e.g. `org/<orgId>/claims/<claimId>/receipt.pdf`. Validate with
 * `assertValidFileKey` before touching storage.
 */
export interface FileStore {
  put(key: string, data: Uint8Array, meta: { contentType: string }): Promise<StoredFile>;
  get(key: string): Promise<StoredFileWithData | null>;
  delete(key: string): Promise<void>;
}

export interface StoredFile {
  key: string;
  contentType: string;
  size: number;
}

export interface StoredFileWithData extends StoredFile {
  data: Uint8Array;
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;

export class InvalidFileKeyError extends Error {
  override name = "InvalidFileKeyError";
}

/** Rejects absolute paths, `..`/`.` segments, empty segments and odd characters. */
export function assertValidFileKey(key: string): void {
  if (key.length === 0 || key.length > 512) throw new InvalidFileKeyError("File key must be 1-512 characters.");
  for (const segment of key.split("/")) {
    if (segment === "" || segment === "." || segment === ".." || !SEGMENT.test(segment)) {
      throw new InvalidFileKeyError(`Invalid file key segment in "${key}".`);
    }
  }
}
