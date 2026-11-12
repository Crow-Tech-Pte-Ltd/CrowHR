import { describe, expect, it } from "vitest";
import { defaultLocation, type Scopes } from "./api.ts";

const HQ = "00000000-0000-4000-8000-000000000001";
const JURONG = "00000000-0000-4000-8000-000000000002";
const TANJONG = "00000000-0000-4000-8000-000000000003";

const scopes = (over: Partial<Scopes>): Scopes => ({
  locations: [
    { id: HQ, name: "Anson Road office" },
    { id: JURONG, name: "Jurong Point outlet" },
    { id: TANJONG, name: "Tanjong Pagar outlet" },
  ],
  departments: [],
  mine: { locationId: HQ, departmentId: null },
  rosteredLocationIds: [JURONG, TANJONG],
  canEdit: true,
  ...over,
});

describe("the location Schedules opens on", () => {
  it("is an outlet with a roster when an editor's own office has none", () => {
    expect(defaultLocation(scopes({}))).toBe(JURONG);
  });
  it("is your own location when it has a roster", () => {
    expect(defaultLocation(scopes({ mine: { locationId: TANJONG, departmentId: null } }))).toBe(TANJONG);
  });
  it("stays your own for staff who only see their outlet's published roster", () => {
    expect(defaultLocation(scopes({ canEdit: false }))).toBe(HQ);
  });
  it("is your own (or the first) when nobody has made a roster yet", () => {
    expect(defaultLocation(scopes({ rosteredLocationIds: [] }))).toBe(HQ);
    expect(defaultLocation(scopes({ rosteredLocationIds: [], mine: { locationId: null, departmentId: null } }))).toBe(
      HQ,
    );
  });
  it("waits for the scopes to load", () => {
    expect(defaultLocation(undefined)).toBeNull();
  });
});
