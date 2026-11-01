import { singaporeDate } from "./dates.ts";
import type { HistoryInput } from "./history.ts";

const API = "/api/v1/scheduling";
const TEMPLATES = [
  { code: "OPN", name: "Opening", startTime: "06:00", endTime: "14:20", colour: "kuning" },
  { code: "AM", name: "Morning", startTime: "08:00", endTime: "16:20", colour: "biru" },
  { code: "MID", name: "Midday", startTime: "10:00", endTime: "18:20", colour: "plain" },
  { code: "PM", name: "Closing", startTime: "13:00", endTime: "21:20", colour: "ink" },
] as const;
const WEEKS = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"];
const OUTLETS = [
  { location: "tp", crew: ["tp_lead", "employee", "pt1"] },
  { location: "jp", crew: ["manager", "barista2", "spass"] },
  { location: "tb", crew: ["tb_lead", "joiner", "leaver_oct"] },
];
const employeeKey = (key: string) =>
  (({ employee: "barista1", manager: "jp_lead" }) as Record<string, string>)[key] ?? key;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Real published café weeks, then punches and workflow-approved OT; never payroll OT inputs. */
export async function seedOperations(h: HistoryInput) {
  const { clock, http, members, people } = h;
  const as = (key: string) => http.as(members[key] as string);
  clock.set("2026-09-25T10:00");
  const hr = await as("hr");
  const templates = [];
  for (const t of TEMPLATES) {
    templates.push(await hr.post<{ id: string }>(`${API}/templates`, { ...t, breakMinutes: 60, locationId: null }));
  }
  const shifts: { id: string; who: string; date: string; start: string; end: string }[] = [];
  for (const weekStart of WEEKS) {
    for (const outlet of OUTLETS) {
      const roster = await hr.post<{ id: string }>(`${API}/rosters`, {
        weekStart,
        locationId: people.locations[outlet.location],
      });
      for (const [index, who] of outlet.crew.entries()) {
        for (let day = 0; day < 7; day++) {
          const date = addDays(weekStart, day);
          if ((who === "joiner" && date < "2026-10-12") || (who === "leaver_oct" && date > "2026-10-15")) continue;
          // Part-time crew work three shifts weekly. Everyone has an explicit Sunday rest day.
          if (who === "pt1" && ![1, 3, 5, 6].includes(day)) continue;
          const template = TEMPLATES[index % TEMPLATES.length] as (typeof TEMPLATES)[number];
          // Rotate the supervisor onto closing on Saturdays, showcasing all four templates.
          const tplIndex = index === 0 && day === 5 ? 3 : index;
          const t = TEMPLATES[tplIndex] ?? template;
          const saved = await hr.post<{ id: string }>(`${API}/rosters/${roster.id}/shifts`, {
            employeeId: people.employees[employeeKey(who)],
            date,
            ...(day === 6 ? { kind: "rest" } : { templateId: templates[tplIndex]?.id }),
          });
          if (day !== 6) shifts.push({ id: saved.id, who, date, start: t.startTime, end: t.endTime });
        }
      }
      const view = await hr.get<{ toAcknowledge: { shiftId: string; kind: string }[] }>(`${API}/rosters/${roster.id}`);
      await hr.post(`${API}/rosters/${roster.id}/publish`, {
        acknowledge: view.toAcknowledge.map(({ shiftId, kind }) => ({ shiftId, kind })),
      });
    }
  }

  // Visit every worked October shift in chronological order. The joiner starts on the 12th;
  // Priyanka's last day is the 15th. Hafiz has two no-pay days; no punches are made for them.
  for (const shift of shifts
    .filter((s) => s.date >= "2026-10-01" && s.date <= "2026-10-30")
    .sort((a, b) => a.date.localeCompare(b.date))) {
    if (shift.who === "barista2" && ["2026-10-13", "2026-10-14"].includes(shift.date)) continue;
    const late =
      ["2026-10-06", "2026-10-20", "2026-10-27"].includes(shift.date) && ["employee", "spass"].includes(shift.who)
        ? 15
        : 0;
    const ot =
      ["2026-10-09", "2026-10-16", "2026-10-23"].includes(shift.date) && ["employee", "barista2"].includes(shift.who)
        ? 60
        : 0;
    for (const kind of ["in", "out"] as const) {
      const base = Date.parse(`${shift.date}T${kind === "in" ? shift.start : shift.end}:00+08:00`);
      const at = new Date(base + (kind === "in" ? late : ot) * 60_000);
      clock.set(`${singaporeDate(at)}T${new Date(at.getTime() + 8 * 3600_000).toISOString().slice(11, 16)}`);
      await (await as(shift.who)).post("/api/v1/attendance/punches", {
        kind,
        idempotencyKey: `seed-${shift.id}-${kind}`,
        deviceTime: at.toISOString(),
        sentAt: at.toISOString(),
        queued: false,
        source: "web",
        location: null,
      });
    }
    if (ot)
      await (await as(shift.who)).post("/api/v1/attendance/overtime", {
        date: shift.date,
        minutes: ot,
        reason: "Deepavali catering preparation and closing stocktake",
      });
  }
  clock.set("2026-10-30T22:00");
  for (const manager of ["tp_lead", "manager"]) {
    const c = await as(manager);
    const tasks = await c.get<{ items: { taskId: string; subjectType: string }[] }>("/api/v1/approvals/tasks");
    for (const task of tasks.items.filter((t) => t.subjectType === "overtime")) {
      await c.post(`/api/v1/approvals/tasks/${task.taskId}/decision`, {
        decision: "approve",
        comment: "Catering close verified against clocked hours.",
      });
    }
  }

  // Same-day exchange: Hafiz and Maria each retain one shift, without an overlapping second shift.
  const hafiz = shifts.find((s) => s.who === "barista2" && s.date === "2026-11-04");
  const maria = shifts.find((s) => s.who === "spass" && s.date === "2026-11-04");
  if (!hafiz || !maria) throw new Error("Missing demo swap shifts");
  const swap = await (await as("barista2")).post<{ id: string }>(`${API}/swaps`, {
    kind: "swap",
    shiftId: hafiz.id,
    peerEmployeeId: people.employees.spass,
    peerShiftId: maria.id,
  });
  await (await as("spass")).post(`${API}/swaps/${swap.id}/accept`);
  // Payroll needs a full-month denominator even for a person employed only part of it.
  // Scheduling intentionally withholds that feed for part-month tenures; derive it from
  // the outlet's published full-month working dates, never guess a fixed 26-day month.
  return new Set(shifts.filter((s) => s.who === "tb_lead" && s.date.startsWith("2026-10")).map((s) => s.date)).size;
}
