/**
 * File type detection from content (add-claims design decision 3). The client's file name and
 * Content-Type are never trusted: a file is accepted only when its leading bytes carry the
 * signature of an accepted type, and it is then stored and served with the detected type.
 *
 * Accepted for receipts: PDF, JPEG, PNG, WebP and HEIC/HEIF (`ftyp` brands heic, heix, heim,
 * heis, hevc, hevx, mif1, msf1).
 *
 * Polyglots: a file that is valid as an image or PDF and also as something a browser or archive
 * tool would run is refused when it shows the usual markers: HTML/script/SVG/PHP text in the first
 * kilobyte, or a ZIP end-of-central-directory record near the end (JAR/GIFAR-style). Downloads are
 * served with the detected type, `X-Content-Type-Options: nosniff` and a sandbox CSP as well, so
 * this is defence in depth rather than the only barrier.
 */

export type SniffedType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "image/heic";

export const RECEIPT_TYPES: readonly SniffedType[] = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
];

export const EXTENSION_FOR: Record<SniffedType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let i = from; i < Math.min(to, bytes.length); i++) s += String.fromCharCode(bytes[i] as number);
  return s;
}

/** The accepted type the bytes are, by signature at offset 0; null for anything else. */
export function sniffType(bytes: Uint8Array): SniffedType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(bytes, 8, 12))) return "image/heic";
  return null;
}

const ACTIVE_MARKERS = /<\s*(script|html|svg|iframe|object|embed|body|\?php)\b|javascript:/i;

/** True when the file also looks like HTML/script or a ZIP archive (see the module comment). */
export function looksPolyglot(bytes: Uint8Array): boolean {
  if (ACTIVE_MARKERS.test(ascii(bytes, 0, 1024))) return true;
  // ZIP end of central directory: PK\x05\x06, within the last 64 KiB + 22 bytes.
  const from = Math.max(0, bytes.length - 65_557);
  for (let i = bytes.length - 22; i >= from; i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return true;
  }
  return false;
}

/**
 * A display name safe to show and to put in `Content-Disposition`: the last path segment only,
 * control and odd characters replaced, at most 100 characters, with the extension of the
 * detected type. Never used to build a storage key.
 */
export function safeDisplayName(raw: string | null | undefined, type: SniffedType): string {
  const last = (raw ?? "").split(/[\\/]/).pop() ?? "";
  const base = last
    .replace(/\.[^.]*$/, "")
    .replace(/[^A-Za-z0-9 _()-]+/g, "_")
    .replace(/^[_. ]+|[_. ]+$/g, "")
    .slice(0, 90);
  return `${base || "receipt"}.${EXTENSION_FOR[type]}`;
}

/** Lowercase hex SHA-256 via Web Crypto (runtime-agnostic). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
