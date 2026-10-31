import { describe, expect, it } from "vitest";
import { RECEIPT_BYTES } from "../../testing/claims.ts";
import { looksPolyglot, safeDisplayName, sha256Hex, sniffType } from "./sniff.ts";

const enc = (s: string) => new TextEncoder().encode(s);

describe("sniffType (by signature, never by extension)", () => {
  it("accepts PDF, JPEG, PNG, WebP and HEIC", () => {
    expect(sniffType(RECEIPT_BYTES.pdf)).toBe("application/pdf");
    expect(sniffType(RECEIPT_BYTES.jpeg)).toBe("image/jpeg");
    expect(sniffType(RECEIPT_BYTES.png)).toBe("image/png");
    expect(sniffType(RECEIPT_BYTES.webp)).toBe("image/webp");
    expect(sniffType(RECEIPT_BYTES.heic)).toBe("image/heic");
    const mif1 = RECEIPT_BYTES.heic.slice();
    mif1.set(enc("mif1"), 8);
    expect(sniffType(mif1)).toBe("image/heic");
  });

  it("rejects executables, archives, HTML, SVG, GIF and empty input", () => {
    expect(sniffType(enc("MZ\x90\x00\x03\x00\x00\x00This program cannot be run in DOS mode"))).toBeNull();
    expect(sniffType(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]))).toBeNull(); // ELF
    expect(sniffType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 20, 0]))).toBeNull(); // ZIP
    expect(sniffType(enc("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(sniffType(enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffType(enc("GIF89a"))).toBeNull();
    expect(sniffType(new Uint8Array())).toBeNull();
    // A signature later in the file does not count.
    expect(sniffType(enc("MZ....%PDF-1.7"))).toBeNull();
    // ftyp with a video brand is not HEIC.
    const mp4 = RECEIPT_BYTES.heic.slice();
    mp4.set(enc("isom"), 8);
    expect(sniffType(mp4)).toBeNull();
  });

  it("flags polyglots: script/HTML markers up front or a ZIP directory at the end", () => {
    const gifar = new Uint8Array([
      ...RECEIPT_BYTES.jpeg,
      ...enc("PK\x03\x04payload"),
      ...enc("PK\x05\x06"),
      ...new Uint8Array(18),
    ]);
    expect(looksPolyglot(gifar)).toBe(true);
    const htmlJpeg = new Uint8Array([...RECEIPT_BYTES.jpeg, ...enc("<html><script>alert(document.cookie)</script>")]);
    expect(looksPolyglot(htmlJpeg)).toBe(true);
    const pdfJs = new Uint8Array([...RECEIPT_BYTES.pdf, ...enc("<script>x</script>")]);
    expect(looksPolyglot(pdfJs)).toBe(true);
    expect(looksPolyglot(RECEIPT_BYTES.png)).toBe(false);
    expect(looksPolyglot(RECEIPT_BYTES.pdf)).toBe(false);
  });

  it("display names keep the last path segment only, with the detected extension", () => {
    expect(safeDisplayName("../../etc/passwd", "image/png")).toBe("passwd.png");
    expect(safeDisplayName("..\\..\\windows\\system32\\evil.exe", "application/pdf")).toBe("evil.pdf");
    expect(safeDisplayName("receipt.pdf", "image/jpeg")).toBe("receipt.jpg");
    expect(safeDisplayName('a"b\r\nc;d.png', "image/png")).toBe("a_b_c_d.png");
    expect(safeDisplayName("", "image/webp")).toBe("receipt.webp");
    expect(safeDisplayName("....", "image/png")).toBe("receipt.png");
    expect(safeDisplayName("x".repeat(300), "image/png")).toHaveLength(94);
  });

  it("hashes with SHA-256", async () => {
    expect(await sha256Hex(enc("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
