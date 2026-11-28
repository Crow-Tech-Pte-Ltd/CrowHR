import { Button } from "@crowhr/ui";
import { FlaskConical } from "lucide-react";
import { AuthLayout } from "../auth/auth-layout.tsx";
import { formatDateTime } from "../auth/format.ts";
import { useT } from "../i18n/index.ts";
import { forgetTryCompany } from "./storage.ts";

/**
 * Demo companies (openspec add-demo-companies): what a visitor sees about the copy they are in.
 * The server enforces everything (guard rails, expiry); these only say so.
 */

/** On a demo company's sign-in page: it is fictional, private and ends at `expiresAt`. */
export function DemoCompanyNotice({ expiresAt }: { expiresAt: string }) {
  const t = useT("demo");
  return (
    <div
      className="mb-6 flex gap-3 rounded-md border border-border bg-surface-100/60 px-3 py-2.5"
      data-testid="demo-company-notice"
    >
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-primary-300" aria-hidden />
      <p className="text-2xs text-primary-300">
        <span className="font-azeret font-semibold text-ink">{t("Demo company")}</span>
        <span className="mx-1.5" aria-hidden>
          ·
        </span>
        {t("Fictional people and data, private to whoever has its code. Deleted with everything in it on {date}.", {
          date: formatDateTime(expiresAt),
        })}
      </p>
    </div>
  );
}

/** Inside the app, on every page of a demo company: a slim reminder with the end date. */
export function DemoCompanyBanner({ expiresAt }: { expiresAt: string }) {
  const t = useT("demo");
  return (
    <div
      className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-2xs text-primary-300"
      data-testid="demo-company-banner"
    >
      <span className="inline-flex items-center gap-1.5 font-azeret font-semibold text-ink">
        <FlaskConical className="size-3.5" aria-hidden />
        {t("Demo company")}
      </span>
      <span>
        {t("Fictional data, deleted on {date}. Sign-in, security and email settings can't be changed here.", {
          date: formatDateTime(expiresAt),
        })}
      </span>
      <a href="/try" className="focus-ring rounded-sm font-medium text-biru-400 underline-offset-2 hover:underline">
        {t("Open it on your phone")}
      </a>
    </div>
  );
}

/** The sign-in page of a demo company that has ended (or never existed): start a new one. */
export function DemoCompanyEndedPage({ message }: { message: string }) {
  const t = useT("demo");
  return (
    <AuthLayout title={t("This demo company has ended")} description={message}>
      <Button asChild variant="primary" className="self-start">
        <a href="/try" onClick={() => forgetTryCompany()}>
          {t("Start a new demo company")}
        </a>
      </Button>
    </AuthLayout>
  );
}
