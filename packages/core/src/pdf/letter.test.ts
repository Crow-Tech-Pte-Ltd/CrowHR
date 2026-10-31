import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { parseMarkdown, resolveFields } from "../documents/markdown.ts";
import { DEFAULT_KET_TEMPLATE } from "../documents/templates.ts";
import { renderLetterPdf } from "./letter.ts";

/** add-documents task 3.1: the letter renderer on the shared core PDF primitives. */
describe("letter PDF", () => {
  const input = () => {
    const { blocks } = parseMarkdown(DEFAULT_KET_TEMPLATE);
    return {
      title: "Key Employment Terms: Siti Rahmah",
      org: { name: "Kampong Kopi Pte. Ltd.", address: "10 Anson Road, #12-04, Singapore 079903", uen: "202600001K" },
      blocks: resolveFields(blocks, (id) =>
        id === "terms.main_duties" ? "Prepare coffee. ".repeat(80) : `Value of ${id}`,
      ),
      createdAt: new Date("2026-10-31T01:00:00Z"),
      author: "Tan Mei Ling",
    };
  };

  it("renders headings, tables, long paragraphs and page breaks over several A4 pages with embedded fonts", async () => {
    const bytes = await renderLetterPdf(input());
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(doc.getTitle()).toBe("Key Employment Terms: Siti Rahmah");
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("CrowHR-Ubuntu-Regular");
    expect(text).toContain("CrowHR-Ubuntu-Medium");
  });

  it("is byte-stable for the same input", async () => {
    const a = await renderLetterPdf(input());
    const b = await renderLetterPdf(input());
    const hash = async (x: Uint8Array) =>
      [...new Uint8Array(await crypto.subtle.digest("SHA-256", x as BufferSource))]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
    expect(await hash(a)).toBe(await hash(b));
  });
});
