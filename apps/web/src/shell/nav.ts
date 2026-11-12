import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  Clock,
  FileText,
  Home,
  Inbox,
  type LucideIcon,
  Receipt,
  Settings,
  Users,
  Wallet,
} from "lucide-react";

export type ModuleId =
  | "home"
  | "inbox"
  | "people"
  | "payroll"
  | "leave"
  | "attendance"
  | "schedules"
  | "claims"
  | "documents"
  | "reports"
  | "settings";

export interface ModuleDef {
  id: ModuleId;
  label: string;
  to: string;
  icon: LucideIcon;
  /** One line for the command palette. */
  summary: string;
  /** Empty-state copy: what this module will do once built. */
  emptyTitle: string;
  emptyBody: string;
  /** Extra search terms for the command palette. */
  keywords: string[];
}

export const MODULES: Record<ModuleId, ModuleDef> = {
  home: {
    id: "home",
    label: "Home",
    to: "/",
    icon: Home,
    summary: "Work waiting for you",
    emptyTitle: "Nothing waiting",
    emptyBody: "Approvals, payroll deadlines and expiring passes appear here.",
    keywords: ["inbox", "dashboard", "approvals"],
  },
  inbox: {
    id: "inbox",
    label: "Inbox",
    to: "/inbox",
    icon: Inbox,
    summary: "Approve or reject requests",
    emptyTitle: "Nothing to approve",
    emptyBody: "Requests that need your decision appear here.",
    keywords: ["approvals", "approve", "reject", "requests", "tasks", "out of office"],
  },
  people: {
    id: "people",
    label: "People",
    to: "/people",
    icon: Users,
    summary: "Employee records, work passes, bank details",
    emptyTitle: "No employees yet",
    emptyBody:
      "Employee records will live here: personal and employment details, NRIC/FIN (masked), work passes, bank accounts and job history. Payroll, leave and claims all start from these records.",
    keywords: ["employees", "staff", "directory", "work pass", "nric", "fin"],
  },
  payroll: {
    id: "payroll",
    label: "Payroll",
    to: "/payroll",
    icon: Wallet,
    summary: "Monthly runs, CPF, payslips, bank files",
    emptyTitle: "No payroll runs yet",
    emptyBody:
      "Monthly payroll runs will be prepared, reviewed and approved here, with CPF, SDL and FWL worked out from cited, effective-dated rules, then payslips and bank files generated.",
    keywords: ["salary", "cpf", "payslip", "sdl", "fwl", "giro", "bank file"],
  },
  leave: {
    id: "leave",
    label: "Leave",
    to: "/leave",
    icon: CalendarDays,
    summary: "Apply for leave, balances, who's away",
    emptyTitle: "No leave requests yet",
    emptyBody:
      "Apply for annual, sick, childcare and family leave, see your balances, and see who's away. Statutory leave and Singapore public holidays are built in.",
    keywords: ["annual leave", "mc", "sick", "holiday", "time off"],
  },
  attendance: {
    id: "attendance",
    label: "Attendance",
    to: "/attendance",
    icon: Clock,
    summary: "Clock in and out, timesheets, overtime claims",
    emptyTitle: "No attendance records yet",
    emptyBody:
      "Clock in and out (even offline), see your timesheet and claim overtime. Approved overtime goes to payroll.",
    keywords: ["clock in", "timesheet", "overtime", "ot"],
  },
  schedules: {
    id: "schedules",
    label: "Schedules",
    to: "/schedules",
    icon: CalendarClock,
    summary: "Weekly rosters, my shifts, shift swaps",
    emptyTitle: "No schedules yet",
    emptyBody: "Weekly rosters are built from shift templates and published to staff here.",
    keywords: ["roster", "shift", "rota", "swap", "my schedule"],
  },
  claims: {
    id: "claims",
    label: "Claims",
    to: "/claims",
    icon: Receipt,
    summary: "Expense claims and receipts",
    emptyTitle: "No claims yet",
    emptyBody:
      "Expense claims with receipts will be submitted, approved and reimbursed here, through payroll or a separate payment.",
    keywords: ["expense", "reimbursement", "receipt", "transport"],
  },
  documents: {
    id: "documents",
    label: "Documents",
    to: "/documents",
    icon: FileText,
    summary: "Contracts, KETs, letters, passes; acknowledgements",
    emptyTitle: "No documents yet",
    emptyBody: "Contracts, KETs, letters, pass copies and certificates, with expiry reminders and acknowledgements.",
    keywords: ["contract", "letter", "ket", "acknowledge", "certificate", "file"],
  },
  reports: {
    id: "reports",
    label: "Reports",
    to: "/reports",
    icon: BarChart3,
    summary: "Headcount, turnover, payroll cost, leave, attendance, claims",
    emptyTitle: "No reports yet",
    emptyBody:
      "Headcount, turnover, payroll cost, leave, attendance, claims and work-pass reports, with CSV and Excel export.",
    keywords: ["headcount", "turnover", "payroll cost", "export", "excel", "work pass"],
  },
  settings: {
    id: "settings",
    label: "Settings",
    to: "/settings",
    icon: Settings,
    summary: "Organisation, security, sign-in methods",
    emptyTitle: "Settings",
    emptyBody: "Organisation details, sign-in methods, roles and payroll defaults.",
    keywords: ["organisation", "security", "sso", "singpass", "roles", "preferences"],
  },
};

export interface NavGroup {
  label: string | null;
  items: ModuleId[];
}

/** Admin sidebar, grouped by the job being done. Reports closes the list on its own; Settings sits at the bottom. */
export const NAV_GROUPS: NavGroup[] = [
  { label: null, items: ["home", "inbox"] },
  { label: "People", items: ["people", "documents"] },
  { label: "Time", items: ["leave", "attendance", "schedules"] },
  { label: "Pay", items: ["payroll", "claims"] },
  { label: null, items: ["reports"] },
];

/** Employee bottom tab bar on mobile (< 768px). */
export const EMPLOYEE_TABS: { id: ModuleId; label: string; to?: string }[] = [
  { id: "home", label: "Home" },
  { id: "schedules", label: "Shifts", to: "/schedules/me" },
  { id: "leave", label: "Leave" },
  { id: "claims", label: "Claims" },
  // Straight to the payslips: "/payroll" redirects employees there, and the tab wouldn't show as current.
  { id: "payroll", label: "Payslips", to: "/me/payslips" },
];
