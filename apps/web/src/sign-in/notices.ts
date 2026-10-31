/** Messages for `?error=` and `?reason=` on the sign-in URL. */
export interface SignInNotice {
  tone: "info" | "danger" | "warning";
  title: string;
  body: string;
}

export function noticeFor(
  search: { error?: string; reason?: string; provider?: string; reset?: string },
  orgName: string,
): SignInNotice | null {
  if (search.reason === "expired")
    return {
      tone: "info",
      title: "Signed out",
      body: "You were signed out after a period of inactivity. Sign in again to continue.",
    };
  if (search.reason === "revoked")
    return {
      tone: "info",
      title: "Signed out",
      body: "This session was signed out, for example from another device or by an administrator. Sign in again.",
    };
  if (search.reason === "signed_out") return { tone: "info", title: "Signed out", body: "You have signed out." };
  if (search.reset === "done")
    return {
      tone: "info",
      title: "Password changed",
      body: "Your password was changed and you were signed out everywhere. Sign in with your new password.",
    };
  if (search.error === "not_provisioned") {
    return {
      tone: "warning",
      title: "Account not set up",
      body: `Your account has not been set up in ${orgName}. Ask your HR team for an invitation.`,
    };
  }
  if (search.error === "invitation_invalid")
    return {
      tone: "warning",
      title: "Invitation not valid",
      body: "This invitation has expired or was already used. Ask your HR team to resend it.",
    };
  if (search.error) {
    return {
      tone: "danger",
      title: "Sign-in failed",
      body: `Sign-in with ${search.provider ?? "single sign-on"} failed. Try again, or use another sign-in method.`,
    };
  }
  return null;
}
