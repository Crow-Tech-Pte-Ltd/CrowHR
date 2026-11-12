/**
 * Build-time: the try page of a Crow HR server with demo companies (VITE_TRY_URL, e.g.
 * `https://hr-demo.crow.sg/try`), where visitors get their own demo company for the mobile apps.
 * Unset: no link is shown (add-demo-companies design decision 10).
 */
export function tryUrl(): string | null {
  const url = import.meta.env.VITE_TRY_URL as string | undefined;
  return url && /^https?:\/\//.test(url) ? url : null;
}
