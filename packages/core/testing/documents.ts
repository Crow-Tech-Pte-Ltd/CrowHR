import { concatBytes, zipStoreChunks } from "../src/export/zip.ts";
import type { TestClient } from "./http.ts";

/** Test fixtures for documents (Node-only): minimal files that pass (or fail) the sniffer. */
const enc = new TextEncoder();

export const PDF_BYTES = enc.encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n");

export function pdfBytes(seed: number): Uint8Array {
  return enc.encode(`%PDF-1.7\n% seed ${seed}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n`);
}

/** A minimal OOXML package: [Content_Types].xml plus the main part (and optionally a VBA project). */
export function ooxmlBytes(kind: "docx" | "xlsx", opts: { macro?: boolean } = {}): Uint8Array {
  const main = kind === "docx" ? "word/document.xml" : "xl/workbook.xml";
  const entries = [
    { name: "[Content_Types].xml", chunks: [enc.encode("<Types/>")] },
    { name: main, chunks: [enc.encode("<document/>")] },
    ...(opts.macro
      ? [{ name: kind === "docx" ? "word/vbaProject.bin" : "xl/vbaProject.bin", chunks: [enc.encode("VBA")] }]
      : []),
  ];
  return concatBytes(zipStoreChunks(entries));
}

export function uploadDoc(
  client: TestClient,
  bytes: Uint8Array,
  q: { employeeId: string; categoryId: string; title: string; expiresOn?: string; fileName?: string },
) {
  const params = new URLSearchParams({ ...q, fileName: q.fileName ?? "file.pdf" } as Record<string, string>);
  return client.request(`/api/v1/documents/upload?${params}`, {
    method: "POST",
    body: bytes as BodyInit,
    headers: { "content-type": "application/octet-stream" },
  });
}

export function replaceDoc(client: TestClient, id: string, bytes: Uint8Array, q: { expiresOn?: string } = {}) {
  const params = new URLSearchParams(q as Record<string, string>);
  return client.request(`/api/v1/documents/${id}/versions?${params}`, {
    method: "POST",
    body: bytes as BodyInit,
    headers: { "content-type": "application/octet-stream" },
  });
}
