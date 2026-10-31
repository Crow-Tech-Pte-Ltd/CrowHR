import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidFileKeyError } from "@crowhr/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDiskFileStore } from "./disk-file-store.ts";

describe("disk file store", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "crowhr-files-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips bytes and content type", async () => {
    const store = createDiskFileStore(dir);
    await store.put("org/1/receipt.pdf", new Uint8Array([37, 80, 68, 70]), { contentType: "application/pdf" });
    const got = await store.get("org/1/receipt.pdf");
    expect(got).toMatchObject({ contentType: "application/pdf", size: 4 });
    expect(Array.from(got?.data ?? [])).toEqual([37, 80, 68, 70]);
    await store.delete("org/1/receipt.pdf");
    expect(await store.get("org/1/receipt.pdf")).toBeNull();
  });

  it("returns null for a missing file", async () => {
    expect(await createDiskFileStore(dir).get("nope.txt")).toBeNull();
  });

  it("refuses keys that would escape the root", async () => {
    const store = createDiskFileStore(dir);
    await expect(store.put("../escape.txt", new Uint8Array(), { contentType: "text/plain" })).rejects.toBeInstanceOf(
      InvalidFileKeyError,
    );
    expect(await readdir(dir)).toEqual([]);
  });
});
