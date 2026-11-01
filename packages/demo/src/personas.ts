/**
 * The demo's personas and shared password. Dependency-free on purpose: the page bundle imports
 * this for the sign-in picker without pulling in core or the seed.
 */

/** The password of every seeded account (shown on the sign-in page and the About page). */
export const DEMO_PASSWORD = "kopi-kaki-demo";

export interface PersonaDef {
  key: "owner" | "hr" | "payroll" | "manager" | "employee";
  label: string;
  /** People key in core's seed-people.ts or the demo's people.ts. */
  employee: string;
  email: string;
  roles: ("owner" | "hr_admin" | "payroll_admin")[];
  name: string;
  blurb: string;
}

/** The five personas the sign-in page offers, in order. */
export const PERSONAS: readonly PersonaDef[] = [
  {
    key: "owner",
    label: "Owner",
    employee: "owner",
    email: "kahhui@kopikaki.example",
    roles: ["owner"],
    name: "Lim Kah Hui",
    blurb: "Managing director. Approves payroll and her direct reports' claims.",
  },
  {
    key: "hr",
    label: "HR admin",
    employee: "hr",
    email: "aisyah@kopikaki.example",
    roles: ["hr_admin"],
    name: "Nur Aisyah binte Rahman",
    blurb: "People records, change requests and the second claims step.",
  },
  {
    key: "payroll",
    label: "Payroll admin",
    employee: "fin",
    email: "chloe@kopikaki.example",
    roles: ["payroll_admin"],
    name: "Chloe de Souza",
    blurb: "Prepares the monthly run, bank file and CPF file.",
  },
  {
    key: "manager",
    label: "Manager",
    employee: "jp_lead",
    email: "siti@kopikaki.example",
    roles: [],
    name: "Siti Nurhaliza binte Osman",
    blurb: "Jurong Point outlet supervisor. Approves her team's claims.",
  },
  {
    key: "employee",
    label: "Employee",
    employee: "barista1",
    email: "junjie@kopikaki.example",
    roles: [],
    name: "Goh Jun Jie",
    blurb: "Barista at Tanjong Pagar. Payslips, claims and his own profile.",
  },
];

/** Other members (so their managers and claims are real), listed under the personas. */
export const OTHER_MEMBERS: readonly { employee: string; email: string }[] = [
  { employee: "pt1", email: "huimin@kopikaki.example" },
  { employee: "tb_lead", email: "meixuan@kopikaki.example" },
  { employee: "joiner", email: "darren@kopikaki.example" },
  { employee: "leaver_oct", email: "priyanka@kopikaki.example" },
  { employee: "opsmgr", email: "rajesh@kopikaki.example" },
  { employee: "tp_lead", email: "weiming@kopikaki.example" },
  { employee: "barista2", email: "hafiz@kopikaki.example" },
  { employee: "spass", email: "maria@kopikaki.example" },
];
