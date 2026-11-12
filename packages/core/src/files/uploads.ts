import { type AuditContext, recordAudit } from "../audit/audit.ts";
import { files } from "../db/schema/files.ts";
import type { Db } from "../db/types.ts";
import { assertDemoUploadQuota } from "../demo-companies/quota.ts";
import type { AppDeps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { contentDisposition } from "./disposition.ts";
import { fileScannerOf } from "./scanner.ts";
import {
  EXTENSION_FOR,
  inspectOoxml,
  isOoxml,
  looksPolyglot,
  type SniffedType,
  safeDisplayName,
  sha256Hex,
  sniffType,
} from "./sniff.ts";

/** Receipts and documents: 10 MB each (add-claims proposal "Receipts"). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const MB = (n: number) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;

/**
 * Reads a request body into memory, refusing more than `max` bytes as soon as the declared
 * length or the streamed bytes exceed it (so an oversized upload is never buffered whole).
 */
export async function readBodyLimited(request: Request, max = MAX_UPLOAD_BYTES): Promise<Uint8Array> {
  const tooLarge = () =>
    new AppError(
      "file_too_large",
      `This file is larger than ${MB(max)}. Upload a smaller photo or PDF (try a lower camera resolution).`,
      {
        maxBytes: max,
      },
    );
  const declared = Number(request.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > max) throw tooLarge();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export interface StoreFileInput {
  orgId: string;
  purpose: string;
  data: Uint8Array;
  fileName: string | null;
  ownerEmployeeId: string | null;
  uploadedByMembershipId: string;
  accept: readonly SniffedType[];
  /** Shown when the content is not an accepted type. */
  rejectMessage: string;
  audit: AuditContext;
  /** Defaults to MAX_UPLOAD_BYTES (10 MB); documents allow 20 MB. */
  maxBytes?: number;
}

export const MACRO_REJECT_MESSAGE = "Macro-enabled documents are not accepted. Save as .docx or PDF";

/**
 * Validates and stores an upload: size, signature (never the extension or the client's
 * Content-Type), polyglot markers; then writes the bytes under a key built only from IDs and
 * records the `files` row. Scanned later by the tick sweep when a scanner is configured.
 */
export async function storeFile(deps: AppDeps, input: StoreFileInput) {
  return storeFileWith(deps, input, (fn) => deps.db.transaction(fn));
}

/**
 * `storeFile` inside the caller's transaction (e.g. a letter generated in an approval callback).
 * If the transaction later rolls back, the bytes stay in storage without a row: harmless, and never
 * reachable, since files are only served through their row.
 */
export async function storeFileInTx(tx: Db, deps: AppDeps, input: StoreFileInput) {
  return storeFileWith(deps, input, (fn) => fn(tx));
}

async function storeFileWith(deps: AppDeps, input: StoreFileInput, run: <T>(fn: (tx: Db) => Promise<T>) => Promise<T>) {
  if (input.data.byteLength === 0) {
    throw new AppError("validation_failed", "The file is empty. Pick the photo or PDF again.");
  }
  const max = input.maxBytes ?? MAX_UPLOAD_BYTES;
  if (input.data.byteLength > max) {
    throw new AppError("file_too_large", `This file is larger than ${MB(max)}. Upload a smaller photo or PDF.`, {
      maxBytes: max,
    });
  }
  if (inspectOoxml(input.data) === "macro") {
    throw new AppError("unsupported_file_type", MACRO_REJECT_MESSAGE, { accepted: input.accept });
  }
  const type = sniffType(input.data);
  if (!type || !input.accept.includes(type) || looksPolyglot(input.data, { zipAllowed: isOoxml(type) })) {
    throw new AppError("unsupported_file_type", input.rejectMessage, { accepted: input.accept });
  }
  const id = deps.ids.newId();
  const storageKey = `org/${input.orgId}/files/${id}.${EXTENSION_FOR[type]}`;
  const sha256 = await sha256Hex(input.data);
  const scanStatus = fileScannerOf(deps) ? ("pending_scan" as const) : ("unscanned" as const);
  await deps.fileStore.put(storageKey, input.data, { contentType: type });
  try {
    return await run(async (tx) => {
      await assertDemoUploadQuota(deps, tx, input.orgId, input.data.byteLength);
      const [row] = await tx
        .insert(files)
        .values({
          id,
          orgId: input.orgId,
          purpose: input.purpose,
          sha256,
          mime: type,
          sizeBytes: input.data.byteLength,
          storageKey,
          originalName: safeDisplayName(input.fileName, type),
          scanStatus,
          ownerEmployeeId: input.ownerEmployeeId,
          uploadedByMembershipId: input.uploadedByMembershipId,
          createdAt: deps.clock.now(),
        })
        .returning();
      await recordAudit(tx, deps, input.audit, {
        action: "file.uploaded",
        targetType: "file",
        targetId: id,
        meta: { purpose: input.purpose, mime: type, sizeBytes: input.data.byteLength },
      });
      if (!row) throw new Error("file insert returned nothing");
      return row;
    });
  } catch (err) {
    // Don't leave orphaned bytes behind when the row could not be written.
    await deps.fileStore.delete(storageKey).catch(() => {});
    throw err;
  }
}

/** Response headers for serving a stored file safely. */
export function fileResponseHeaders(
  row: { mime: string; originalName: string; sizeBytes: number },
  opts: { inline: boolean },
) {
  return {
    "content-type": row.mime,
    "content-length": String(row.sizeBytes),
    "content-disposition": contentDisposition(row.originalName, opts.inline),
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    "cache-control": "private, no-store",
    "cross-origin-resource-policy": "same-origin",
  };
}
