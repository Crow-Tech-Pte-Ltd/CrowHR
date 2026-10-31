import { and, eq, gt, isNull } from "drizzle-orm";
import type { AppContext, AuthMethod } from "../../context.ts";
import { newToken, sha256Hex } from "../../crypto/tokens.ts";
import { nativeAuthRequests } from "../../db/schema/auth.ts";
import { AppError } from "../../errors.ts";

export const NATIVE_CODE_TTL_MS = 60_000;
export const NATIVE_REQUEST_TTL_MS = 10 * 60_000;
/** Official app redirect URIs (api-platform design decision 3); finalised with add-mobile-apps. */
export const DEFAULT_NATIVE_REDIRECT_URIS = ["crowtech.crowhr:/oauth2redirect"] as const;

/**
 * Called by every sign-in method when a native authorisation is pending: instead of keeping a
 * browser session, issue a one-time code (60 s) and return the app redirect URL. No browser
 * session is created at all, which is stronger than the design's "create then revoke".
 */
export async function completeNativeSignIn(
  c: AppContext,
  input: { requestId: string; orgId: string; userId: string; membershipId: string; authMethod: AuthMethod },
): Promise<string> {
  const { db, clock } = c.var.deps;
  const now = clock.now();
  const code = newToken();
  const [request] = await db
    .update(nativeAuthRequests)
    .set({
      codeHash: await sha256Hex(code),
      codeExpiresAt: new Date(now.getTime() + NATIVE_CODE_TTL_MS),
      userId: input.userId,
      membershipId: input.membershipId,
      authMethod: input.authMethod,
    })
    .where(
      and(
        eq(nativeAuthRequests.id, input.requestId),
        eq(nativeAuthRequests.orgId, input.orgId),
        gt(nativeAuthRequests.expiresAt, now),
        isNull(nativeAuthRequests.codeHash),
      ),
    )
    .returning();
  if (!request) {
    throw new AppError(
      "validation_failed",
      "This app sign-in has expired. Go back to the Crow HR app and start again.",
    );
  }
  const url = new URL(request.redirectUri);
  url.searchParams.set("code", code);
  url.searchParams.set("state", request.state);
  return url.toString();
}
