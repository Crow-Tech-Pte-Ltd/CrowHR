const KEY = "crowhr.assistantAuthorization";

export function rememberAssistantAuthorization(org: string, query: string) {
  if (query.length > 4096 || !query) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ org, query, startedAt: Date.now() }));
  } catch {
    // Private browsing can disable storage.
  }
}

export function takeAssistantAuthorization(org: string | null) {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { org?: string; query?: string; startedAt?: number };
    if (!entry.startedAt || Date.now() - entry.startedAt > 10 * 60_000) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    if (entry.org !== org || typeof entry.query !== "string" || entry.query.length > 4096) return null;
    sessionStorage.removeItem(KEY);
    return `/mcp/oauth/authorize?${new URLSearchParams(entry.query)}`;
  } catch {
    return null;
  }
}
