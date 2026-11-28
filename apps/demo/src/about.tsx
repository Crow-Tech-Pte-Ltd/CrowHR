import { useT } from "../../web/src/i18n/index.ts";
import "@crowhr/ui/fonts.css";
import "@crowhr/ui/styles.css";
import { DEMO_PASSWORD, PERSONAS } from "@crowhr/demo/personas";
import { ArrowLeft, BookOpen, Server } from "lucide-react";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { LanguagePicker } from "../../web/src/i18n/language-picker.tsx";
import { tryUrl } from "./try-url.ts";

/**
 * /about-demo: what the demo is, and every way it differs from a self-hosted install. Renders
 * without starting the database, so it opens instantly and can be linked from the docs.
 */
export function mountAboutPage(dataVersion: string) {
  const root = document.getElementById("root");
  if (!root) return;
  createRoot(root).render(<AboutPage dataVersion={dataVersion} />);
}

const DIFFERENCES: [string, string, string][] = [
  ["Where it runs", "In this browser tab. The Crow HR API runs in a Web Worker.", "On your server (Docker)."],
  [
    "Database",
    "PostgreSQL compiled to WebAssembly (PGlite), saved in this browser's IndexedDB. Each browser has its own copy.",
    "PostgreSQL 17.",
  ],
  [
    "Signing in",
    "One click on a persona. Every account also accepts the shared demo password. MFA is not required.",
    "Email and password with argon2id, optional MFA (required for admins by default), SSO.",
  ],
  [
    "Google, Microsoft, Singpass",
    "Buttons are shown but disabled. No request is made to any identity provider.",
    "Work once the organisation owner configures them in Settings → Security.",
  ],
  [
    "Email",
    "Nothing is sent. Messages appear in the Demo outbox, so invitation and reset links still work.",
    "Sent over SMTP if configured; otherwise invitations show a copyable link.",
  ],
  ["Passwords", "PBKDF2 (Web Crypto, 10,000 rounds) in a demo-only format that a real server refuses.", "argon2id."],
  [
    "Encryption at rest",
    "NRIC/FIN and bank numbers are encrypted with a throwaway key shipped with the fictional snapshot and kept with the demo database. Browser seeding generates a fresh key.",
    "Encrypted with the server's CROWHR_SECRET_KEY.",
  ],
  [
    "Date",
    "The company lives on Saturday 31 Oct 2026. Every visit starts there at 11:30 Singapore time, after the outlets' morning crews have clocked in, and the clock then runs normally.",
    "The real date.",
  ],
  ["Uploaded files", "Receipts are stored in the browser database.", "Stored on the server's disk volume."],
  [
    "Background jobs",
    "Reminders, escalations and the email outbox run every 30 seconds while a demo tab is open.",
    "Run every 60 seconds in the server process.",
  ],
  ["Backups and system status", "Not applicable: there is no server.", "Daily pg_dump to the backups volume."],
];

function AboutPage({ dataVersion }: { dataVersion: string }) {
  const t = useT("demo");
  const personaText = useT("settings-account");
  useEffect(() => {
    document.title = t("About the Crow HR demo");
  }, [t]);
  return (
    <div className="min-h-dvh bg-surface-100/50">
      <main className="mx-auto w-full max-w-[880px] px-4 pb-16 pt-8 md:px-8 md:pt-12" data-testid="about-demo">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <a
            href="/"
            className="focus-ring inline-flex items-center gap-1.5 rounded-sm font-azeret text-2xs font-medium text-ink hover:underline"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {t("Back to the demo")}
          </a>
          <LanguagePicker />
        </div>
        <h1 className="mb-3 font-azeret text-2xl font-semibold leading-tight tracking-tight">{t("About this demo")}</h1>
        <p className="max-w-2xl text-sm leading-6 text-primary-300">
          {t(
            "The same web app and API code as a self-hosted install, running in your browser instead of on a server. Payroll, approvals and permissions use the same engine and the same cited Singapore rules.",
          )}
        </p>

        {tryUrl() ? (
          <section className="mt-10" aria-labelledby="phone" data-testid="about-try-phone">
            <h2 id="phone" className="mb-2 font-azeret text-sm font-semibold">
              {t("On your phone")}
            </h2>
            <p className="max-w-2xl text-ui leading-6 text-primary-300">
              {t(
                "Start a private company on Crow Tech's demo server to try the mobile apps. Pick a person to sign in on your phone or in the browser. Your copy expires after a few days.",
              )}{" "}
              <a
                href={tryUrl() ?? undefined}
                className="focus-ring rounded-sm font-medium text-biru-400 underline-offset-2 hover:underline"
              >
                {t("Start a demo company")}
              </a>
            </p>
          </section>
        ) : null}

        <section className="mt-10" aria-labelledby="privacy">
          <h2 id="privacy" className="mb-2 font-azeret text-sm font-semibold">
            {t("Nothing leaves this device")}
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-ui leading-6 text-primary-300">
            <li>
              {t("There is no backend. The site is static files; your data lives only in this browser's IndexedDB.")}
            </li>
            <li>
              {t(
                "No analytics, no tracking, no third-party scripts, fonts or requests. The page's security policy only allows its own origin.",
              )}
            </li>
            <li>
              {t(
                "Never type real personal data here anyway: it is a demo, and anyone with access to this browser can open it.",
              )}
            </li>
            <li>
              {t(
                "Use Reset in the banner to wipe your copy and reload the company. Clearing this site’s data in your browser has the same effect.",
              )}
            </li>
          </ul>
        </section>

        <section className="mt-10" aria-labelledby="company">
          <h2 id="company" className="mb-2 font-azeret text-sm font-semibold">
            {t("The company: Qinghe Foods Pte. Ltd.")}
          </h2>
          <p className="mb-3 max-w-2xl text-ui leading-6 text-primary-300">
            {t(
              "A fictional café group with an office, a central kitchen and three outlets. 25 people work there (one starts in November) and two left this year. They include citizens, permanent residents in their first, second and later years, Employment Pass, S Pass and Work Permit holders, every self-help group fund, part-timers and employees on each CPF age boundary. July to September 2026 payroll is approved and paid; October is a computed draft with warnings. Claims, leave, change requests and approvals are waiting for each persona. Every name, NRIC/FIN, bank account and email address is invented.",
            )}
          </p>
          <section
            aria-label={t("Demo personas")}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a table wider than a phone scrolls; keyboard users must reach it (WCAG 2.1.1).
            tabIndex={0}
            className="focus-ring overflow-x-auto rounded-md border border-border bg-surface-50"
          >
            <table className="w-full min-w-[520px] text-left text-ui">
              <thead className="border-b border-border bg-surface-100/60 font-azeret text-2xs uppercase tracking-wider text-primary-300">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("Persona")}</th>
                  <th className="px-3 py-2 font-medium">{t("Name")}</th>
                  <th className="px-3 py-2 font-medium">{t("What they do here")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {PERSONAS.map((p) => (
                  <tr key={p.key}>
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{personaText(p.label)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2 text-primary-300">{personaText(p.blurb)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <p className="mt-2 text-2xs text-primary-300">
            {t("Shared password for typing it in:")} <span className="num text-ink">{DEMO_PASSWORD}</span>
          </p>
        </section>

        <section className="mt-10" aria-labelledby="differences">
          <h2 id="differences" className="mb-2 font-azeret text-sm font-semibold">
            {t("Demo-only behaviour")}
          </h2>
          <p className="mb-3 max-w-2xl text-ui leading-6 text-primary-300">
            {t("Everything below exists only in the demo. A self-hosted install behaves as in the right-hand column.")}
          </p>
          <section
            aria-label={t("Demo compared with a self-hosted install")}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a table wider than a phone scrolls; keyboard users must reach it (WCAG 2.1.1).
            tabIndex={0}
            className="focus-ring overflow-x-auto rounded-md border border-border bg-surface-50"
          >
            <table className="w-full min-w-[640px] text-left text-ui" data-testid="demo-differences">
              <thead className="border-b border-border bg-surface-100/60 font-azeret text-2xs uppercase tracking-wider text-primary-300">
                <tr>
                  <th className="w-[22%] px-3 py-2 font-medium">{t("Area")}</th>
                  <th className="px-3 py-2 font-medium">{t("In the demo")}</th>
                  <th className="px-3 py-2 font-medium">{t("Self-hosted")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {DIFFERENCES.map(([area, demo, real]) => (
                  <tr key={area}>
                    <td className="px-3 py-2 font-medium">{t(area)}</td>
                    <td className="px-3 py-2">{t(demo)}</td>
                    <td className="px-3 py-2 text-primary-300">{t(real)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </section>

        <section className="mt-10" aria-labelledby="missing">
          <h2 id="missing" className="mb-2 font-azeret text-sm font-semibold">
            {t("Demo limits")}
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-ui leading-6 text-primary-300">
            <li>
              {t(
                "January–June 2026 opening balances are imported as for a company that moved to Crow HR mid-year, so runs warn only about real issues.",
              )}
            </li>
            <li>
              {t(
                "July–September overtime was entered on the historical payroll runs. October uses approved clocked overtime. Part-month joiner and leaver payroll uses a full-month denominator counted from the outlet roster.",
              )}
            </li>
            <li>{t("The demo runs in one tab at a time (two tabs would write the same local database).")}</li>
            <li>
              {t(
                "Nothing is filed with CPF Board, IRAS or a bank, here or in the product: Crow HR produces the files for you to upload.",
              )}
            </li>
          </ul>
        </section>

        <div className="mt-12 flex flex-wrap gap-3">
          <a
            href="/"
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-md border-2 border-ink bg-kuning-200 px-5 font-azeret text-ui font-semibold text-accent-foreground shadow-brutal-sm hover:bg-kuning-300"
          >
            {t("Open the demo")}
          </a>
          <a
            href="/docs/self-hosting/install/"
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-md border border-ink/20 bg-surface-50 px-4 font-azeret text-xs font-semibold hover:border-ink/40"
          >
            <Server className="size-4" aria-hidden />
            {t("Host it yourself")}
          </a>
          <a
            href="/docs/"
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-md border border-ink/20 bg-surface-50 px-4 font-azeret text-xs font-semibold hover:border-ink/40"
          >
            <BookOpen className="size-4" aria-hidden />
            {t("Read the docs")}
          </a>
        </div>
        <p className="num mt-10 text-2xs text-primary-200">
          {t("Demo data version")} {dataVersion} {t("· MIT licensed · Crow Tech Pte. Ltd.")}
        </p>
      </main>
    </div>
  );
}
