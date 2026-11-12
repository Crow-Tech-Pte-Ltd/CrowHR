/**
 * The visitor's current demo company, kept in this browser so the try page shows it again until
 * it ends (demo-companies "Try page"). Only what the server answered to this visitor: the short
 * name is the key to their copy, so it never leaves the browser except to this server.
 */
export interface TryCompany {
  slug: string;
  name: string;
  server: string;
  connectUrl: string;
  signInUrl: string;
  expiresAt: string;
}

const KEY = "crowhr.tryCompany";

export function rememberTryCompany(company: TryCompany): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(company));
  } catch {
    // Storage unavailable (private mode): the page still shows it until it is closed.
  }
}

/** The remembered company while it is live; null (and forgotten) once it has ended. */
export function rememberedTryCompany(now = Date.now()): TryCompany | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TryCompany>;
    const valid =
      typeof parsed.slug === "string" &&
      typeof parsed.signInUrl === "string" &&
      typeof parsed.connectUrl === "string" &&
      typeof parsed.server === "string" &&
      typeof parsed.expiresAt === "string" &&
      Date.parse(parsed.expiresAt) > now;
    if (!valid) {
      localStorage.removeItem(KEY);
      return null;
    }
    return { name: "Kopi Kaki", ...parsed } as TryCompany;
  } catch {
    return null;
  }
}

export function forgetTryCompany(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to forget
  }
}
