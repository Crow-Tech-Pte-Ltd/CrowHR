import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createGunzip, createGzip } from "node:zlib";
import { Decrypter, Encrypter } from "age-encryption";
import tar from "tar-stream";

/**
 * Backup archive format (self-hosting design decision 6), version 1:
 *
 *   crowhr-backup-<UTC stamp>[-<label>].tar.gz[.age]
 *     manifest.json        app + schema version, created time, SHA-256 of every part
 *     db.dump              pg_dump --format=custom
 *     secrets/crowhr.key   CROWHR_SECRET_KEY (base64), unless excluded
 *     files/<path>         uploaded files, as stored
 *
 * With a passphrase the whole .tar.gz is encrypted with age (scrypt recipient), so it can
 * also be decrypted with the standard `age -d` tool. Everything streams; nothing large is
 * held in memory.
 */
export const ARCHIVE_FORMAT = "crowhr-backup";
export const ARCHIVE_FORMAT_VERSION = 1;
export const ARCHIVE_PATTERN = /^crowhr-backup-\d{8}T\d{6}Z(?:-[a-z0-9-]+)?\.tar\.gz(?:\.age)?$/;
const AGE_MAGIC = "age-encryption.org/v1";

export interface ManifestPart {
  path: string;
  size: number;
  sha256: string;
}

export interface Manifest {
  format: typeof ARCHIVE_FORMAT;
  formatVersion: number;
  appVersion: string;
  schema: { tag: string | null };
  createdAt: string;
  trigger: "manual" | "scheduled" | "pre_migrate";
  includesKey: boolean;
  database: ManifestPart;
  secrets: ManifestPart | null;
  files: ManifestPart[];
}

export class ArchiveError extends Error {
  override name = "ArchiveError";
}

async function sha256File(path: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
    size += (chunk as Buffer).length;
  }
  return { sha256: hash.digest("hex"), size };
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** Regular files under `root`, as POSIX relative paths. Symlinks and special files are skipped. */
export async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) out.push(relative(root, full).split(sep).join("/"));
    }
  };
  await walk(root);
  return out;
}

export interface WriteArchiveInput {
  outFile: string;
  dumpFile: string;
  filesDir: string;
  key: Uint8Array | null;
  passphrase: string | null;
  manifest: Omit<Manifest, "format" | "formatVersion" | "database" | "secrets" | "files" | "includesKey">;
}

/** Writes the archive to `<outFile>.partial`, then renames it into place. Returns the manifest. */
export async function writeArchive(input: WriteArchiveInput): Promise<Manifest> {
  const db = await sha256File(input.dumpFile);
  const keyText = input.key ? `${Buffer.from(input.key).toString("base64")}\n` : null;
  const fileList = await listFiles(input.filesDir);
  const files: ManifestPart[] = [];
  for (const rel of fileList) files.push({ path: `files/${rel}`, ...(await sha256File(join(input.filesDir, rel))) });
  const manifest: Manifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    ...input.manifest,
    includesKey: keyText !== null,
    database: { path: "db.dump", ...db },
    secrets: keyText ? { path: "secrets/crowhr.key", size: Buffer.byteLength(keyText), sha256: sha256(keyText) } : null,
    files,
  };

  const pack = tar.pack();
  const addBuffer = (name: string, data: string, mode = 0o600) =>
    new Promise<void>((resolve, reject) => {
      pack.entry({ name, mode, mtime: new Date(manifest.createdAt) }, data, (err) => (err ? reject(err) : resolve()));
    });
  const addFile = (name: string, path: string, size: number) =>
    new Promise<void>((resolve, reject) => {
      const entry = pack.entry({ name, size, mode: 0o600, mtime: new Date(manifest.createdAt) }, (err) =>
        err ? reject(err) : resolve(),
      );
      pipeline(createReadStream(path), entry).catch(reject);
    });
  const produce = (async () => {
    await addBuffer("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`, 0o644);
    await addFile("db.dump", input.dumpFile, db.size);
    if (keyText) await addBuffer("secrets/crowhr.key", keyText);
    for (const part of files) {
      await addFile(part.path, join(input.filesDir, part.path.slice("files/".length)), part.size);
    }
    pack.finalize();
  })();

  const partial = `${input.outFile}.partial`;
  await mkdir(dirname(input.outFile), { recursive: true });
  try {
    let stream: Readable = pack.pipe(createGzip({ level: 6 }));
    if (input.passphrase) {
      const e = new Encrypter();
      e.setPassphrase(input.passphrase);
      const encrypted = await e.encrypt(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>);
      stream = Readable.fromWeb(encrypted as unknown as WebReadableStream<Uint8Array>);
    }
    await Promise.all([pipeline(stream, createWriteStream(partial, { mode: 0o600 })), produce]);
    await rename(partial, input.outFile);
  } catch (err) {
    pack.destroy();
    await rm(partial, { force: true });
    throw err;
  }
  return manifest;
}

/** True when the file starts with the age header (encrypted archive). */
export async function isEncryptedArchive(path: string): Promise<boolean> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(AGE_MAGIC.length);
    await fh.read(buf, 0, buf.length, 0);
    return buf.toString("latin1") === AGE_MAGIC;
  } finally {
    await fh.close();
  }
}

export interface ExtractedArchive {
  manifest: Manifest;
  /** Staging directory holding db.dump and secrets/. */
  stagingDir: string;
  /** Where files/ was extracted (rename it over FILE_STORAGE_DIR). */
  filesDir: string;
  /** SHA-256 and size of every extracted part, keyed by archive path. */
  actual: Map<string, { sha256: string; size: number }>;
}

/** Archive paths we accept. Anything else (absolute, `..`, links, devices) aborts the restore. */
function safeEntryName(name: string): string | null {
  const n = posix.normalize(name.replace(/^\.\//, ""));
  if (n.startsWith("/") || n.startsWith("..") || n.includes("/../") || n.includes("\0")) return null;
  if (n === "manifest.json" || n === "db.dump" || n === "secrets/crowhr.key") return n;
  if (n.startsWith("files/") && n.length > "files/".length) return n;
  return null;
}

/**
 * Decrypts (when needed), decompresses and extracts an archive, hashing each part as it is
 * written. Touches nothing outside `stagingDir` and `filesStagingDir`.
 */
export async function extractArchive(
  archive: string,
  options: { passphrase: string | null; stagingDir: string; filesStagingDir: string },
): Promise<ExtractedArchive> {
  const encrypted = await isEncryptedArchive(archive);
  let source: Readable = createReadStream(archive);
  if (encrypted) {
    if (!options.passphrase) {
      throw new ArchiveError(
        "This backup is encrypted. Pass its passphrase with --passphrase-file <file> (or set BACKUP_PASSPHRASE).",
      );
    }
    const d = new Decrypter();
    d.addPassphrase(options.passphrase);
    try {
      const out = await d.decrypt(Readable.toWeb(source) as unknown as ReadableStream<Uint8Array>);
      source = Readable.fromWeb(out as unknown as WebReadableStream<Uint8Array>);
    } catch (err) {
      throw new ArchiveError(`Cannot decrypt the backup: ${(err as Error).message}. Check the passphrase.`);
    }
  }
  await mkdir(options.stagingDir, { recursive: true, mode: 0o700 });
  await mkdir(options.filesStagingDir, { recursive: true });
  const actual = new Map<string, { sha256: string; size: number }>();
  let manifestText: string | null = null;

  const extract = tar.extract();
  extract.on("entry", (header, stream, next) => {
    // When the outer pipeline fails, tar-stream destroys the current entry with the same
    // error; the outer pipeline already reports it, so the entry must not throw it again.
    stream.on("error", () => undefined);
    const fail = (message: string) => {
      stream.resume();
      extract.destroy(new ArchiveError(message));
    };
    if (header.type === "directory") {
      stream.resume();
      next();
      return;
    }
    const name = safeEntryName(header.name);
    if (header.type !== "file" || !name) {
      fail(
        `The backup contains an unexpected entry "${header.name}" (${header.type}). It is not a Crow HR backup or was tampered with.`,
      );
      return;
    }
    const target =
      name === "manifest.json"
        ? null
        : name.startsWith("files/")
          ? join(options.filesStagingDir, ...name.slice("files/".length).split("/"))
          : join(options.stagingDir, ...name.split("/"));
    const hash = createHash("sha256");
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        size += chunk.length;
        cb(null, chunk);
      },
    });
    const done = () => {
      actual.set(name, { sha256: hash.digest("hex"), size });
      next();
    };
    if (!target) {
      const chunks: Buffer[] = [];
      meter.on("data", (c: Buffer) => chunks.push(c));
      meter.on("end", () => {
        manifestText = Buffer.concat(chunks).toString("utf8");
        done();
      });
      stream.pipe(meter);
      return;
    }
    mkdir(dirname(target), { recursive: true })
      .then(() => pipeline(stream, meter, createWriteStream(target, { mode: 0o600 })))
      .then(done)
      .catch((err) => extract.destroy(err));
  });

  try {
    await pipeline(source, createGunzip(), extract);
  } catch (err) {
    if (err instanceof ArchiveError) throw err;
    throw new ArchiveError(
      `The backup archive is damaged and cannot be read (${(err as Error).message}). Nothing was changed. Use another backup file.`,
    );
  }
  if (!manifestText) throw new ArchiveError("The backup has no manifest.json. It is not a Crow HR backup.");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(manifestText) as Manifest;
  } catch {
    throw new ArchiveError("The backup's manifest.json is damaged. Use another backup file.");
  }
  if (manifest.format !== ARCHIVE_FORMAT || typeof manifest.formatVersion !== "number") {
    throw new ArchiveError("This file is not a Crow HR backup (unknown manifest format).");
  }
  if (manifest.formatVersion > ARCHIVE_FORMAT_VERSION) {
    throw new ArchiveError(
      `This backup uses archive format ${manifest.formatVersion}, made by Crow HR ${manifest.appVersion}. Restore it with that version or newer.`,
    );
  }
  return { manifest, stagingDir: options.stagingDir, filesDir: options.filesStagingDir, actual };
}

/** Compares every part against the manifest. Throws naming the first corrupt or missing part. */
export function verifyChecksums(extracted: ExtractedArchive): void {
  const { manifest, actual } = extracted;
  const expected: ManifestPart[] = [
    manifest.database,
    ...(manifest.secrets ? [manifest.secrets] : []),
    ...manifest.files,
  ];
  for (const part of expected) {
    const got = actual.get(part.path);
    if (!got) throw new ArchiveError(`The backup is incomplete: ${part.path} is missing. Nothing was changed.`);
    if (got.sha256 !== part.sha256 || got.size !== part.size) {
      throw new ArchiveError(`The backup is corrupt: ${part.path} does not match its checksum. Nothing was changed.`);
    }
  }
  const known = new Set(["manifest.json", ...expected.map((p) => p.path)]);
  for (const path of actual.keys()) {
    if (!known.has(path))
      throw new ArchiveError(`The backup contains ${path}, which its manifest does not list. Nothing was changed.`);
  }
}

export async function readKeyFromStaging(stagingDir: string): Promise<string | null> {
  try {
    return (await readFile(join(stagingDir, "secrets", "crowhr.key"), "utf8")).trim();
  } catch {
    return null;
  }
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}
