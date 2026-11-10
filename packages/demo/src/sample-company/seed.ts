import {
  type AppDeps,
  createApp,
  createMemoryFileStore,
  type Db,
  type FileStore,
  type Logger,
  noopLogger,
  type PasswordHasher,
  schema,
  tick,
} from "@crowhr/core";
import { eq } from "drizzle-orm";
import { movableSeedClock, type SeedClock } from "../clock.ts";
import { createDemoDeps } from "../deps.ts";
import { DEMO_PASSWORD, OTHER_MEMBERS, PERSONAS } from "../personas.ts";
import { singaporeDate } from "../seed/dates.ts";
import { type SeedResult, seedDemo } from "../seed/index.ts";
import { DEMO_ORG } from "../seed/people.ts";
import { receiptPng } from "../seed/receipt.ts";
import { type MemberClient, memberClient } from "./client.ts";
import { assertOrganisationIsNew, type CopyReport, copyOrganisation } from "./copy-organisation.ts";

/**
 * The sample company for a real Crow HR server (App Store / Google Play review, sales demos):
 * the public demo's fictional café group Kopi Kaki Pte. Ltd., seeded by the demo's own seed
 * (people through the people services, four months of history through the public API), then
 * brought up to the real date the same way: October's payroll is approved and released, rosters
 * are published for the coming weeks, last week's shifts are clocked, and fresh requests wait for
 * the reviewer's manager account. Then every account gets its own random password, the
 * placeholder single sign-on methods are removed, and the scheduled sweep runs once at the real
 * time.
 *
 * All of that happens in a scratch database (the sweeps are install-wide, so they must never run
 * with a seed clock against a server that hosts other organisations). The finished organisation
 * is then copied into the server's database in one transaction (copy-organisation.ts), refusing
 * if the slug or any of its email addresses already exists.
 */

export const SAMPLE_ORG = DEMO_ORG;

/**
 * The two accounts store reviewers use: Hafiz, a barista at Jurong Point, and his line manager
 * Siti (the demo's Manager persona). Not the demo's Employee persona, Jun Jie: his manager
 * changes on 1 Dec 2026 (a scheduled transfer to Jurong Point), so his requests would reach a
 * different manager depending on the review date.
 */
export const REVIEWER_KEYS = { employee: "barista2", manager: "manager" } as const;

export interface SampleAccount {
  /** Persona key (owner, hr, payroll, manager, employee) or the people key of other members. */
  key: string;
  label: string;
  name: string;
  email: string;
  password: string;
  roles: string[];
  reviewer: "employee" | "manager" | null;
}

export interface PrepareInput {
  /** An empty, migrated database used only for seeding (in-memory PGlite in the script). */
  scratch: Db;
  /** The server's encryption key, so the server can read NRIC, bank and SSO fields. */
  secretKey: Uint8Array;
  /** The server's password hasher (argon2id). */
  passwordHasher: PasswordHasher;
  /** The server's PUBLIC_URL. */
  publicUrl: string;
  /** Real time (injected in tests). Must be in November 2026 or later. */
  now?: Date;
  logger?: Logger;
  progress?: (message: string) => void;
  /** Random password source (injected in tests). */
  newPassword?: () => string;
}

export interface PreparedSampleCompany {
  orgId: string;
  scratch: Db;
  accounts: SampleAccount[];
  /** Files written by the seed (receipts, documents), to copy into the server's file storage. */
  files: Map<string, { data: Uint8Array; contentType: string }>;
  /** Facts checked in the scratch database before anything is copied. */
  checks: SampleChecks;
}

export interface SampleChecks {
  today: string;
  employeePayslips: number;
  employeeLeaveTypes: number;
  /** Mondays from this week through eight weeks ahead with at least one shift for the employee. */
  rosterWeeks: { weekStart: string; shifts: number }[];
  managerPendingTasks: number;
  ssoProviders: number;
  attendanceLocationMode: string;
}

const API = "/api/v1";
const DAY_MS = 86_400_000;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
/** Monday of the ISO week containing `date`. */
const mondayOf = (date: string) => addDays(date, -((new Date(`${date}T00:00Z`).getUTCDay() + 6) % 7));
const sgLocal = (at: Date) => new Date(at.getTime() + 8 * 3600_000).toISOString().slice(0, 16);

/** 16 characters from a 32-letter alphabet (80 bits), grouped for typing on a phone: `k7mq-2xwp-9fde-h3ta`. */
export function randomPassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map((b) => alphabet[b & 31]).join("");
  return chars.match(/.{4}/g)?.join("-") ?? chars;
}

/** Every email address the sample company uses (they must all be new on the target server). */
export function sampleEmails(): string[] {
  return [...PERSONAS.map((p) => p.email), ...OTHER_MEMBERS.map((m) => m.email)];
}

/** Refuses when the server already has the sample company or one of its email addresses. */
export function assertCanInstall(target: Db) {
  return assertOrganisationIsNew(target, { slug: SAMPLE_ORG.slug }, sampleEmails());
}

function recordingFileStore() {
  const inner = createMemoryFileStore();
  const files = new Map<string, { data: Uint8Array; contentType: string }>();
  const store: FileStore = {
    async put(key, data, meta) {
      const stored = await inner.put(key, data, meta);
      files.set(key, { data: data.slice(), contentType: meta.contentType });
      return stored;
    },
    get: (key) => inner.get(key),
    async delete(key) {
      files.delete(key);
      await inner.delete(key);
    },
  };
  return { store, files };
}

/** Seeds Kopi Kaki into `scratch` and brings it up to `now`. Touches nothing else. */
export async function prepareSampleCompany(input: PrepareInput): Promise<PreparedSampleCompany> {
  const now = input.now ?? new Date();
  const today = singaporeDate(now);
  if (today < "2026-11-01") throw new Error("The sample company's history runs to 31 Oct 2026; run this later.");
  const progress = input.progress ?? (() => undefined);
  const { scratch } = input;
  if ((await scratch.select({ id: schema.organisations.id }).from(schema.organisations)).length) {
    throw new Error("The scratch database must be empty.");
  }

  const clock = movableSeedClock("2026-06-22T01:00:00.000Z");
  const { store, files } = recordingFileStore();
  const demoDeps = createDemoDeps({
    db: scratch,
    clock,
    fileStore: store,
    // Replaced below: no mailer at all, so nothing is queued (as on a server without SMTP).
    mailer: { send: async () => undefined },
    secretKey: input.secretKey,
    publicUrl: input.publicUrl,
    logger: input.logger ?? noopLogger,
  });
  // demoMode stays on in this in-process app only: the seed acts as each person through the demo
  // persona sign-in. The real server never has it, and nothing it changes is stored.
  const { mailer: _none, ...rest } = demoDeps;
  const deps: AppDeps = { ...rest, passwordHasher: input.passwordHasher };

  progress("Seeding Kopi Kaki's history (June to October 2026)");
  const seed = await seedDemo(deps, clock, input.publicUrl);
  const app = createApp(deps);
  const clients = new Map<string, MemberClient>();
  /** One browser-like client per person, reused across calls (it signs in again when needed). */
  const member: Member = (key, options) => {
    const id = seed.members[key];
    if (!id) throw new Error(`No seeded member ${key}`);
    let client = clients.get(key);
    if (!client || options?.fresh) {
      client = memberClient(app, input.publicUrl, () => clock.now().getTime(), id);
      clients.set(key, client);
    }
    return client;
  };

  progress("Closing October's payroll");
  await closeOctoberPayroll(deps, clock, seed, member);

  progress("Publishing rosters for the coming weeks");
  await publishRosters(clock, seed, member, today);

  progress("Clocking last week's shifts");
  await clockPastShifts(clock, member, now);

  progress("Filing new requests for the manager account");
  await fileFreshRequests(clock, member, now);

  progress("Removing the placeholder single sign-on methods; checking security and attendance settings");
  clock.set(sgLocal(new Date(now.getTime() - 30 * 60_000)));
  await tidySettings(member);

  progress("Giving every account its own password");
  clock.set(sgLocal(new Date(now.getTime() - 20 * 60_000)));
  const accounts = await setPasswords(deps, seed, member, input.newPassword ?? randomPassword);

  progress("Running the scheduled sweep at the real time");
  clock.set(sgLocal(new Date(now.getTime() - 60_000)));
  for (let i = 0; i < 2; i++) {
    const report = await tick(deps, now);
    if (report.errors.length) throw new Error(`Scheduled sweep failed: ${report.errors.join("; ")}`);
  }

  const checks = await checkPrepared(member, today);
  return { orgId: seed.orgId, scratch, accounts, files, checks };
}

export interface InstallResult {
  copy: CopyReport;
  files: number;
}

/**
 * Copies the prepared company into the server: files first (new keys only), then every row in
 * one transaction. On failure the copied files are removed again and the database is unchanged.
 */
export async function installSampleCompany(
  prepared: PreparedSampleCompany,
  target: Db,
  fileStore: FileStore,
): Promise<InstallResult> {
  await assertCanInstall(target);
  const written: string[] = [];
  try {
    for (const [key, file] of prepared.files) {
      if (await fileStore.get(key)) throw new Error(`File ${key} already exists in the server's storage.`);
      await fileStore.put(key, file.data, { contentType: file.contentType });
      written.push(key);
    }
    const copy = await copyOrganisation(prepared.scratch, target, prepared.orgId);
    return { copy, files: written.length };
  } catch (err) {
    for (const key of written) await fileStore.delete(key).catch(() => undefined);
    throw err;
  }
}

/** `fresh` starts a new session (for actions that need a recent sign-in). */
type Member = (key: string, options?: { fresh?: boolean }) => MemberClient;
interface Task {
  taskId: string;
  subjectType: string;
  title: string;
  requester: { name: string };
}

async function closeOctoberPayroll(deps: AppDeps, clock: SeedClock, seed: SeedResult, member: Member) {
  const runId = seed.runs["2026-10"];
  if (!runId) throw new Error("The demo seed has no October run");
  const payroll = member("payroll");
  clock.set("2026-10-31T09:00");
  await payroll.post(`${API}/payroll/runs/${runId}/compute`, {});
  clock.set("2026-10-31T09:15");
  await payroll.post(`${API}/payroll/runs/${runId}/submit`, {});
  clock.set("2026-10-31T10:30");
  const owner = member("owner");
  const tasks = await owner.get<{ items: Task[] }>(`${API}/approvals/tasks`);
  const approval = tasks.items.filter((t) => t.subjectType === "payroll_run");
  if (approval.length !== 1) throw new Error(`Expected one October payroll approval, found ${approval.length}`);
  for (const t of approval) {
    await owner.post(`${API}/approvals/tasks/${t.taskId}/decision`, { decision: "approve", comment: null });
  }
  clock.set("2026-10-31T11:00");
  await payroll.post(`${API}/payroll/runs/${runId}/release`, {});
  clock.set("2026-10-31T16:00");
  await payroll.post(`${API}/payroll/runs/${runId}/mark-paid`, {});
  await tick(deps, clock.now());
  await owner.signOut();
  await payroll.signOut();
}

/** Jun Jie's scheduled transfer to Jurong Point (core's seed-people.ts). */
const JUN_JIE_TRANSFER = "2026-12-01";

/**
 * Outlet crews by member key for a week (the October leaver has gone; Jun Jie moves to Jurong
 * Point with his transfer). The index picks the shift template.
 */
function crewsFor(weekStart: string) {
  const moved = weekStart >= JUN_JIE_TRANSFER;
  return [
    { location: "tp", crew: moved ? ["tp_lead", "pt1"] : ["tp_lead", "employee", "pt1"] },
    { location: "jp", crew: moved ? ["manager", "barista2", "spass", "employee"] : ["manager", "barista2", "spass"] },
    { location: "tb", crew: ["tb_lead", "joiner"] },
  ];
}
const ALL_CREW = ["tp_lead", "employee", "pt1", "manager", "barista2", "spass", "tb_lead", "joiner"];
const TEMPLATE_ORDER = ["OPN", "AM", "MID", "PM"];
const employeeKey = (key: string) =>
  (({ employee: "barista1", manager: "jp_lead" }) as Record<string, string>)[key] ?? key;

/** Published weeks from 9 Nov 2026 (the demo seed's last week is 2 Nov) to nine weeks past today. */
async function publishRosters(clock: SeedClock, seed: SeedResult, member: Member, today: string) {
  const hr = member("hr");
  clock.set("2026-11-06T10:00");
  const templates = await hr.get<{ items: { id: string; code: string }[] }>(`${API}/scheduling/templates`);
  const templateId = (index: number) => {
    const t = templates.items.find((x) => x.code === TEMPLATE_ORDER[index]);
    if (!t) throw new Error(`No shift template ${TEMPLATE_ORDER[index]}`);
    return t.id;
  };
  const last = mondayOf(addDays(today, 9 * 7));
  for (let weekStart = "2026-11-09"; weekStart <= last; weekStart = addDays(weekStart, 7)) {
    for (const outlet of crewsFor(weekStart)) {
      const roster = await hr.post<{ id: string }>(`${API}/scheduling/rosters`, {
        weekStart,
        locationId: seed.people.locations[outlet.location],
      });
      for (const [index, who] of outlet.crew.entries()) {
        for (let day = 0; day < 7; day++) {
          // Same pattern as the demo's October weeks: part-timers work three days, Sunday is rest,
          // and supervisors close on Saturdays.
          if (who === "pt1" && ![1, 3, 5, 6].includes(day)) continue;
          const tpl = index === 0 && day === 5 ? 3 : index;
          await hr.post(`${API}/scheduling/rosters/${roster.id}/shifts`, {
            employeeId: seed.people.employees[employeeKey(who)],
            date: addDays(weekStart, day),
            ...(day === 6 ? { kind: "rest" } : { templateId: templateId(tpl) }),
          });
        }
      }
      const view = await hr.get<{ toAcknowledge: { shiftId: string; kind: string }[] }>(
        `${API}/scheduling/rosters/${roster.id}`,
      );
      await hr.post(`${API}/scheduling/rosters/${roster.id}/publish`, {
        acknowledge: view.toAcknowledge.map(({ shiftId, kind }) => ({ shiftId, kind })),
      });
    }
  }
  await hr.signOut();
}

interface MyShift {
  id: string;
  date: string;
  kind: "shift" | "rest";
  start: string | null;
  end: string | null;
}

/** Instant of a shift time that is either `HH:MM` (Singapore, on `date`) or an ISO timestamp. */
function shiftInstant(date: string, value: string): Date {
  return /^\d{2}:\d{2}$/.test(value) ? new Date(`${date}T${value}:00+08:00`) : new Date(value);
}

/** Every crew member clocks in and out of their shifts from 31 Oct to yesterday, on time. */
async function clockPastShifts(clock: SeedClock, member: Member, now: Date) {
  const today = singaporeDate(now);
  const from = "2026-10-31";
  const to = addDays(today, -1);
  if (to < from) return;
  const punches: { who: string; shiftId: string; kind: "in" | "out"; at: Date }[] = [];
  for (const who of ALL_CREW) {
    const client = member(who);
    // Shift lists are limited to 62 days per request.
    for (let start = from; start <= to; start = addDays(start, 62)) {
      const end = [addDays(start, 61), to].sort()[0] as string;
      const mine = await client.get<{ shifts: MyShift[] }>(`${API}/scheduling/me?from=${start}&to=${end}`);
      for (const s of mine.shifts) {
        if (s.kind !== "shift" || !s.start || !s.end) continue;
        const inAt = shiftInstant(s.date, s.start);
        let outAt = shiftInstant(s.date, s.end);
        if (outAt <= inAt) outAt = new Date(outAt.getTime() + DAY_MS);
        if (outAt.getTime() > now.getTime() - 3600_000) continue;
        punches.push({ who, shiftId: s.id, kind: "in", at: inAt }, { who, shiftId: s.id, kind: "out", at: outAt });
      }
    }
  }
  punches.sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const p of punches) {
    clock.set(sgLocal(p.at));
    await member(p.who).post(`${API}/attendance/punches`, {
      kind: p.kind,
      idempotencyKey: `sample-${p.shiftId}-${p.kind}`,
      deviceTime: p.at.toISOString(),
      sentAt: p.at.toISOString(),
      queued: false,
      source: "web",
      location: null,
    });
  }
}

/** New requests from Siti's team, so the manager account has fresh work besides October's. */
async function fileFreshRequests(clock: SeedClock, member: Member, now: Date) {
  const today = singaporeDate(now);
  clock.set(sgLocal(new Date(now.getTime() - 60 * 60_000)));
  // Hafiz: a taxi home after a late close yesterday, with a receipt.
  const hafiz = member("barista2");
  const types = await hafiz.get<{ items: { id: string; code: string }[] }>(`${API}/claims/eligible-types`);
  const transport = types.items.find((t) => t.code === "TRANSPORT");
  if (!transport) throw new Error("No TRANSPORT claim type");
  const yesterday = addDays(today, -1);
  const receipt = await hafiz.upload<{ id: string }>(
    `${API}/claims/receipts?fileName=comfortdelgro-taxi.png`,
    await receiptPng("ComfortDelGro", 2_340, yesterday),
    "image/png",
  );
  await hafiz.post(`${API}/claims`, {
    title: "Taxi home after late close",
    lines: [
      {
        claimTypeId: transport.id,
        expenseDate: yesterday,
        merchant: "ComfortDelGro",
        description: "Taxi home after closing the outlet at 11 pm",
        currency: "SGD",
        amountMinor: 2_340,
        receiptIds: [receipt.id],
      },
    ],
    submit: true,
  });
  await hafiz.signOut();

  // Maria: one day of annual leave about three weeks ahead, on a day she works.
  const maria = member("spass");
  const leaveTypes = await maria.get<{ items: { id: string; code: string }[] }>(`${API}/leave/types`);
  const annual = leaveTypes.items.find((t) => t.code === "annual");
  if (!annual) throw new Error("No annual leave type");
  const mine = await maria.get<{ shifts: MyShift[] }>(
    `${API}/scheduling/me?from=${addDays(today, 18)}&to=${addDays(today, 40)}`,
  );
  let filed = false;
  let lastError: unknown = null;
  for (const s of mine.shifts.filter((x) => x.kind === "shift")) {
    try {
      await maria.post(`${API}/leave/requests`, {
        leaveTypeId: annual.id,
        startDate: s.date,
        endDate: s.date,
        reason: "Renewing my passport at the embassy",
      });
      filed = true;
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!filed) throw new Error(`Could not file Maria's leave: ${String(lastError)}`);
  await maria.signOut();
}

async function tidySettings(member: Member) {
  const owner = member("owner", { fresh: true });
  const security = await owner.get<{ mfaRequiredRoles: string[]; providers: { id: string; displayName: string }[] }>(
    `${API}/security/settings`,
  );
  // The demo's Google, Microsoft and Singpass methods have placeholder client IDs: on a real
  // server their buttons would show and fail.
  for (const p of security.providers) await owner.del(`${API}/security/providers/${p.id}`);
  // The demo personas need no two-step verification (owners are not store reviewer accounts,
  // but the demo is set up this way and the reviewer accounts have no admin roles anyway).
  if (security.mfaRequiredRoles.length) await owner.patch(`${API}/security/settings`, { mfaRequiredRoles: [] });
  await owner.signOut();

  // Clock-in from anywhere: no location requirement, offices or network ranges.
  const hr = member("hr");
  const att = await hr.get<
    Record<string, unknown> & { locationMode: string; offices: unknown[]; allowedIps: unknown[] }
  >(`${API}/attendance/settings`);
  if (att.locationMode !== "off" || att.offices.length || att.allowedIps.length) {
    const { effectivePdpaNotice: _e, ...settings } = att;
    await hr.put(`${API}/attendance/settings`, {
      ...settings,
      locationMode: "off",
      offices: [],
      locationEnforcement: "flag",
      allowedIps: [],
      ipEnforcement: "flag",
    });
  }
  await hr.signOut();
}

const LABELS: Record<string, string> = {
  owner: "Owner",
  hr: "HR admin",
  payroll: "Payroll admin",
  manager: "Manager (Jurong Point supervisor)",
  employee: "Employee (barista, Tanjong Pagar; Jurong Point from 1 Dec 2026)",
  barista2: "Employee (barista, Jurong Point)",
  tp_lead: "Manager (Tanjong Pagar supervisor)",
  tb_lead: "Manager (Tiong Bahru supervisor)",
  opsmgr: "Operations manager (the outlet supervisors' manager)",
};

/**
 * A fresh random password for every account, through the change-password API as that person
 * (the demo's shared password is public). Members who can no longer sign in (the October leaver)
 * get theirs set directly in the scratch database. The "password changed" notice is marked read.
 */
async function setPasswords(
  deps: AppDeps,
  seed: SeedResult,
  member: Member,
  newPassword: () => string,
): Promise<SampleAccount[]> {
  const all = [
    ...PERSONAS.map((p) => ({ key: p.key, email: p.email, roles: [...p.roles] as string[], employee: p.employee })),
    ...OTHER_MEMBERS.map((m) => ({ key: m.employee, email: m.email, roles: [] as string[], employee: m.employee })),
  ];
  const accounts: SampleAccount[] = [];
  for (const a of all) {
    const membershipId = seed.members[a.key];
    if (!membershipId) throw new Error(`No seeded member ${a.key}`);
    const [row] = await deps.db
      .select({ status: schema.memberships.status, userId: schema.memberships.userId, name: schema.users.displayName })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.id, membershipId));
    if (!row) throw new Error(`No membership for ${a.email}`);
    const password = newPassword();
    if (row.status === "active") {
      const client = member(a.key, { fresh: true });
      await client.post(`${API}/me/password`, { currentPassword: DEMO_PASSWORD, newPassword: password });
      const unread = await client.get<{ items: { id: string; title: string }[] }>(
        `${API}/notifications?unread=true&pageSize=50`,
      );
      for (const n of unread.items.filter((x) => /password was changed/i.test(x.title))) {
        await client.post(`${API}/notifications/${n.id}/read`, {});
      }
      await client.signOut();
    } else {
      const at = deps.clock.now();
      await deps.db
        .update(schema.users)
        .set({ passwordHash: await deps.passwordHasher.hash(password), passwordChangedAt: at, updatedAt: at })
        .where(eq(schema.users.id, row.userId));
    }
    accounts.push({
      key: a.key,
      label: LABELS[a.key] ?? (row.status === "active" ? "Staff" : `Staff (${row.status})`),
      name: row.name,
      email: a.email,
      password,
      roles: a.roles,
      reviewer: a.key === REVIEWER_KEYS.employee ? "employee" : a.key === REVIEWER_KEYS.manager ? "manager" : null,
    });
  }
  return accounts;
}

/** What a reviewer needs, checked through the API before anything leaves the scratch database. */
async function checkPrepared(member: Member, today: string): Promise<SampleChecks> {
  const employee = member(REVIEWER_KEYS.employee);
  const payslips = await employee.get<{ items: unknown[] }>(`${API}/payslips`);
  const balances = await employee.get<{ items: { code: string; available: number | null }[] }>(`${API}/leave/balances`);
  const weeks: SampleChecks["rosterWeeks"] = [];
  const shifts = await employee.get<{ shifts: MyShift[] }>(
    `${API}/scheduling/me?from=${mondayOf(today)}&to=${addDays(mondayOf(today), 8 * 7 + 6)}`,
  );
  for (let w = 0; w <= 8; w++) {
    const weekStart = addDays(mondayOf(today), w * 7);
    weeks.push({
      weekStart,
      shifts: shifts.shifts.filter((s) => s.kind === "shift" && s.date >= weekStart && s.date <= addDays(weekStart, 6))
        .length,
    });
  }
  await employee.signOut();
  const manager = member(REVIEWER_KEYS.manager);
  const tasks = await manager.get<{ items: Task[] }>(`${API}/approvals/tasks`);
  await manager.signOut();
  const owner = member("owner");
  const security = await owner.get<{ providers: unknown[] }>(`${API}/security/settings`);
  const att = await owner.get<{ locationMode: string }>(`${API}/attendance/settings`);
  await owner.signOut();

  const checks: SampleChecks = {
    today,
    employeePayslips: payslips.items.length,
    employeeLeaveTypes: balances.items.filter((b) => (b.available ?? 0) > 0).length,
    rosterWeeks: weeks,
    managerPendingTasks: tasks.items.length,
    ssoProviders: security.providers.length,
    attendanceLocationMode: att.locationMode,
  };
  const problems = [
    checks.employeePayslips < 1 && "the employee has no released payslips",
    checks.employeeLeaveTypes < 1 && "the employee has no leave balance",
    weeks.some((w) => w.shifts === 0) && "the employee's roster has an empty week in the next eight weeks",
    checks.managerPendingTasks < 1 && "the manager has nothing to approve",
    checks.ssoProviders !== 0 && "single sign-on methods are still configured",
    checks.attendanceLocationMode !== "off" && "clock-in still checks location",
  ].filter(Boolean);
  if (problems.length) throw new Error(`Sample company check failed: ${problems.join("; ")}`);
  return checks;
}
