import { type Translate, translate } from "../i18n/index.ts";

/** Messages for `?error=` and `?reason=` on the sign-in URL. */
export interface SignInNotice {
  tone: "info" | "danger" | "warning";
  title: string;
  body: string;
}

export function noticeFor(
  search: { error?: string; reason?: string; provider?: string; reset?: string; singpass?: string },
  orgName: string,
  t: Translate = (message, params) => translate("en-SG", "settings-account", message, params),
): SignInNotice | null {
  // Demo only: back from the Singpass round trip (`ok` shows the HR admin / Employee choice instead).
  if (search.singpass === "ok") return null;
  if (search.singpass === "failed")
    return {
      tone: "warning",
      title: t("Singpass login didn't finish"),
      body:
        search.reason === "busy"
          ? t(
              "The demo has had a lot of Singpass logins. Try again later, or pick someone below to look around without Singpass.",
            )
          : t("Try again, or pick someone below to look around without Singpass."),
    };
  if (search.reason === "expired")
    return {
      tone: "info",
      title: t("Signed out"),
      body: t("You were signed out after a period of inactivity. Sign in again to continue."),
    };
  if (search.reason === "revoked")
    return {
      tone: "info",
      title: t("Signed out"),
      body: t("This session was signed out, for example from another device or by an administrator. Sign in again."),
    };
  if (search.reason === "signed_out") return { tone: "info", title: t("Signed out"), body: t("You have signed out.") };
  if (search.reset === "done")
    return {
      tone: "info",
      title: t("Password changed"),
      body: t("Your password was changed and you were signed out everywhere. Sign in with your new password."),
    };
  if (search.error === "not_provisioned") {
    return {
      tone: "warning",
      title: t("Account not set up"),
      body: t("Your account has not been set up in {orgName}. Ask your HR team for an invitation.", { orgName }),
    };
  }
  if (search.error === "invitation_invalid")
    return {
      tone: "warning",
      title: t("Invitation not valid"),
      body: t("This invitation has expired or was already used. Ask your HR team to resend it."),
    };
  if (search.error) {
    return {
      tone: "danger",
      title: t("Sign-in failed"),
      body: t("Sign-in with {provider} failed. Try again, or use another sign-in method.", {
        provider: search.provider ?? t("single sign-on"),
      }),
    };
  }
  return null;
}
