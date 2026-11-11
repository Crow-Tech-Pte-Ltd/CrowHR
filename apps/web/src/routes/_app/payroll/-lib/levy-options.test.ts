import { describe, expect, it } from "vitest";
import { sectorLabel, tierSkillLabel, WORK_PERMIT_LEVY_GROUPS } from "./levy-options.ts";

describe("Work Permit levy options", () => {
  it("come from the levy table, once each", () => {
    const keys = WORK_PERMIT_LEVY_GROUPS.map((g) => `${g.sector}|${g.tier}|${g.skill}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("SERVICES|TIER_1|BASIC_SKILLED");
    expect(WORK_PERMIT_LEVY_GROUPS.every((g) => g.sector !== "ALL")).toBe(true);
  });

  it("read as words, not codes", () => {
    expect(sectorLabel("MARINE_SHIPYARD")).toBe("Marine shipyard");
    expect(tierSkillLabel("TIER_2", "BASIC_SKILLED")).toBe("Tier 2, basic-skilled");
    expect(tierSkillLabel("TIER_1_MERGED", "HIGHER_SKILLED")).toBe("Tier 1 (merged), higher-skilled");
    expect(tierSkillLabel("MYS_NAS_PRC", "BASIC_SKILLED")).toBe("Malaysia, North Asian sources, PRC, basic-skilled");
  });
});
