/**
 * These OAuth clients are public and use S256 PKCE. Registration sends codes exclusively to
 * provider-owned callbacks. ChatGPT may show a connector-specific callback during setup.
 */
export function assistantProvider(redirect: string): "ChatGPT" | "Claude" | null {
  if (redirect === "https://claude.ai/api/mcp/auth_callback") return "Claude";
  if (
    redirect === "https://chatgpt.com/connector_platform_oauth_redirect" ||
    /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,200}$/.test(redirect)
  )
    return "ChatGPT";
  return null;
}

export function assistantClientId(redirect: string) {
  return `crowhr-${btoa(redirect).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
}
