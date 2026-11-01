/** The worker boundary for restoring a build snapshot without risking an existing visitor copy. */
export async function openWithSnapshot<T>(input: {
  exists: boolean;
  fetchSnapshot(): Promise<Blob>;
  open(snapshot?: Blob): Promise<T>;
  validate(database: T): Promise<void>;
  discard(): Promise<void>;
}): Promise<{ database: T; restored: boolean }> {
  if (!input.exists) {
    let attempted = false;
    try {
      const snapshot = await input.fetchSnapshot();
      attempted = true;
      const database = await input.open(snapshot);
      await input.validate(database);
      return { database, restored: true };
    } catch {
      // Includes missing downloads, invalid gzip/tar/Postgres data, and stale metadata.
      if (attempted) await input.discard();
    }
  }
  return { database: await input.open(), restored: false };
}

/** Decompress natively while downloading, and reject broken envelopes before opening IndexedDB. */
export async function readSnapshot(response: Response): Promise<Blob> {
  if (!response.ok || !response.body) throw new Error(`Snapshot download failed (${response.status})`);
  const body = response.headers.get("content-encoding")
    ? response.body
    : response.body.pipeThrough(new DecompressionStream("gzip"));
  const blob = await new Response(body).blob();
  const header = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
  if (new TextDecoder().decode(header.slice(257, 262)) !== "ustar") throw new Error("Invalid demo snapshot tar");
  return blob;
}
