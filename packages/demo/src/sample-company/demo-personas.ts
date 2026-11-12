import type { DemoPersonaInfo } from "@crowhr/core";
import { PERSONAS } from "../personas.ts";

/**
 * Who a demo company's sign-in page features (openspec add-demo-companies), by the local part of
 * their email. Light on purpose: the server imports it at start, while the seed that builds a
 * demo company (demo-company.ts) loads only when the first copy is made.
 */
const FEATURED: readonly { local: string; key: string; label: string; blurb: string }[] = [
  ...PERSONAS.filter((p) => p.key !== "employee" && p.key !== "manager").map((p) => ({
    local: p.email.split("@")[0] as string,
    key: p.key,
    label: p.label,
    blurb: p.blurb,
  })),
  {
    local: "siti",
    key: "manager",
    label: "Manager",
    blurb: "Jurong Point outlet supervisor. Approves Hafiz's and Maria's leave, claims and timesheets.",
  },
  {
    // Not the browser demo's Jun Jie: his manager changes on 1 Dec 2026 (a transfer), so his
    // requests would reach a different manager depending on the date. Hafiz's go to Siti.
    local: "hafiz",
    key: "employee",
    label: "Employee",
    blurb: "Barista at Jurong Point, in Siti's team. Payslips, leave, claims, roster and clock-in.",
  },
];

/** Picker labels for a demo company's people (core's `personaInfo`); null for everyone else. */
export function demoCompanyPersonaInfo(email: string): DemoPersonaInfo | null {
  const local = email.split("@")[0]?.toLowerCase();
  const index = FEATURED.findIndex((p) => p.local === local);
  const p = FEATURED[index];
  return p ? { key: p.key, label: p.label, blurb: p.blurb, order: index } : null;
}

/** The sign-in email domain of a demo company: unique per copy, under the reserved `.example`. */
export function demoCompanyEmailDomain(slug: string): string {
  return `${slug}.kopikaki.example`;
}
