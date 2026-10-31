import { describe, expect, it } from "vitest";
import { assertValidFileKey, InvalidFileKeyError } from "./file-store.ts";
import { createMemoryFileStore } from "./memory-file-store.ts";

describe("memory file store", () => {
  it("round-trips bytes and metadata", async () => {
    const store = createMemoryFileStore();
    const data = new TextEncoder().encode("payslip");
    const stored = await store.put("org/abc/payslip.pdf", data, { contentType: "application/pdf" });
    expect(stored).toEqual({ key: "org/abc/payslip.pdf", contentType: "application/pdf", size: 7 });
    const read = await store.get("org/abc/payslip.pdf");
    expect(new TextDecoder().decode(read?.data)).toBe("payslip");
    await store.delete("org/abc/payslip.pdf");
    expect(await store.get("org/abc/payslip.pdf")).toBeNull();
  });

  it("does not let callers mutate stored bytes", async () => {
    const store = createMemoryFileStore();
    const data = new Uint8Array([1, 2, 3]);
    await store.put("a.bin", data, { contentType: "application/octet-stream" });
    data[0] = 9;
    expect((await store.get("a.bin"))?.data[0]).toBe(1);
  });
});

describe("assertValidFileKey", () => {
  it.each(["../etc/passwd", "/abs", "a//b", "a/./b", "a/../b", "", "sp ace", "back\\slash"])("rejects %j", (key) => {
    expect(() => assertValidFileKey(key)).toThrow(InvalidFileKeyError);
  });

  it("accepts nested relative keys", () => {
    expect(() => assertValidFileKey("org/0192/claims/receipt-1.pdf")).not.toThrow();
  });
});
