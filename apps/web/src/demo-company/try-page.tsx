import { Alert, AlertDescription, AlertTitle, Button, cn, Skeleton, textStyle } from "@crowhr/ui";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Smartphone } from "lucide-react";
import * as React from "react";
import { formatDateTime } from "../auth/format.ts";
import { CopyField } from "../components/copy-field.tsx";
import { Wordmark } from "../components/wordmark.tsx";
import { type Translate, useT } from "../i18n/index.ts";
import { LanguagePicker } from "../i18n/language-picker.tsx";
import { ApiError, apiGet, apiPost } from "../lib/api.ts";
import { AppStoreLinks } from "../me/app-store-links.tsx";
import { ANDROID_PACKAGE, APP_PRIVACY_URL, APP_STORE_URL, GOOGLE_PLAY_URL } from "../me/app-stores.ts";
import { connectQrDataUrl } from "../me/mobile-connect.ts";
import { forgetTryCompany, rememberedTryCompany, rememberTryCompany, type TryCompany } from "./storage.ts";

/**
 * `/try` (openspec add-demo-companies, design decision 9): get the app, start a private demo
 * company, then open it in the app (a link on a phone, a QR code on a computer) or in the browser.
 * The same company works in both. Only on a server started with DEMO_COMPANIES=1; elsewhere the
 * config request answers 404 and this is a not-found page.
 */

interface TryConfig {
  ttlHours: number;
  server: string;
}

type Device = "android" | "ios" | "computer";

function deviceKind(): Device {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return "computer";
}

/**
 * Android: an `intent://` link opens the app if it is installed and the Play listing otherwise.
 * iPhone: the plain `crowhr://` link (Safari can't fall back to the store by itself).
 */
export function appLink(connectUrl: string, device: Device): string {
  if (device !== "android") return connectUrl;
  const query = connectUrl.slice(connectUrl.indexOf("?"));
  return `intent://connect${query}#Intent;scheme=crowhr;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(GOOGLE_PLAY_URL)};end`;
}

function lifetime(hours: number, t: Translate): string {
  if (hours % 24 === 0) {
    const count = hours / 24;
    return t(count === 1 ? "{count} day" : "{count} days", { count });
  }
  return t(hours === 1 ? "{count} hour" : "{count} hours", { count: hours });
}

export function TryPage() {
  const t = useT("demo");
  const config = useQuery({
    queryKey: ["demo-companies-config"],
    queryFn: () => apiGet<TryConfig>("/api/v1/demo-companies/config"),
    retry: false,
  });
  if (config.isPending) {
    return (
      <TryLayout>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="mt-4 h-40 w-full" />
      </TryLayout>
    );
  }
  if (config.isError) {
    const notOffered = config.error instanceof ApiError && config.error.status === 404;
    return (
      <TryLayout>
        <h1 className="text-2xl font-semibold leading-8">
          {notOffered ? t("Page not found") : t("Couldn't load this page")}
        </h1>
        <p className="mt-2 text-ui text-primary-300">
          {notOffered
            ? t("The address may be mistyped, or the page has moved.")
            : t("The server didn't answer. Check your connection and reload the page.")}
        </p>
        <Button asChild variant="secondary" className="mt-6 self-start">
          <a href="/">{t("Go to Crow HR")}</a>
        </Button>
      </TryLayout>
    );
  }
  return (
    <TryLayout>
      <TryContent config={config.data} />
    </TryLayout>
  );
}

function TryLayout({ children }: { children: React.ReactNode }) {
  const t = useT("demo");
  return (
    <main className="flex min-h-dvh flex-col px-5 py-6 sm:px-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Wordmark />
        <LanguagePicker />
      </div>
      <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col py-10" data-testid="try-page">
        {children}
      </div>
      <footer className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-primary-200">
        <span>Crow HR</span>
        <span>{t("Free and open source")}</span>
        <span>{t("MIT licensed")}</span>
      </footer>
    </main>
  );
}

function Step({
  n,
  title,
  children,
  testId,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  const id = `try-step-${n}`;
  return (
    <li className="border-t border-border py-6" aria-labelledby={id} data-testid={testId}>
      <h2 id={id} className="mb-3 flex items-baseline gap-3">
        <span className="num font-azeret text-2xs font-semibold text-primary-200">{n}.</span>
        <span className={textStyle.section}>{title}</span>
      </h2>
      <div className="flex flex-col gap-3 pl-8">{children}</div>
    </li>
  );
}

function TryContent({ config }: { config: TryConfig }) {
  const t = useT("demo");
  const [company, setCompany] = React.useState<TryCompany | null>(() => rememberedTryCompany());
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<{ title: string; body: string } | null>(null);
  const device = React.useMemo(deviceKind, []);
  const statusRef = React.useRef<HTMLDivElement>(null);

  const start = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const started = await apiPost<TryCompany>("/api/v1/demo-companies", {});
      rememberTryCompany(started);
      setCompany(started);
      requestAnimationFrame(() => statusRef.current?.focus());
    } catch (err) {
      if (err instanceof ApiError) {
        const retryAt = (err.envelope?.error.details as { retryAt?: string } | undefined)?.retryAt;
        setProblem({
          title:
            err.code === "rate_limited"
              ? "Not right now"
              : err.code === "service_unavailable"
                ? "Busy preparing demo companies"
                : "Couldn't start a demo company",
          body: `${err.message}${retryAt ? ` ${t("Try again after {date}.", { date: formatDateTime(retryAt) })}` : ""}`,
        });
      } else {
        setProblem({ title: "Couldn't reach the server", body: "Check your connection and try again." });
      }
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    forgetTryCompany();
    setCompany(null);
  };

  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold leading-8">{t("Your own demo company, on your phone and the web")}</h1>
      <p className="mb-6 text-ui text-primary-300">
        {t(
          "Get a private copy of Qinghe Foods, a fictional café group with three outlets: payroll since July, leave, claims, rosters and approvals waiting. Sign in by picking a person, no password. It is yours alone and is deleted {duration} after you start it.",
          { duration: lifetime(config.ttlHours, t) },
        )}
      </p>

      <ol className="flex flex-col">
        <Step n={1} title={t("Get the app (optional)")}>
          <p className="text-ui text-primary-300">
            {t("Install Crow HR on your phone to try the app. You can also use everything in the browser.")}
          </p>
          <AppStoreLinks />
        </Step>

        <Step n={2} title={t("Start your demo company")} testId="try-start">
          {company ? (
            <p className="text-ui text-primary-300">
              {t("Your demo company {code} is ready. It ends on {date}.", {
                code: company.slug,
                date: formatDateTime(company.expiresAt),
              })}{" "}
              <button
                type="button"
                onClick={startOver}
                className="focus-ring rounded-sm font-medium text-biru-400 underline-offset-2 hover:underline"
              >
                {t("Start a different one")}
              </button>
            </p>
          ) : (
            <>
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="self-start"
                onClick={() => void start()}
                disabled={busy}
                data-testid="try-start-button"
              >
                {busy ? t("Preparing your company…") : t("Start my demo company")}
              </Button>
              <p className="text-2xs text-primary-300" aria-live="polite">
                {busy
                  ? t(
                      "Setting up four months of history. This takes a few seconds, up to half a minute when the server is busy.",
                    )
                  : t("One per visitor. A few per network each hour.")}
              </p>
            </>
          )}
          {problem ? (
            <Alert variant="warning" data-testid="try-problem">
              <AlertTriangle aria-hidden />
              <div>
                <AlertTitle>{t(problem.title)}</AlertTitle>
                <AlertDescription>{t(problem.body)}</AlertDescription>
              </div>
            </Alert>
          ) : null}
        </Step>

        <Step n={3} title={t("Open it")} testId="try-open">
          {company ? (
            <OpenCompany company={company} device={device} statusRef={statusRef} />
          ) : (
            <p className="text-ui text-primary-300">
              {t(
                "After step 2: open your company in the app (a link on your phone, a QR code on a computer) or in this browser.",
              )}
            </p>
          )}
        </Step>
      </ol>

      <p className="border-t border-border pt-6 text-2xs text-primary-300">
        {t(
          "The demo server is run by Crow Tech. Nothing is retained: what you type or upload stays in your demo company until it ends and is then deleted with it, and the start limits keep only a count per network, not its address, for at most a day.",
        )}{" "}
        <NewTabLink href={APP_PRIVACY_URL}>{t("Privacy policy")}</NewTabLink>
      </p>
    </>
  );
}

function OpenCompany({
  company,
  device,
  statusRef,
}: {
  company: TryCompany;
  device: Device;
  statusRef: React.RefObject<HTMLDivElement | null>;
}) {
  const t = useT("demo");
  const qr = useQuery({
    queryKey: ["try-connect-qr", company.connectUrl],
    queryFn: () => connectQrDataUrl(company.connectUrl),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: device === "computer",
  });
  const signInPath = `/sign-in/${encodeURIComponent(company.slug)}`;
  return (
    <div ref={statusRef} tabIndex={-1} className="flex flex-col gap-4 outline-none" data-testid="try-company">
      {device === "computer" ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="size-[184px] shrink-0 rounded-md border border-border bg-white p-1">
            {qr.data ? (
              <img
                src={qr.data}
                width={176}
                height={176}
                alt={t("QR code that opens your demo company in the Crow HR app")}
                data-testid="try-qr"
              />
            ) : qr.isError ? (
              <p className="p-3 text-2xs text-danger-300" role="alert">
                {t("Couldn't draw the code. Type the server address and company code into the app instead.")}
              </p>
            ) : (
              <Skeleton className="size-full" />
            )}
          </div>
          <p className="text-ui text-primary-300">
            {t(
              "Scan this code with the Crow HR app or your phone's camera. It holds only the server address and your company code, never a sign-in.",
            )}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button asChild variant="primary" size="lg" className="self-start">
            <a href={appLink(company.connectUrl, device)} data-testid="try-open-app">
              <Smartphone aria-hidden />
              {t("Open in the Crow HR app")}
            </a>
          </Button>
          <p className="text-2xs text-primary-300" data-testid="try-app-hint">
            {device === "android" ? (
              <>
                {t("If the app isn’t installed, you’ll be taken to Google Play.")}{" "}
                <NewTabLink href={GOOGLE_PLAY_URL}>Google Play</NewTabLink>
              </>
            ) : (
              <>
                {t("Install the app from the App Store, then tap this button.")}{" "}
                <NewTabLink href={APP_STORE_URL}>App Store</NewTabLink>
              </>
            )}
          </p>
        </div>
      )}

      <Button asChild variant="secondary" className="self-start">
        <a href={signInPath} data-testid="try-open-browser">
          {t("Open in this browser")}
          <ExternalLink aria-hidden />
        </a>
      </Button>

      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
        <p className="text-2xs text-primary-300">
          {t(
            "Or type it into the app, on Android or iPhone: the server address, then the company code when it asks for the organisation.",
          )}
        </p>
        <span className={textStyle.group}>{t("Server address")}</span>
        <CopyField value={company.server} label={t("Server address")} testId="try-server" />
        <span className={textStyle.group}>{t("Company code")}</span>
        <CopyField value={company.slug} label={t("Company code")} testId="try-slug" />
      </div>

      <div className="text-ui text-primary-300">
        <p className={cn("mb-1", textStyle.group)}>{t("Things to try")}</p>
        <ul className="list-disc pl-4">
          <li>{t("On your phone, sign in as Hafiz (Employee) and apply for leave or claim a taxi with a photo.")}</li>
          <li>{t("In the browser, sign in as Siti (Manager) and approve it. Hafiz sees the answer in the app.")}</li>
          <li>{t("As Chloe (Payroll admin), look through October's payroll run, payslips and CPF file.")}</li>
        </ul>
      </div>
    </div>
  );
}

/** An inline link that opens in a new tab (the store listings, the privacy policy). */
function NewTabLink({ href, children }: { href: string; children: React.ReactNode }) {
  const t = useT("demo");
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="focus-ring rounded-sm font-medium text-biru-400 underline-offset-2 hover:underline"
    >
      {children}
      <span className="sr-only"> {t("(opens in a new tab)")}</span>
    </a>
  );
}
