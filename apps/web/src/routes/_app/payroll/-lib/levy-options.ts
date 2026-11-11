import { FWL_RATES } from "@crowhr/sg-rules";

/** A Work Permit levy rate group from sg-rules' FWL table, as payroll settings store it. */
export interface LevyGroup {
  sector: string;
  tier: string;
  skill: string | null;
}

const TIER_LABEL: Record<string, string> = {
  ALL: "All workers",
  ANY_SOURCE: "Any source",
  MYS_NAS_PRC: "Malaysia, North Asian sources, PRC",
  NTS: "Non-traditional sources",
  OFFSITE_CONSTRUCTION: "Off-site construction",
};
const SKILL_LABEL: Record<string, string> = {
  BASIC_SKILLED: "basic-skilled",
  HIGHER_SKILLED: "higher-skilled",
  UNSKILLED_NO_CERTIFICATION: "no skills certification",
};

const words = (code: string) => code.toLowerCase().replaceAll("_", " ");

/** "SERVICES" → "Services", "MARINE_SHIPYARD" → "Marine shipyard". */
export function sectorLabel(code: string): string {
  const w = words(code);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** "TIER_2" + "BASIC_SKILLED" → "Tier 2, basic-skilled". */
export function tierSkillLabel(tier: string, skill: string | null): string {
  const t =
    TIER_LABEL[tier] ??
    tier.replace(/^TIER_(\d+)(_MERGED)?$/, (_, n: string, merged?: string) => `Tier ${n}${merged ? " (merged)" : ""}`);
  return skill ? `${t}, ${SKILL_LABEL[skill] ?? words(skill)}` : t;
}

/** Every Work Permit sector, tier and skill the levy table has rates for, in table order. */
export const WORK_PERMIT_LEVY_GROUPS: readonly LevyGroup[] = (() => {
  const seen = new Set<string>();
  const out: LevyGroup[] = [];
  for (const r of FWL_RATES) {
    if (r.pass !== "WORK_PERMIT") continue;
    const key = `${r.sector}|${r.tier}|${r.skill ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sector: r.sector, tier: r.tier, skill: r.skill });
  }
  return out;
})();

export const groupKey = (tier: string, skill: string | null) => `${tier}|${skill ?? ""}`;
