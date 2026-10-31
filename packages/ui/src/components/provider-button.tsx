import { KeyRound } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn.ts";

/**
 * Sign-in buttons for external identity providers. Colours, wording and marks
 * follow each provider's published guidance:
 * - Google: https://developers.google.com/identity/branding-guidelines
 *   (light theme: #FFFFFF fill, #747775 1px stroke, #1F1F1F text, standard "G").
 * - Microsoft: https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-branding-in-apps
 *   (#FFFFFF fill, #8C8C8C 1px border, #5E5E5E text, four-square logo).
 * - Singpass: https://docs.developer.singpass.gov.sg/docs/getting-started/singpass-button-design-specification
 *   ("White with outline" variant: #FFFFFF, #AAABAD border, #141414 text, hover #F5F5F7;
 *   min height 40px desktop / 44px mobile; 16px side padding; approved label "Log in with Singpass").
 *
 * NOT COMPLIANT YET (Singpass): the specification requires the official
 * Singpass logo inside the button and forbids replacing it with text. The logo
 * is published without a licence that permits redistribution in an MIT repo,
 * so it is NOT bundled; the button renders the wordmark as text until a
 * deployer supplies the official asset via `singpassLogoSrc`. Do not go live
 * with Singpass without it. Tracked in docs/limitations.md.
 */
export type IdentityProvider = "google" | "microsoft" | "singpass" | "oidc";

export interface ProviderButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  provider: IdentityProvider;
  /** For generic OIDC: the organisation's display name for its IdP, e.g. "Okta". */
  oidcName?: string;
  /** URL of the official Singpass logo (white-background variant), supplied by the deployer. */
  singpassLogoSrc?: string;
}

const base =
  "focus-ring inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-md border px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed sm:h-10";

const STYLES: Record<IdentityProvider, string> = {
  google: "border-[#747775] bg-white text-[#1F1F1F] hover:bg-[#F8F8F8] disabled:opacity-60",
  microsoft: "border-[#8C8C8C] bg-white text-[#5E5E5E] hover:bg-[#F7F7F7] disabled:opacity-60",
  singpass:
    "border-[#AAABAD] bg-white text-[#141414] hover:bg-[#F5F5F7] disabled:text-[#AAABAD] disabled:hover:bg-white",
  oidc: "border-ink/20 bg-surface-50 text-ink hover:border-ink/40 hover:bg-surface-200/50 disabled:opacity-60",
};

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 21 21" className="size-[18px]" aria-hidden>
      <rect x="0" y="0" width="10" height="10" fill="#F25022" />
      <rect x="11" y="0" width="10" height="10" fill="#7FBA00" />
      <rect x="0" y="11" width="10" height="10" fill="#00A4EF" />
      <rect x="11" y="11" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}

export const ProviderButton = React.forwardRef<HTMLButtonElement, ProviderButtonProps>(
  ({ provider, oidcName, singpassLogoSrc, className, type = "button", ...props }, ref) => {
    let content: React.ReactNode;
    let accessibleName: string | undefined;
    switch (provider) {
      case "google":
        content = (
          <>
            <GoogleMark />
            <span>Sign in with Google</span>
          </>
        );
        break;
      case "microsoft":
        content = (
          <>
            <MicrosoftMark />
            <span>Sign in with Microsoft</span>
          </>
        );
        break;
      case "singpass":
        // Screen readers should say "Sing-pass", not spell it out (Singpass spec, Accessibility).
        accessibleName = "Log in with Sing-pass";
        content = (
          <span aria-hidden className="inline-flex items-center gap-1">
            <span>Log in with</span>
            {singpassLogoSrc ? (
              <img src={singpassLogoSrc} alt="" className="h-[14px] w-auto translate-y-px" />
            ) : (
              <span className="font-bold">
                <span className="text-[#D93841]">Sing</span>pass
              </span>
            )}
          </span>
        );
        break;
      case "oidc":
        content = (
          <>
            <KeyRound className="size-4" aria-hidden />
            <span>{oidcName ? `Sign in with ${oidcName}` : "Single sign-on (SSO)"}</span>
          </>
        );
        break;
    }
    return (
      <button
        ref={ref}
        type={type}
        aria-label={accessibleName}
        data-provider={provider}
        className={cn(base, STYLES[provider], className)}
        {...props}
      >
        {content}
      </button>
    );
  },
);
ProviderButton.displayName = "ProviderButton";
