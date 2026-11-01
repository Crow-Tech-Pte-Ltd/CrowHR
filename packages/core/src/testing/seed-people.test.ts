import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, createTestDeps, type TestDb } from "../../testing/index.ts";
import { ageOn } from "../employees/dates.ts";
import { getEmployee, listDirectory } from "../employees/records.ts";
import { createPeopleHarness, OWNER, type PeopleHarness } from "./people-harness.ts";
import { SEED_PEOPLE, seedPeople } from "./seed-people.ts";

let t: TestDb;
let h: PeopleHarness;
beforeEach(async () => {
  t = await createTestDb();
  h = await createPeopleHarness(createTestDeps(t.db));
});
afterEach(() => t.close());

describe("seedPeople", () => {
  it("seeds a consistent fictional SME through the real services", async () => {
    const seeded = await seedPeople(h.deps, h.ports, h.actor(OWNER));
    const rows = await listDirectory(h.deps, h.actor(OWNER), {});
    expect(rows).toHaveLength(SEED_PEOPLE.length);
    const by = (key: string) => rows.find((r) => r.id === seeded.employees[key]);
    expect(by("leaver")?.status.code).toBe("leaving");
    expect(by("former")?.status.code).toBe("former");
    expect(by("intern")?.status.code).toBe("not_started");
    expect(by("wp_expired")?.workPassState).toBe("expired");
    expect(by("ep")?.workPassState).toBe("expiring");
    expect(by("senior70")?.manager?.name).toBe("Benjamin Lee Jia Hao");
    const residencies = new Set(SEED_PEOPLE.map((p) => p.residency));
    expect([...residencies].sort()).toEqual(["citizen", "foreigner", "pr"]);
    const passTypes = new Set(SEED_PEOPLE.flatMap((p) => (p.pass ? [p.pass.type] : [])));
    expect([...passTypes].sort()).toEqual(["EP", "S_PASS", "WP"]);
    const ages = SEED_PEOPLE.map((p) => ageOn(p.dob, "2026-10-31"));
    for (const milestone of [55, 60, 65, 70]) {
      expect(ages.some((a) => a === milestone || a === milestone - 1)).toBe(true);
    }
    const detail = await getEmployee(h.deps, h.actor(OWNER), seeded.employees.spr_y2 as string);
    expect(detail.personal).toMatchObject({ residencyStatus: "pr", sprCpfOption: "fg" });
    expect(detail.bank?.current?.bankCode).toBe("SCBLSGSG");
  });
});
