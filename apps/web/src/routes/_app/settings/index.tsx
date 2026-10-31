import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, KeyRound } from "lucide-react";
import { PageHeader } from "../../../components/page-header.tsx";

const SECTIONS = [
  { title: "Organisation", body: "Company name, UEN, address, CPF submission number." },
  { title: "Roles and access", body: "Who can see salaries, approve leave and run payroll." },
  { title: "Payroll defaults", body: "Pay dates, rounding, bank files." },
  { title: "Leave policies", body: "Leave types, entitlements, carry-forward." },
];

export const Route = createFileRoute("/_app/settings/")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Organisation, security and module defaults." />
      <section aria-labelledby="security-heading" className="mb-8">
        <h2
          id="security-heading"
          className="mb-2 font-azeret text-2xs font-medium uppercase tracking-wider text-primary-200"
        >
          Security
        </h2>
        <Link
          to="/settings/security/sign-in-methods"
          className="focus-ring group flex items-center gap-3 rounded-lg border border-border bg-surface-50 px-4 py-3 hover:border-ink/40"
        >
          <span className="flex size-8 items-center justify-center rounded-md border border-ink/15 bg-surface-100">
            <KeyRound className="size-4" aria-hidden />
          </span>
          <span className="flex-1">
            <span className="block font-azeret text-xs font-semibold">Sign-in methods</span>
            <span className="block text-ui text-primary-300">
              Email and password, Google, Microsoft, Singpass and other single sign-on.
            </span>
          </span>
          <ChevronRight className="size-4 text-primary-200 group-hover:text-ink" aria-hidden />
        </Link>
      </section>
      <section aria-labelledby="other-heading">
        <h2
          id="other-heading"
          className="mb-2 font-azeret text-2xs font-medium uppercase tracking-wider text-primary-200"
        >
          Coming later
        </h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {SECTIONS.map((s) => (
            <li
              key={s.title}
              className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span>
                <span className="block font-azeret text-xs font-semibold text-primary-300">{s.title}</span>
                <span className="block text-ui text-primary-200">{s.body}</span>
              </span>
              <span className="font-azeret text-[10px] uppercase tracking-wider text-primary-200">
                Not available yet
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
