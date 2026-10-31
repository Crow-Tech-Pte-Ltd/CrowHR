/**
 * FIXTURE — sample data for the Home inbox layout. Not real, not from the API.
 * Amounts are integer cents. The "today" anchor is fixed so screenshots are stable.
 */
export const FIXTURE_TODAY = "2026-10-31";

export const samplePayrollRun = {
  period: "October 2026",
  status: "review" as const,
  payDate: "2026-11-06",
  employees: 24,
  grossCents: 11_842_000,
  netCents: 9_731_455,
  changesSinceLastRun: 3,
};

export type ApprovalKind = "leave" | "claim" | "timesheet";

export interface SampleApproval {
  id: string;
  kind: ApprovalKind;
  employee: string;
  team: string;
  detail: string;
  submitted: string;
  /** Days for leave, cents for claims, hours ×100 for timesheets. */
  quantity: { unit: "days"; value: number } | { unit: "cents"; value: number } | { unit: "hours"; value: number };
}

export const sampleApprovals: SampleApproval[] = [
  {
    id: "a1",
    kind: "leave",
    employee: "Tan Wei Ming",
    team: "Outlet · Tiong Bahru",
    detail: "Annual leave, 4–6 Nov",
    submitted: "2026-10-29",
    quantity: { unit: "days", value: 3 },
  },
  {
    id: "a2",
    kind: "claim",
    employee: "Priya Raman",
    team: "Operations",
    detail: "Supplier visit, Grab rides",
    submitted: "2026-10-30",
    quantity: { unit: "cents", value: 8_640 },
  },
  {
    id: "a3",
    kind: "timesheet",
    employee: "Muhammad Hafiz",
    team: "Outlet · Joo Chiat",
    detail: "Week 44 overtime",
    submitted: "2026-10-31",
    quantity: { unit: "hours", value: 650 },
  },
  {
    id: "a4",
    kind: "leave",
    employee: "Lim Jia Hui",
    team: "Finance",
    detail: "Childcare leave, 12 Nov",
    submitted: "2026-10-31",
    quantity: { unit: "days", value: 1 },
  },
];

export interface SamplePass {
  id: string;
  employee: string;
  passType: "EP" | "S Pass" | "Work Permit";
  fin: string;
  expires: string;
}

export const samplePasses: SamplePass[] = [
  { id: "p1", employee: "Nguyen Van An", passType: "Work Permit", fin: "G7654321K", expires: "2026-11-18" },
  { id: "p2", employee: "Rajesh Kumar", passType: "S Pass", fin: "F2345678N", expires: "2026-12-12" },
  { id: "p3", employee: "Chen Xiao Li", passType: "EP", fin: "M3456789L", expires: "2027-01-09" },
];

export const sampleUpcoming = [
  { id: "u1", label: "Probation ends", employee: "Daniel Goh", date: "2026-11-03" },
  { id: "u2", label: "Starts work", employee: "Siti Rahmah", date: "2026-11-09" },
  { id: "u3", label: "Contract renewal", employee: "Kevin Ong", date: "2026-11-30" },
];

/** Employee-view fixtures. */
export const sampleEmployeeTasks = [
  { id: "e1", title: "Submit October claims", detail: "Claims close on 5 Nov", due: "2026-11-05" },
  { id: "e2", title: "Confirm your bank account", detail: "Needed before your first payslip", due: "2026-11-02" },
];

export const sampleEmployeeRequests = [
  { id: "r1", title: "Annual leave, 4–6 Nov", status: "pending" as const },
  { id: "r2", title: "Claim: client lunch", status: "approved" as const },
];

export const samplePeople = [
  "Tan Wei Ming",
  "Priya Raman",
  "Muhammad Hafiz",
  "Lim Jia Hui",
  "Nguyen Van An",
  "Rajesh Kumar",
  "Chen Xiao Li",
  "Daniel Goh",
];
