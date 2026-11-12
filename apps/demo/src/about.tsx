import "@crowhr/ui/fonts.css";
import "@crowhr/ui/styles.css";
import { DEMO_PASSWORD, PERSONAS } from "@crowhr/demo/personas";
import { ArrowLeft, BookOpen, Server } from "lucide-react";
import { createRoot } from "react-dom/client";
import { tryUrl } from "./try-url.ts";

/**
 * /about-demo: what the demo is, and every way it differs from a self-hosted install. Renders
 * without starting the database, so it opens instantly and can be linked from the docs.
 */
export function mountAboutPage(dataVersion: string) {
  const root = document.getElementById("root");
  if (!root) return;
  document.title = "About the Crow HR demo";
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
    "The company lives on 31 Oct 2026; the clock starts there at your time of day and then runs normally.",
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
  return (
    <div className="min-h-dvh bg-surface-100/50">
      <main className="mx-auto w-full max-w-[880px] px-4 pb-16 pt-8 md:px-8 md:pt-12" data-testid="about-demo">
        <a
          href="/"
          className="focus-ring mb-8 inline-flex items-center gap-1.5 rounded-sm font-azeret text-2xs font-medium text-ink hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back to the demo
        </a>
        <p className="mb-2 font-azeret text-2xs font-semibold uppercase tracking-wider text-primary-300">
          Crow HR · public demo
        </p>
        <h1 className="mb-3 font-azeret text-2xl font-semibold leading-tight tracking-tight">About this demo</h1>
        <p className="max-w-2xl text-sm leading-6 text-primary-300">
          This is the real Crow HR: the same web app and the same API code that a self-hosted install runs, started
          inside your browser instead of on a server. Payroll is calculated by the real engine with the cited Singapore
          rules, approvals go through the real workflow engine, and permissions are enforced by the same code.
        </p>

        {tryUrl() ? (
          <section className="mt-10" aria-labelledby="phone" data-testid="about-try-phone">
            <h2 id="phone" className="mb-2 font-azeret text-sm font-semibold">
              On your phone
            </h2>
            <p className="max-w-2xl text-ui leading-6 text-primary-300">
              The Crow HR mobile apps need a real server, so they can't use this in-browser demo. Get your own demo
              company on Crow Tech's demo server instead: the same Kopi Kaki, private to you, signed in by picking a
              person in the app and in the browser, and deleted with everything in it after a few days.{" "}
              <a
                href={tryUrl() ?? undefined}
                className="focus-ring rounded-sm font-medium text-biru-400 underline-offset-2 hover:underline"
              >
                Start a demo company
              </a>
            </p>
          </section>
        ) : null}

        <section className="mt-10" aria-labelledby="privacy">
          <h2 id="privacy" className="mb-2 font-azeret text-sm font-semibold">
            Nothing leaves this device
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-ui leading-6 text-primary-300">
            <li>There is no backend. The site is static files; your data lives only in this browser's IndexedDB.</li>
            <li>
              No analytics, no tracking, no third-party scripts, fonts or requests. The page's security policy only
              allows its own origin.
            </li>
            <li>
              Never type real personal data here anyway: it is a demo, and anyone with access to this browser can open
              it.
            </li>
            <li>
              <strong className="font-medium text-ink">Reset</strong> in the banner wipes your copy and loads the
              company fresh. Clearing this site's data in your browser does the same.
            </li>
          </ul>
        </section>

        <section className="mt-10" aria-labelledby="company">
          <h2 id="company" className="mb-2 font-azeret text-sm font-semibold">
            The company: Kopi Kaki Pte. Ltd.
          </h2>
          <p className="mb-3 max-w-2xl text-ui leading-6 text-primary-300">
            A fictional café group with an office, a central kitchen and three outlets: 27 people across citizens,
            permanent residents in their first, second and later years, Employment Pass, S Pass and Work Permit holders,
            every self-help group fund, part-timers and employees on each CPF age boundary. July to September 2026
            payroll is approved and paid; October is a computed draft with warnings. Claims, leave, change requests and
            approvals are waiting for each persona. Every name, NRIC/FIN, bank account and email address is invented.
          </p>
          <section
            aria-label="Demo personas"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a table wider than a phone scrolls; keyboard users must reach it (WCAG 2.1.1).
            tabIndex={0}
            className="focus-ring overflow-x-auto rounded-md border border-border bg-surface-50"
          >
            <table className="w-full min-w-[520px] text-left text-ui">
              <thead className="border-b border-border bg-surface-100/60 font-azeret text-2xs uppercase tracking-wider text-primary-300">
                <tr>
                  <th className="px-3 py-2 font-medium">Persona</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">What they do here</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {PERSONAS.map((p) => (
                  <tr key={p.key}>
                    <td className="whitespace-nowrap px-3 py-2 font-azeret text-2xs font-semibold uppercase tracking-wider">
                      {p.label}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2 text-primary-300">{p.blurb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <p className="mt-2 text-2xs text-primary-300">
            Shared password for typing it in: <span className="num text-ink">{DEMO_PASSWORD}</span>
          </p>
        </section>

        <section className="mt-10" aria-labelledby="differences">
          <h2 id="differences" className="mb-2 font-azeret text-sm font-semibold">
            Demo-only behaviour
          </h2>
          <p className="mb-3 max-w-2xl text-ui leading-6 text-primary-300">
            Everything below exists only in the demo. A self-hosted install behaves as in the right-hand column.
          </p>
          <section
            aria-label="Demo compared with a self-hosted install"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a table wider than a phone scrolls; keyboard users must reach it (WCAG 2.1.1).
            tabIndex={0}
            className="focus-ring overflow-x-auto rounded-md border border-border bg-surface-50"
          >
            <table className="w-full min-w-[640px] text-left text-ui" data-testid="demo-differences">
              <thead className="border-b border-border bg-surface-100/60 font-azeret text-2xs uppercase tracking-wider text-primary-300">
                <tr>
                  <th className="w-[22%] px-3 py-2 font-medium">Area</th>
                  <th className="px-3 py-2 font-medium">In the demo</th>
                  <th className="px-3 py-2 font-medium">Self-hosted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border align-top">
                {DIFFERENCES.map(([area, demo, real]) => (
                  <tr key={area}>
                    <td className="px-3 py-2 font-medium">{area}</td>
                    <td className="px-3 py-2">{demo}</td>
                    <td className="px-3 py-2 text-primary-300">{real}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </section>

        <section className="mt-10" aria-labelledby="missing">
          <h2 id="missing" className="mb-2 font-azeret text-sm font-semibold">
            Demo limits
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-ui leading-6 text-primary-300">
            <li>January–June opening balances are not imported, so payroll shows the missing YTD warning.</li>
            <li>
              July–September overtime was entered on the historical payroll runs. October uses approved clocked
              overtime. Part-month joiner and leaver payroll uses a full-month denominator counted from the outlet
              roster.
            </li>
            <li>The demo runs in one tab at a time (two tabs would write the same local database).</li>
            <li>
              Nothing is filed with CPF Board, IRAS or a bank, here or in the product: Crow HR produces the files for
              you to upload.
            </li>
          </ul>
        </section>

        <div className="mt-12 flex flex-wrap gap-3">
          <a
            href="/"
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-md border-2 border-ink bg-kuning-200 px-5 font-azeret text-ui font-semibold shadow-brutal-sm hover:bg-kuning-300"
          >
            Open the demo
          </a>
          <a
            href="/docs/self-hosting/install/"
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-md border border-ink/20 bg-surface-50 px-4 font-azeret text-xs font-semibold hover:border-ink/40"
          >
            <Server className="size-4" aria-hidden />
            Host it yourself
          </a>
          <a
            href="/docs/"
            className="focus-ring inline-flex h-10 items-center gap-2 rounded-md border border-ink/20 bg-surface-50 px-4 font-azeret text-xs font-semibold hover:border-ink/40"
          >
            <BookOpen className="size-4" aria-hidden />
            Read the docs
          </a>
        </div>
        <p className="num mt-10 text-2xs text-primary-200">
          Demo data version {dataVersion} · MIT licensed · Crow Tech Pte. Ltd.
        </p>
      </main>
    </div>
  );
}
