import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientAs,
  createTestDb,
  seedEmployee,
  seedMember,
  seedOrg,
  type TestClient,
  type TestDb,
} from "../../testing/index.ts";
import { type PayrollHttp, payrollHttp } from "../../testing/payroll-http.ts";
import { auditEvents } from "../db/schema/audit.ts";
import {
  APPENDIX_8A_ACCOMMODATION_HEADERS,
  APPENDIX_8A_HOTEL_OTHERS_HEADERS,
  APPENDIX_8B_HEADERS,
} from "./files/ir8a-appendix.ts";

/**
 * add-ir8a-appendix-8a-8b: recording Appendix 8A/8B entries, permissions, limits, audit, cross-org
 * isolation, the IR8A totals and the appendix sheets of the IR8A download. Values are IRAS's worked
 * examples (EN-8A item 12; Accommodation Example 2; Car Example 5; ESOP guide Annex C Example 2).
 */

type K = "P" | "Q" | "R";
let t: TestDb;
let p: PayrollHttp<K>;
let hr: TestClient;
let other: { employeeId: string; entryId: string };
const api = "/api/v1/payroll";

type Entry = {
  id: string;
  employeeName: string;
  kind: string;
  computed: {
    appendix: string;
    item: string;
    valueCents: number;
    days: number | null;
    section: string | null;
    lines: { code: string; amountCents: number | null; entered: boolean }[];
    working: { code: string; text: string }[];
  } | null;
};
type List = {
  entries: Entry[];
  employees: {
    employeeName: string;
    appendix8aTotalCents: number;
    benefitsInKind: number;
    shareGainsS101b: number;
    shareGainsS101g: number;
  }[];
  limits: { residencesPerEmployee: number; shareRecordsPerEmployee: number };
};
type Preview = {
  parts: {
    part: number;
    records: number;
    appendix8aAccommodation: number;
    appendix8aHotelOthers: number;
    appendix8b: number;
  }[];
  records: {
    employeeName: string;
    grossSalary: number;
    bonus: number;
    benefitsInKind: number;
    shareGainsS101b: number;
    shareGainsS101g: number;
    notes: { code: string; message: string }[];
  }[];
  excluded: { employeeName: string; reason: string }[];
  notes: { code: string; message: string }[];
};

const ownedFlat = {
  kind: "residence",
  basis: "owned",
  address: "10 Anson Road #20-01 Singapore 079903",
  occupiedFrom: "2026-03-01",
  occupiedTo: "2026-05-29",
  employeesSharing: 2,
  annualValueCents: 4_000_000,
  furnishing: "full",
  rentPaidByEmployeeCents: 200_000,
  utilitiesCents: 25_000,
  servantCents: 120_000,
};
const rentedFlat = {
  kind: "residence",
  basis: "rented",
  address: "1 Tanjong Pagar Road Singapore 088443",
  occupiedFrom: "2026-06-01",
  occupiedTo: "2026-12-31",
  employeesSharing: 2,
  rentPaidByEmployerCents: 5_000_000,
  rentPaidByEmployeeCents: 600_000,
};

beforeAll(async () => {
  t = await createTestDb();
  p = await payrollHttp<K>(t, [
    {
      key: "P",
      name: "Priya Nair",
      dob: "1985-06-01",
      residency: "citizen",
      gender: "female",
      hireDate: "2019-02-01",
      basicCents: 900_000,
    },
    {
      key: "Q",
      name: "Quek Boon Huat",
      dob: "1970-01-15",
      residency: "citizen",
      gender: "male",
      hireDate: "2001-05-02",
      basicCents: 800_000,
    },
    // No sex recorded: left out of the IR8A rows, and so out of the appendix sheets.
    {
      key: "R",
      name: "Rahman bin Ali",
      dob: "1980-09-09",
      residency: "citizen",
      hireDate: "2018-01-02",
      basicCents: 500_000,
    },
  ]);
  // Only Priya is paid in 2026 (an off-cycle bonus); Quek has only a share gain (IR8A appendix-only record).
  await p.payRun(
    { kind: "off_cycle", month: "2026-10", offCycleReason: "bonus", employeeIds: [p.co.e.P], payDate: "2026-10-30" },
    [
      {
        employeeId: p.co.e.P,
        kind: "bonus",
        label: "Bonus",
        amountCents: 100_000,
        wageClass: "AW",
        awPayableDate: "2026-10-30",
      },
    ],
  );
  hr = await clientAs(p.app, p.co.h.deps, await seedMember(p.co.h.deps, p.co.h.orgId, { roles: ["hr_admin"] }));
  // A second organisation with one employee and one entry of its own (same database and app:
  // requests are scoped by the session's organisation).
  const deps = p.co.h.deps;
  const orgB = await seedOrg(deps, { slug: "other-co" });
  const employeeB = await seedEmployee(deps, orgB.id, { legalName: "Xavier Tan" });
  const ownerB = await clientAs(p.app, deps, await seedMember(deps, orgB.id, { roles: ["owner"] }));
  const created = await p.ok<{ id: string }>(
    ownerB.post(`${api}/years/2026/ir8a/appendices`, {
      employeeId: employeeB,
      entry: { kind: "hotel", costCents: 10_000 },
    }),
    201,
  );
  other = { employeeId: employeeB, entryId: created.id };
}, 120_000);
afterAll(() => t.close());

const create = (employeeId: string, entry: Record<string, unknown>, year = 2026) =>
  p.admin.post(`${api}/years/${year}/ir8a/appendices`, { employeeId, entry });

async function errorOf(res: Response, status: number): Promise<string> {
  expect(res.status).toBe(status);
  return ((await res.json()) as { error: { message: string } }).error.message;
}

describe("recording Appendix 8A and 8B entries", () => {
  it("computes an owned residence as IRAS's EN-8A example and shows its working", async () => {
    const e = await p.ok<Entry>(create(p.co.e.P, ownedFlat), 201);
    expect(e.employeeName).toBe("Priya Nair");
    expect(e.computed).toMatchObject({ appendix: "8A", item: "2", valueCents: 684_725, days: 90 });
    const lines = Object.fromEntries((e.computed?.lines ?? []).map((l) => [l.code, l.amountCents]));
    expect(lines).toMatchObject({ "2a": 493_150, "2b": 246_575, "2d": 739_725, "2f": 539_725, "2j": 145_000 });
    expect(e.computed?.working.find((w) => w.code === "A8A_2A_ANNUAL_VALUE")?.text).toContain("$4,931.50");
  });

  it("records a rented residence, hotel, leased car, home leave and share gains", async () => {
    const rented = await p.ok<Entry>(create(p.co.e.P, rentedFlat), 201);
    // Accommodation Example 2: $50,000 ÷ 2 − $6,000 = $19,000.
    expect(rented.computed?.lines.find((l) => l.code === "2f")?.amountCents).toBe(1_900_000);
    await p.ok(create(p.co.e.P, { kind: "hotel", costCents: 250_000, paidByEmployeeCents: 0 }), 201);
    const car = await p.ok<Entry>(
      create(p.co.e.P, {
        kind: "car",
        carType: "leased",
        usedFrom: "2026-01-01",
        usedTo: "2026-12-31",
        rentalCents: 3_000_000,
        runningCostsCents: 650_000,
        note: "SKA1234A",
      }),
      201,
    );
    expect(car.computed).toMatchObject({ item: "4i", valueCents: 1_564_285 });
    await p.ok(create(p.co.e.P, { kind: "other", item: "home_leave", amountCents: 300_000 }), 201);
    const esow = await p.ok<Entry>(
      create(p.co.e.P, {
        kind: "share_gain",
        planType: "ESOW",
        grantedOn: "2025-06-01",
        eventDate: "2026-06-01",
        exercisePrice: "0",
        openMarketValue: "3.20",
        shares: "10000",
      }),
      201,
    );
    expect(esow.computed).toMatchObject({ appendix: "8B", valueCents: 3_200_000, section: "S10_1_B" });
    const esop = await p.ok<Entry>(
      create(p.co.e.Q, {
        kind: "share_gain",
        planType: "ESOP",
        grantedOn: "2002-11-01",
        eventDate: "2026-03-02",
        exercisePrice: "1.10",
        openMarketValue: "2.35",
        shares: "4000",
        companyIdType: "UEN-Others",
        companyIdNumber: "T08UF1234A",
        companyName: "Kopi Kaki Holdings Ltd",
      }),
      201,
    );
    expect(esop.computed).toMatchObject({ valueCents: 500_000, section: "S10_1_G" });
    await p.ok(create(p.co.e.R, { kind: "other", item: "club", amountCents: 50_000 }), 201);
  });

  it("lists the year's entries and each employee's totals (IR8A d7 and d8)", async () => {
    const l = await p.ok<List>(p.admin.get(`${api}/years/2026/ir8a/appendices`));
    expect(l.entries).toHaveLength(8);
    expect(l.limits).toEqual({ residencesPerEmployee: 10, shareRecordsPerEmployee: 30 });
    const priya = l.employees.find((x) => x.employeeName === "Priya Nair");
    // 2f + 2j owned (684,725) + rented (1,900,000) + hotel 250,000 + car 1,564,285 + 4a 300,000.
    expect(priya).toMatchObject({
      appendix8aTotalCents: 4_699_010,
      benefitsInKind: 46_990,
      shareGainsS101b: 32_000,
      shareGainsS101g: 0,
    });
    expect(l.employees.find((x) => x.employeeName === "Quek Boon Huat")).toMatchObject({
      benefitsInKind: 0,
      shareGainsS101g: 5_000,
    });
  });

  it("refuses invalid input with a message saying how to fix it", async () => {
    expect(await errorOf(await create(p.co.e.P, { ...rentedFlat, occupiedTo: "2027-01-31" }), 400)).toMatch(
      /must be in 2026/,
    );
    expect(
      await errorOf(
        await create(p.co.e.P, {
          kind: "share_gain",
          planType: "ESOP",
          grantedOn: "2024-01-01",
          eventDate: "2026-01-02",
          exercisePrice: "5",
          openMarketValue: "4",
          shares: "100",
        }),
        400,
      ),
    ).toMatch(/does not take losses/);
    expect(await errorOf(await create(p.co.e.P, { ...ownedFlat, address: null }), 400)).toMatch(/address/);
    expect(
      await errorOf(
        await create(p.co.e.P, { ...ownedFlat, occupiedFrom: "2028-01-01", occupiedTo: "2028-03-31" }, 2028),
        400,
      ),
    ).toMatch(/leap year/);
    expect(await errorOf(await create(p.co.e.P, { kind: "hotel", costCents: 1 }, 2024), 400)).toMatch(/2024/);
  });

  it("allows at most 10 places of residence per employee and year", async () => {
    const flat = (m: number) => ({
      ...rentedFlat,
      occupiedFrom: `2025-${String(m).padStart(2, "0")}-01`,
      occupiedTo: `2025-${String(m).padStart(2, "0")}-10`,
    });
    for (let m = 1; m <= 10; m++) await p.ok(create(p.co.e.Q, flat(m), 2025), 201);
    expect(await errorOf(await create(p.co.e.Q, flat(11), 2025), 409)).toMatch(/at most 10 places of residence/);
  });

  it("replaces an entry with an audited field diff, but not its kind", async () => {
    const l = await p.ok<List>(p.admin.get(`${api}/years/2026/ir8a/appendices`));
    const hotel = l.entries.find((e) => e.kind === "hotel" && e.employeeName === "Priya Nair") as Entry;
    const updated = await p.ok<Entry>(
      p.admin.put(`${api}/ir8a/appendices/${hotel.id}`, {
        entry: { kind: "hotel", costCents: 260_000, paidByEmployeeCents: 10_000 },
      }),
    );
    expect(updated.computed?.valueCents).toBe(250_000);
    expect(
      await errorOf(
        await p.admin.put(`${api}/ir8a/appendices/${hotel.id}`, {
          entry: { kind: "other", item: "club", amountCents: 1 },
        }),
        400,
      ),
    ).toMatch(/can't change kind/);
    const [event] = await p.co.h.deps.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "payroll.ir8a_appendix_updated"), eq(auditEvents.targetId, hotel.id)));
    expect(event?.diff).toEqual({
      costCents: { from: 250_000, to: 260_000 },
      paidByEmployeeCents: { from: 0, to: 10_000 },
    });
    const created = await p.co.h.deps.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "payroll.ir8a_appendix_created"));
    expect(created.length).toBeGreaterThanOrEqual(8);
  });

  it("deletes an entry (audited)", async () => {
    const tmp = await p.ok<Entry>(create(p.co.e.P, { kind: "other", item: "insurance", amountCents: 1_000 }), 201);
    expect((await p.admin.delete(`${api}/ir8a/appendices/${tmp.id}`)).status).toBe(204);
    expect((await p.admin.delete(`${api}/ir8a/appendices/${tmp.id}`)).status).toBe(404);
    const [event] = await p.co.h.deps.db.select().from(auditEvents).where(eq(auditEvents.targetId, tmp.id));
    expect(event).toBeDefined();
    const deleted = await p.co.h.deps.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "payroll.ir8a_appendix_deleted"), eq(auditEvents.targetId, tmp.id)));
    expect(deleted).toHaveLength(1);
  });
});

describe("permissions and isolation", () => {
  it("is for owners and payroll admins only", async () => {
    expect((await hr.get(`${api}/years/2026/ir8a/appendices`)).status).toBe(403);
    expect(
      (
        await hr.post(`${api}/years/2026/ir8a/appendices`, {
          employeeId: p.co.e.P,
          entry: { kind: "hotel", costCents: 1 },
        })
      ).status,
    ).toBe(403);
    const staff = await clientAs(p.app, p.co.h.deps, await seedMember(p.co.h.deps, p.co.h.orgId, {}));
    expect((await staff.get(`${api}/years/2026/ir8a/appendices`)).status).toBe(403);
    expect((await p.owner.get(`${api}/years/2026/ir8a/appendices`)).status).toBe(200);
  });

  it("never reaches another organisation's employees or entries", async () => {
    expect((await create(other.employeeId, { kind: "hotel", costCents: 1 })).status).toBe(404);
    expect(
      (await p.owner.put(`${api}/ir8a/appendices/${other.entryId}`, { entry: { kind: "hotel", costCents: 2 } })).status,
    ).toBe(404);
    expect((await p.owner.delete(`${api}/ir8a/appendices/${other.entryId}`)).status).toBe(404);
    const l = await p.ok<List>(p.owner.get(`${api}/years/2026/ir8a/appendices`));
    expect(l.entries.some((e) => e.id === other.entryId)).toBe(false);
  });
});

describe("IR8A preview and download with appendices", () => {
  it("shows d7(a), d7(b) and d8, includes the appendix-only employee and leaves out one without a sex", async () => {
    const pv = await p.ok<Preview>(p.admin.get(`${api}/years/2026/ir8a`));
    const priya = pv.records.find((r) => r.employeeName === "Priya Nair");
    expect(priya).toMatchObject({ bonus: 1_000, benefitsInKind: 46_990, shareGainsS101b: 32_000, shareGainsS101g: 0 });
    expect(priya?.notes.find((n) => n.code === "IR8A_APPENDIX_8A_ANNUAL_VALUE")?.message).toContain(
      "2a S$4,931.50 and 2b S$2,465.75",
    );
    const quek = pv.records.find((r) => r.employeeName === "Quek Boon Huat");
    expect(quek).toMatchObject({ grossSalary: 0, shareGainsS101g: 5_000, shareGainsS101b: 0 });
    expect(quek?.notes.map((n) => n.code)).toContain("IR8A_APPENDIX_ONLY");
    expect(pv.excluded).toEqual([
      expect.objectContaining({
        employeeName: "Rahman bin Ali",
        reason: expect.stringContaining("Appendix 8A/8B records"),
      }),
    ]);
    expect(pv.parts).toEqual([
      { part: 1, records: 2, appendix8aAccommodation: 2, appendix8aHotelOthers: 1, appendix8b: 2 },
    ]);
    expect(pv.notes.find((n) => n.code === "IR8A_APPENDICES")?.message).toMatch(
      /Appendix 8A for 1 employee and Appendix 8B for 2/,
    );
  });

  const rowsOf = async (res: Response) => {
    expect(res.status).toBe(200);
    const text = (await res.text()).replace(/^﻿/, "");
    return { text, lines: text.trimEnd().split("\r\n") };
  };

  it("downloads the accommodation sheet: owned premises without 2a/2b, locked cells empty", async () => {
    const res = await p.admin.get(`${api}/years/2026/ir8a/file?part=1&sheet=appendix-8a-accommodation`);
    expect(res.headers.get("content-disposition")).toContain("ir8a-2026-part1-of-1-appendix-8a-accommodation.csv");
    const { lines } = await rowsOf(res);
    expect(lines[0]?.startsWith("*ID Type [Choose option],*ID No.,Accommodation ID,1. Address Details,")).toBe(true);
    expect(lines).toHaveLength(3);
    const owned = (lines[1] ?? "").split(",");
    expect(owned).toHaveLength(APPENDIX_8A_ACCOMMODATION_HEADERS.length);
    expect(owned[0]).toBe("NRIC");
    expect(owned[1]).toMatch(/^S\d{7}[A-Z]$/);
    expect(owned.slice(2, 8)).toEqual([
      "1",
      "10 Anson Road #20-01 Singapore 079903",
      "2026-03-01",
      "2026-05-29",
      "",
      "2",
    ]);
    // I–M empty (AV method disabled in the template; L only for rented premises), N 2e, P 2g, R 2i.
    expect(owned.slice(8, 13)).toEqual(["", "", "", "", ""]);
    expect([owned[13], owned[15], owned[16], owned[17], owned[18]]).toEqual(["2000.00", "250.00", "", "1200.00", ""]);
    const rented = (lines[2] ?? "").split(",");
    expect([rented[2], rented[11], rented[13]]).toEqual(["2", "25000.00", "6000.00"]);
  });

  it("downloads the hotel and others sheet: one row per employee", async () => {
    const { lines } = await rowsOf(
      await p.admin.get(`${api}/years/2026/ir8a/file?part=1&sheet=appendix-8a-hotel-others`),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]?.split(",")[3]).toBe(APPENDIX_8A_HOTEL_OTHERS_HEADERS[3].split(",")[0]);
    const row = (lines[1] ?? "").split(",");
    expect(row).toHaveLength(APPENDIX_8A_HOTEL_OTHERS_HEADERS.length);
    // D 3a, E 3b, F (locked) empty, G 4a, O 4i, Q (locked total) empty.
    expect([row[3], row[4], row[5], row[6], row[14], row[16]]).toEqual([
      "2600.00",
      "100.00",
      "",
      "3000.00",
      "15642.85",
      "",
    ]);
  });

  it("downloads the Appendix 8B sheet with the gross amount left to myTax", async () => {
    const { text, lines } = await rowsOf(await p.admin.get(`${api}/years/2026/ir8a/file?part=1&sheet=appendix-8b`));
    expect(text).toContain('"h. Gross Amount\nof gains from ESOP/ESOW Plans\n(h) =  (f-e) x g"');
    const data = text.trimEnd().split("\r\n").slice(1);
    expect(data).toHaveLength(2);
    const quek = data.map((l) => l.split(",")).find((r) => r[6] === "ESOP") ?? [];
    expect(quek).toHaveLength(APPENDIX_8B_HEADERS.length);
    expect(quek.slice(2, 13)).toEqual([
      "1",
      "UEN-Others",
      "T08UF1234A",
      "Kopi Kaki Holdings Ltd",
      "ESOP",
      "2002-11-01",
      "2026-03-02",
      "1.1",
      "2.35",
      "4000",
      "",
    ]);
    expect(lines.length).toBe(3);
  });

  it("keeps IR8A d7 and d8 empty (myTax computes them) and adds the appendix-only record", async () => {
    const { lines } = await rowsOf(await p.admin.get(`${api}/years/2026/ir8a/file?part=1`));
    expect(lines).toHaveLength(3);
    const quek = (lines.find((l) => l.includes("Quek Boon Huat")) ?? "").split(",");
    expect(quek[14]).toBe("0"); // O a) gross salary
    expect(quek.slice(30, 33)).toEqual(["", "", ""]); // AE d7(a), AF d7(b), AG d8
  });

  it("answers 409 for an appendix sheet with no rows, and audits each download with its sheet", async () => {
    await p.ok(create(p.co.e.P, { kind: "hotel", costCents: 5_000 }, 2027), 201);
    expect((await p.admin.get(`${api}/years/2027/ir8a/file?part=1&sheet=appendix-8b`)).status).toBe(409);
    expect((await p.admin.get(`${api}/years/2027/ir8a/file?part=1&sheet=appendix-8a-hotel-others`)).status).toBe(200);
    const events = await p.co.h.deps.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "payroll.ir8a_file_generated"));
    expect(events.map((e) => (e.meta as { sheet?: string }).sheet)).toEqual(
      expect.arrayContaining(["appendix-8a-accommodation", "appendix-8a-hotel-others", "appendix-8b", "ir8a"]),
    );
    expect((await p.admin.get(`${api}/years/2026/ir8a/file?part=1&sheet=appendix-9z`)).status).toBe(400);
  });
});
