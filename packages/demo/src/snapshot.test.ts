import { describe, expect, it, vi } from "vitest";
import { openWithSnapshot, readSnapshot } from "./snapshot.ts";

// Exercise the boundary the worker uses: persistent copies win; any snapshot failure must
// return a genuinely fresh database rather than leaving a half-restored one in place.
describe("snapshot fallback", () => {
  it("keeps an existing visitor database without downloading or overwriting it", async () => {
    const fetchSnapshot = vi.fn();
    const open = vi.fn(async () => "existing");
    const result = await openWithSnapshot({ exists: true, fetchSnapshot, open, validate: vi.fn(), discard: vi.fn() });
    expect(result).toEqual({ database: "existing", restored: false });
    expect(fetchSnapshot).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith();
  });

  it.each(["download", "restore", "version"])("falls back after a %s failure", async (failure) => {
    const blob = new Blob(["snapshot"]);
    const discard = vi.fn(async () => {});
    const open = vi.fn(async (snapshot?: Blob) => {
      if (snapshot && failure === "restore") throw new Error("bad gzip");
      return snapshot ? "restored" : "fresh";
    });
    const result = await openWithSnapshot({
      exists: false,
      fetchSnapshot: async () => {
        if (failure === "download") throw new Error("404");
        return blob;
      },
      open,
      validate: async () => {
        if (failure === "version") throw new Error("wrong version");
      },
      discard,
    });
    expect(result).toEqual({ database: "fresh", restored: false });
    if (failure !== "download") expect(discard).toHaveBeenCalledOnce();
    expect(open).toHaveBeenLastCalledWith();
  });
});

it("rejects missing or corrupt downloads before touching the database", async () => {
  await expect(readSnapshot(new Response("missing", { status: 404 }))).rejects.toThrow(/download/);
  await expect(readSnapshot(new Response("broken gzip"))).rejects.toThrow();
});
