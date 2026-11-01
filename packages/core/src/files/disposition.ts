/** RFC 6266 / RFC 5987: ASCII fallback plus a UTF-8 filename, never raw user text in a header. */
export function contentDisposition(name: string, inline = false): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: explicitly reject unsafe control characters.
  const safe = name.replace(/[\uD800-\uDFFF]/gu, "_").replace(/[\u0000-\u001f\u007f"\\/]/g, "_");
  const fallback = safe.replace(/[^\x20-\x7e]/g, "_") || "download";
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
