import type { Translate } from "../i18n/index.ts";
import type { ProviderKind } from "./types.ts";

export function providerSignInLabel(kind: ProviderKind, displayName: string, t: Translate): string | undefined {
  switch (kind) {
    case "google":
      return t("Sign in with Google");
    case "entra":
      return t("Sign in with Microsoft");
    case "oidc":
      return t("Sign in with {provider}", { provider: displayName });
    case "singpass":
      return undefined;
  }
}
