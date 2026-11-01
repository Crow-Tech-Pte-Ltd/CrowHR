import { describe, expect, it } from "vitest";
import { contentDisposition } from "./disposition.ts";

describe("download filenames", () => {
  it("encodes Unicode and quotes with an ASCII fallback", () => {
    const h = contentDisposition('工资-ரவி-"x".pdf');
    expect(h).toMatch(/^[\x20-\x7e]+$/);
    expect(h).toContain("filename*=UTF-8''%E5%B7%A5%E8%B5%84-");
    expect(h).toContain('filename="__-___-_x_.pdf"');
  });
  it("does not allow header or path injection", () => {
    expect(contentDisposition("a\r\nX: y/../../z.pdf")).not.toMatch(/[\r\n]/);
    expect(contentDisposition("mc.pdf", true)).toMatch(/^inline;/);
  });
});
