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
    summary: "Shifts and rosters",
    emptyTitle: "No schedules yet",
    emptyBody: "Shift patterns and weekly rosters will be planned and published to staff here.",
    keywords: ["roster", "shift", "rota"],
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
    summary: "Contracts, letters, policies",
    emptyTitle: "No documents yet",
    emptyBody: "Employment contracts, letters, policies and pass copies will be stored and shared with staff here.",
    keywords: ["contract", "letter", "policy", "file"],
  },
  reports: {
    id: "reports",
    label: "Reports",
    to: "/reports",
    icon: BarChart3,
    summary: "Payroll, CPF and headcount reports",
    emptyTitle: "No reports yet",
    emptyBody:
      "Payroll summaries, CPF submissions, IR8A and headcount reports will be generated here from your own data.",
    keywords: ["ir8a", "cpf report", "export", "headcount"],
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

/** Admin sidebar, grouped by the job being done. Settings sits at the bottom. */
export const NAV_GROUPS: NavGroup[] = [
  { label: null, items: ["home", "inbox"] },
  { label: "People", items: ["people", "documents"] },
  { label: "Time", items: ["leave", "attendance", "schedules"] },
  { label: "Pay", items: ["payroll", "claims"] },
  { label: "Insights", items: ["reports"] },
];

/** Employee bottom tab bar on mobile (< 768px). */
export const EMPLOYEE_TABS: { id: ModuleId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "leave", label: "Leave" },
  { id: "claims", label: "Claims" },
  { id: "payroll", label: "Payslips" },
];
