import { type App, type AppDeps, schema, tick } from "@crowhr/core";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { SeedClock } from "../clock.ts";
import { seedDocuments } from "./documents.ts";
import type { SeedClient, seedHttp } from "./http.ts";
import { seedOperations } from "./operations.ts";
import type { DemoPeople } from "./people.ts";
import { receiptPng } from "./receipt.ts";

/**
 * July to October 2026 at Kopi Kaki, step by step, as the people involved. Each month the payroll
 * admin prepares the run with that month's items, the owner approves it in her Inbox, payslips are
 * released and the run is marked paid. Claims are filed, approved (manager, then HR) and reimbursed
 * by the next run. October ends with a computed draft run and work waiting for every persona.
 */
export interface HistoryInput {
  deps: AppDeps;
  app: App;
  clock: SeedClock;
  http: ReturnType<typeof seedHttp>;
  people: DemoPeople;
  members: Record<string, string>;
  resignLeaver: () => Promise<void>;
}

interface Task {
  taskId: string;
  subjectType: string;
  title: string;
}

type ItemInput = Record<string, unknown> & { employeeId: string; kind: string; label: string };

export async function seedHistory(h: HistoryInput): Promise<Record<string, string>> {
  const { clock, http, people, members, deps } = h;
  const e = people.employees as Record<string, string>;
  const as = async (who: string) => {
    const id = members[who];
    if (!id) throw new Error(`No seeded member ${who}`);
    return http.as(id);
  };
  const sweep = () => tick(deps, clock.now());

  clock.set("2026-06-23T09:30");
  await closeHistoricalChecklists(deps, people, [e.joiner, e.intern]);

  // Settings, as the people responsible.
  clock.set("2026-06-24T10:00");
  const payroll = await as("payroll");
  await payroll.put("/api/v1/payroll/settings", {
    cutoffDay: 20,
    payDay: 31, // the last day of the month (30 in 30-day months)
    fwlSector: "SERVICES",
    fwlTier: "TIER_1",
    fwlSkill: "BASIC_SKILLED",
    debitBankBic: "DBSSSGSG",
    debitAccountNumber: "0720123456",
    debitAccountName: "Kopi Kaki Pte. Ltd.",
  });
  // Payroll → Allowance treatment, set once: the fixed shift allowance is part of the gross rate of
  // pay, the transport allowance (a travelling allowance) is not. Unset, every run would warn.
  const allowances = await payroll.get<{
    items: { allowanceTypeId: string; code: string; cpfLiable: boolean; prorate: boolean }[];
  }>("/api/v1/payroll/allowance-settings");
  for (const a of allowances.items) {
    await payroll.put(`/api/v1/payroll/allowance-settings/${a.allowanceTypeId}`, {
      cpfLiable: a.cpfLiable,
      prorate: a.prorate,
      grossRateIncluded: a.code === "SHIFT",
    });
  }
  const hr = await as("hr");
  await hr.post("/api/v1/claims/types/starter", {});

  /**
   * Ticks off open items of someone's onboarding or offboarding checklist, each by the person it is
   * assigned to (`manager`: the member acting as their manager), for the roles in `roles`. Everyone
   * the seed hires or lets go is a Singapore citizen, so a work-pass item is skipped with a reason.
   */
  const tickChecklist = async (
    employeeId: string | undefined,
    kind: "onboarding" | "offboarding",
    manager: string,
    roles: readonly string[],
  ) => {
    if (!employeeId) throw new Error("No such person in the seed");
    const lists = await (await as("hr")).get<{
      items: { kind: string; items: { id: string; title: string; assigneeRole: string; status: string }[] }[];
    }>(`/api/v1/employees/${employeeId}/checklists`);
    const by: Record<string, string> = { hr_admin: "hr", payroll_admin: "payroll", manager };
    for (const item of lists.items.filter((l) => l.kind === kind).flatMap((l) => l.items)) {
      if (item.status !== "open" || !roles.includes(item.assigneeRole)) continue;
      await (await as(by[item.assigneeRole] ?? "owner")).post(
        `/api/v1/people/checklist-items/${item.id}`,
        /work pass/i.test(item.title)
          ? { action: "skip", reason: "Singapore citizen: no work pass to cancel." }
          : { action: "done" },
      );
    }
  };
  // Farhan's last day was 30 June, before the months this demo shows: his offboarding was done then,
  // not left on everyone's Home as work four months overdue.
  clock.set("2026-06-30T17:30");
  await tickChecklist(e.former, "offboarding", "tp_lead", ["hr_admin", "payroll_admin", "manager"]);
  const types = await hr.get<{ items: { id: string; code: string }[] }>("/api/v1/claims/types");
  const typeId = (code: string) => {
    const t = types.items.find((x) => x.code === code);
    if (!t) throw new Error(`No claim type ${code}`);
    return t.id;
  };

  const claim = async (
    who: string,
    title: string,
    lines: { type: string; date: string; merchant: string; description: string; cents: number; receipt?: boolean }[],
    submit = true,
  ) => {
    const c = await as(who);
    const out = [];
    for (const l of lines) {
      const receiptIds: string[] = [];
      if (l.receipt) {
        const file = await c.upload<{ id: string }>(
          `/api/v1/claims/receipts?fileName=${encodeURIComponent(`${l.merchant.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}.png`)}`,
          await receiptPng(l.merchant, l.cents, l.date),
          "image/png",
        );
        receiptIds.push(file.id);
      }
      out.push({
        claimTypeId: typeId(l.type),
        expenseDate: l.date,
        merchant: l.merchant,
        description: l.description,
        currency: "SGD",
        amountMinor: l.cents,
        receiptIds,
      });
    }
    return c.post<{ id: string }>("/api/v1/claims", { title, lines: out, submit });
  };

  const decideAll = async (
    who: string,
    match: (t: Task) => boolean,
    decision: "approve" | "reject",
    comment?: string,
  ) => {
    const c = await as(who);
    const tasks = await c.get<{ items: Task[] }>("/api/v1/approvals/tasks");
    const picked = tasks.items.filter(match);
    for (const t of picked) {
      await c.post(`/api/v1/approvals/tasks/${t.taskId}/decision`, { decision, comment: comment ?? null });
    }
    return picked.length;
  };

  /**
   * Kopi Kaki moved to Crow HR in July 2026, so its January to June figures come from the previous
   * payroll system, through People → Import → Year-to-date balances (the import an install uses).
   * The figures are fictional: each person's July pay (ordinary wages, CPF, SHG) for every month
   * they were employed from January to June, with no bonuses. With them in place, payroll has the
   * whole year for the AW ceiling and IR8A, and no run warns that January to June are missing.
   */
  const importOpeningBalances = async (julyRunId: string) => {
    const prep = await as("payroll");
    const view = await prep.get<{ rows: { employeeId: string; employeeNumber: string }[] }>(
      `/api/v1/payroll/runs/${julyRunId}`,
    );
    const dollars = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
    const lines = ["employee_number,year,through_month,ow_ytd,ow_cpf_ytd,aw_ytd,cpf_ee_ytd,cpf_er_ytd,shg_ytd"];
    for (const row of view.rows) {
      const d = await prep.get<{
        input: { employment?: { hireDate?: string } } | null;
        result: {
          totals: { grossCents: number; cpfEmployeeCents: number; cpfEmployerCents: number; shgCents: number };
          cpf: { owSubjectCents: number } | null;
        } | null;
      }>(`/api/v1/payroll/runs/${julyRunId}/employees/${row.employeeId}`);
      const hire = d.input?.employment?.hireDate ?? "2026-01-01";
      // Months employed from January to June 2026 (the month of a mid-month hire counts).
      const months = hire >= "2026-07-01" ? 0 : hire < "2026-01-01" ? 6 : 7 - Number(hire.slice(5, 7));
      if (!d.result || months === 0) continue;
      const t = d.result.totals;
      const times = (c: number) => dollars(c * months);
      lines.push(
        [
          row.employeeNumber,
          "2026",
          "2026-06",
          times(t.grossCents),
          times(d.result.cpf?.owSubjectCents ?? 0),
          "0.00",
          times(t.cpfEmployeeCents),
          times(t.cpfEmployerCents),
          times(t.shgCents),
        ].join(","),
      );
    }
    const preview = await prep.post<{ jobId: string; canCommit: boolean; errors?: unknown }>(
      "/api/v1/people/imports/ytd/preview",
      { fileName: "ytd-jan-jun-2026.csv", content: `${lines.join("\n")}\n` },
    );
    if (!preview.canCommit) throw new Error(`YTD import has errors: ${JSON.stringify(preview).slice(0, 2000)}`);
    await prep.post(`/api/v1/people/imports/${preview.jobId}/commit`, {});
  };

  const runMonth = async (month: string, items: ItemInput[], close = true) => {
    const [y, m] = month.split("-");
    const at = (day: number, time: string) => clock.set(`${y}-${m}-${String(day).padStart(2, "0")}T${time}`);
    at(21, "10:00");
    const prep = await as("payroll");
    const run = await prep.post<{ id: string }>("/api/v1/payroll/runs", { kind: "regular", month });
    for (const item of items) await prep.post(`/api/v1/payroll/runs/${run.id}/items`, item);
    at(21, "11:30");
    await prep.post(`/api/v1/payroll/runs/${run.id}/compute`, {});
    if (month === "2026-07") {
      // The first run warns that January to June are missing: the payroll admin imports them and recomputes.
      at(21, "11:50");
      await importOpeningBalances(run.id);
      at(21, "12:05");
      await prep.post(`/api/v1/payroll/runs/${run.id}/compute`, {});
    }
    if (!close) return run.id;
    at(22, "09:15");
    const submitter = await as("payroll");
    await submitter.post(`/api/v1/payroll/runs/${run.id}/submit`, {}).catch(async (err: unknown) => {
      const view = await submitter.get<{ issues?: unknown }>(`/api/v1/payroll/runs/${run.id}`);
      throw new Error(`${String(err)}\nIssues: ${JSON.stringify(view.issues).slice(0, 2000)}`);
    });
    at(22, "16:40");
    const approved = await decideAll("owner", (t) => t.subjectType === "payroll_run", "approve");
    if (approved !== 1) throw new Error(`Expected one payroll approval for ${month}, found ${approved}`);
    at(27, "09:00");
    await (await as("payroll")).post(`/api/v1/payroll/runs/${run.id}/release`, {});
    at(new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate(), "10:30");
    await (await as("payroll")).post(`/api/v1/payroll/runs/${run.id}/mark-paid`, {});
    await sweep();
    return run.id;
  };

  const runs: Record<string, string> = {};
  const hours = (employeeId: string | undefined, h: number) =>
    employeeId ? [{ employeeId, kind: "hours", label: "Hours worked", minutes: h * 60 }] : [];
  const ot = (employeeId: string | undefined, minutes: number) =>
    employeeId ? [{ employeeId, kind: "overtime", label: "Overtime", minutes }] : [];
  const roster = (employeeId: string | undefined, scheduled: number, worked: number) =>
    employeeId
      ? [
          { employeeId, kind: "scheduled_days", label: "Scheduled days", days: scheduled },
          { employeeId, kind: "days_worked", label: "Days worked", days: worked },
        ]
      : [];
  /** Applies for leave as the employee (leave module, approved by their manager by default). */
  const leave = async (who: string, code: string, startDate: string, endDate: string, reason: string) => {
    const c = await as(who);
    const types = await c.get<{ items: { id: string; code: string }[] }>("/api/v1/leave/types");
    const type = types.items.find((t) => t.code === code);
    if (!type) throw new Error(`No leave type ${code}`);
    return c.post<{ id: string }>("/api/v1/leave/requests", { leaveTypeId: type.id, startDate, endDate, reason });
  };

  // ---- July 2026 -------------------------------------------------------------------------
  clock.set("2026-07-08T19:20");
  await claim("employee", "Late close, taxi home", [
    {
      type: "TRANSPORT",
      date: "2026-07-07",
      merchant: "ComfortDelGro",
      description: "Taxi after closing",
      cents: 1_860,
    },
  ]);
  clock.set("2026-07-09T09:10");
  await decideAll("tp_lead", (t) => t.subjectType === "claim", "approve");
  clock.set("2026-07-09T14:00");
  await decideAll("hr", (t) => t.subjectType === "claim", "approve");
  runs["2026-07"] = await runMonth("2026-07", [
    ...hours(e.pt1, 88),
    ...ot(e.barista1, 5 * 60),
    ...ot(e.spass_muslim, 3 * 60),
  ]);

  // ---- August 2026 -----------------------------------------------------------------------
  clock.set("2026-08-04T12:40");
  await claim("hr", "Clinic visit", [
    {
      type: "MEDICAL",
      date: "2026-08-03",
      merchant: "Raffles Medical",
      description: "GP consultation",
      cents: 4_500,
      receipt: true,
    },
  ]);
  clock.set("2026-08-05T10:00");
  await decideAll("owner", (t) => t.subjectType === "claim", "approve");
  clock.set("2026-08-05T15:00");
  await decideAll("hr", (t) => t.subjectType === "claim", "approve");
  clock.set("2026-08-12T18:05");
  await claim("manager", "Outlet supplies run", [
    {
      type: "TRANSPORT",
      date: "2026-08-12",
      merchant: "Grab",
      description: "Grab to Jurong Point with stock",
      cents: 2_430,
      receipt: true,
    },
  ]);
  clock.set("2026-08-13T09:00");
  await decideAll("opsmgr", (t) => t.subjectType === "claim", "approve");
  clock.set("2026-08-13T11:00");
  await decideAll("hr", (t) => t.subjectType === "claim", "approve");
  clock.set("2026-08-14T16:20");
  await leave("employee", "annual", "2026-08-24", "2026-08-25", "Family trip to Penang");
  clock.set("2026-08-15T09:05");
  await decideAll("tp_lead", (t) => t.subjectType === "leave", "approve");
  runs["2026-08"] = await runMonth("2026-08", [
    ...hours(e.pt1, 96),
    ...ot(e.barista1, 4 * 60 + 30),
    ...ot(e.wp, 2 * 60),
    {
      employeeId: e.opsmgr as string,
      kind: "bonus",
      label: "National Day bonus",
      amountCents: 50_000,
      wageClass: "AW",
      awPayableDate: "2026-08-31",
    },
  ]);

  // ---- September 2026 --------------------------------------------------------------------
  clock.set("2026-09-03T08:45");
  await claim("employee", "Barista course materials", [
    {
      type: "TRANSPORT",
      date: "2026-09-02",
      merchant: "SBS Transit",
      description: "Bus to SkillsFuture course",
      cents: 640,
    },
  ]);
  clock.set("2026-09-03T13:00");
  await decideAll(
    "tp_lead",
    (t) => t.subjectType === "claim",
    "reject",
    "Course travel is covered by the training budget. Ask Aisyah to book it there.",
  );
  clock.set("2026-09-04T10:15");
  await leave("barista2", "annual", "2026-09-14", "2026-09-15", "Cousin's wedding");
  clock.set("2026-09-04T18:30");
  await decideAll("manager", (t) => t.subjectType === "leave", "approve");
  clock.set("2026-09-16T17:30");
  await h.resignLeaver();
  runs["2026-09"] = await runMonth("2026-09", [
    ...hours(e.pt1, 84),
    ...ot(e.barista1, 4 * 60),
    ...ot(e.spass_muslim, 3 * 60),
    ...roster(e.barista2, 26, 26),
  ]);

  // ---- October 2026 (the current month) ---------------------------------------------------
  clock.set("2026-10-06T19:00");
  await claim("opsmgr", "Supplier lunch, Q4 menu tasting", [
    {
      type: "ENTERTAINMENT",
      date: "2026-10-06",
      merchant: "Tiong Bahru Bakery",
      description: "Lunch with coffee bean supplier (3 pax)",
      cents: 8_640,
      receipt: true,
    },
  ]);
  clock.set("2026-10-07T08:50");
  await leave("payroll", "annual", "2026-10-15", "2026-10-16", "Long weekend");
  clock.set("2026-10-07T09:30");
  await decideAll("owner", (t) => t.subjectType === "claim" || t.subjectType === "leave", "approve");
  clock.set("2026-10-07T11:00");
  await decideAll("hr", (t) => t.subjectType === "claim", "approve");

  const outletScheduledDays = await seedOperations(h);

  // Darren's first day, 12 Oct: his bank details came with his hire record and his accounts were set
  // up that morning. HR's and his own items follow during the month.
  clock.set("2026-10-12T17:00");
  await tickChecklist(e.joiner, "onboarding", "owner", ["payroll_admin", "manager"]);
  // Priyanka's last day was 16 Oct: the owner collected her things and HR closed their items that
  // evening. Her final pay stays open for payroll: it goes out with the October run, still a draft
  // (see its warning).
  clock.set("2026-10-16T18:00");
  await tickChecklist(e.leaver_oct, "offboarding", "owner", ["hr_admin", "manager"]);

  // The October run: computed draft, not yet submitted (the payroll admin's next step).
  runs["2026-10"] = await runMonth(
    "2026-10",
    [
      ...hours(e.pt1, 92),
      {
        employeeId: e.chef as string,
        kind: "bonus",
        label: "Deepavali bonus",
        amountCents: 120_000,
        wageClass: "AW",
        awPayableDate: "2026-10-31",
      },
      {
        employeeId: e.opsmgr as string,
        kind: "commission",
        label: "Catering commission (Q3)",
        amountCents: 250_000,
        wageClass: "AW",
        awPayableDate: "2026-10-31",
      },
      // Full-month staff use the roster feed. Core requires explicit full-month denominators
      // for joiners/leavers; days worked still come directly from their clock-ins.
      ...[e.joiner, e.leaver_oct].map((employeeId) => ({
        employeeId: employeeId as string,
        kind: "scheduled_days",
        label: "Published outlet days (full month)",
        days: outletScheduledDays,
      })),
      { employeeId: e.barista2 as string, kind: "unpaid_leave", label: "No-pay leave", days: 2 },
      {
        employeeId: e.barista1 as string,
        kind: "deduction",
        label: "Broken grinder burr (after inquiry)",
        amountCents: 6_000,
        deductionCategory: "damage_loss",
      },
    ],
    false,
  );

  // Waiting with HR (second step): Siti's claim, approved by Rajesh.
  clock.set("2026-10-28T20:15");
  await claim("manager", "Team meal after stocktake", [
    {
      type: "MEALS",
      date: "2026-10-28",
      merchant: "Jurong Point food court",
      description: "Dinner for 4 after stocktake",
      cents: 5_280,
      receipt: true,
    },
  ]);
  clock.set("2026-10-29T09:00");
  await decideAll("opsmgr", (t) => t.subjectType === "claim", "approve");

  // Waiting for the owner: Chloe's phone bill. For the manager: Maria's and Hafiz's claims.
  clock.set("2026-10-29T10:20");
  await claim("payroll", "Mobile phone, October", [
    {
      type: "PHONE",
      date: "2026-10-25",
      merchant: "Singtel",
      description: "October mobile bill (work line)",
      cents: 4_800,
      receipt: true,
    },
  ]);
  clock.set("2026-10-29T21:40");
  await claim("spass", "Taxi after late shift", [
    {
      type: "TRANSPORT",
      date: "2026-10-29",
      merchant: "ComfortDelGro",
      description: "Taxi home after 11 pm close",
      cents: 2_150,
      receipt: true,
    },
  ]);
  clock.set("2026-10-30T08:05");
  await claim("barista2", "Clinic visit", [
    {
      type: "MEDICAL",
      date: "2026-10-29",
      merchant: "Healthway Medical",
      description: "GP visit, flu",
      cents: 3_800,
      receipt: true,
    },
  ]);
  // The employee persona: one claim waiting with his manager, one draft he hasn't sent.
  clock.set("2026-10-30T12:30");
  await claim("employee", "Milk run for the outlet", [
    {
      type: "TRANSPORT",
      date: "2026-10-30",
      merchant: "Grab",
      description: "Grab to pick up milk delivery shortfall",
      cents: 1_420,
    },
  ]);
  await claim(
    "employee",
    "Lunch with new trainee",
    [
      {
        type: "MEALS",
        date: "2026-10-30",
        merchant: "Kopitiam",
        description: "Lunch while training Darren",
        cents: 920,
      },
    ],
    false,
  );

  // Leave waiting for approval: Aisyah's with the owner, Hafiz's with the manager, Jun Jie's with Wei Ming.
  clock.set("2026-10-29T17:40");
  await leave("hr", "annual", "2026-11-02", "2026-11-03", "Hari Raya visiting (late)");
  clock.set("2026-10-30T09:20");
  await leave("barista2", "annual", "2026-11-23", "2026-11-25", "Trip to Bintan");
  clock.set("2026-10-30T13:00");
  await leave("employee", "annual", "2026-12-28", "2026-12-29", "Year-end break");

  // Profile change requests: a bank change for the payroll admin, a name change for HR.
  clock.set("2026-10-30T15:10");
  await (await as("employee")).post("/api/v1/people/me/change-requests", {
    bank: { bankCode: "OCBCSGSG", accountNumber: "5501234567", holderName: "Goh Jun Jie" },
    note: "Moved my salary account to OCBC.",
  });
  clock.set("2026-10-30T16:45");
  await (await as("spass")).post("/api/v1/people/me/change-requests", {
    personal: { legalName: "Maria Santos Reyes-Cruz" },
    note: "Married in September; marriage certificate available on request.",
  });

  await seedDocuments(h);

  clock.set("2026-10-30T23:00");
  await sweep();
  return runs;
}

/**
 * Onboarding checklists come with every hire, including the ones core's people seed backdates to
 * 2019–2025. For people already working here they were finished long ago, so they are closed in
 * one statement (dated at the seed's start) instead of ~100 one-by-one completions that would
 * slow the first load. The October joiner's and the scheduled intern's stay open: those are HR's
 * real to-dos this month. The leaver's offboarding checklist is untouched.
 */
async function closeHistoricalChecklists(deps: AppDeps, people: DemoPeople, keepOpen: (string | undefined)[]) {
  const keep = keepOpen.filter((id): id is string => !!id);
  const historical = deps.db
    .select({ id: schema.checklists.id })
    .from(schema.checklists)
    .where(
      and(
        eq(schema.checklists.orgId, people.orgId),
        eq(schema.checklists.kind, "onboarding"),
        keep.length ? notInArray(schema.checklists.employeeId, keep) : undefined,
      ),
    );
  await deps.db
    .update(schema.checklistItems)
    .set({ status: "done", doneAt: deps.clock.now() })
    .where(
      and(
        eq(schema.checklistItems.orgId, people.orgId),
        eq(schema.checklistItems.status, "open"),
        inArray(schema.checklistItems.checklistId, historical),
      ),
    );
}

export type { SeedClient };
