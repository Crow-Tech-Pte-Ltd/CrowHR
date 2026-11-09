import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "hono";

/**
 * The official Singpass logo for the Singpass button. Singpass's button specification requires it,
 * but its artwork is not licensed for an MIT repository, so the deployer puts the file they
 * downloaded from Singpass in `<DATA_DIR>/branding/` (see the Singpass setup guide).
 */
export const SINGPASS_LOGO_PATH = "/branding/singpass-logo";
const MAX_BYTES = 200 * 1024;
const TYPES = [
  ["singpass-logo.svg", "image/svg+xml"],
  ["singpass-logo.png", "image/png"],
] as const;

/** The logo file to serve, or null when there is none (or it is too large to be a logo). */
export function findSingpassLogo(brandingDir: string): { file: string; type: string } | null {
  for (const [name, type] of TYPES) {
    const file = join(brandingDir, name);
    try {
      const st = statSync(file);
      if (st.isFile() && st.size > 0 && st.size <= MAX_BYTES) return { file, type };
    } catch {
      // Not there: try the next name.
    }
  }
  return null;
}

/** Serves the logo as an image only: an SVG opened directly cannot run script (sandbox CSP). */
export function singpassLogoHandler(brandingDir: string) {
  return (c: Context) => {
    const logo = findSingpassLogo(brandingDir);
    if (!logo) return c.json({ error: { code: "not_found", message: "No Singpass logo on this server." } }, 404);
    return c.body(readFileSync(logo.file), 200, {
      "content-type": logo.type,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "public, max-age=3600",
    });
  };
}
