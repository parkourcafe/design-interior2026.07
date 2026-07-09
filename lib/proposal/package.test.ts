import { describe, expect, it } from "vitest";
import { buildPassport } from "@/lib/brief/passport";
import { recommendPackage } from "./package";
import type { RiskCard } from "@/lib/types";

const technicalRisk: RiskCard = {
  risk_type: "technical",
  evidence: ["балкон"],
  impact: "согласование",
  confidence: "high",
  designer_action: "обсудить ограничения",
  proposal_implication: "зафиксировать ограничения",
  source: "rule",
};

describe("recommendPackage", () => {
  it("recommends concept for rental or resale with a tight budget", () => {
    const passport = buildPassport({
      object: { type: "flat", area_m2: 60, city: "Казань" },
      asset_horizon: "rent",
      budget: { range: [1_500_000, 3_500_000] },
    });

    const recommendation = recommendPackage(passport);

    expect(recommendation.package).toBe("concept");
    expect(recommendation.reasons.join(" ")).toContain("аренду");
  });

  it("recommends full plus supervision for implementation-sensitive projects", () => {
    const passport = buildPassport({
      object: { type: "flat", area_m2: 70, city: "Москва" },
      replanning: "yes",
      timeline: "urgent",
    });

    const recommendation = recommendPackage(passport);

    expect(recommendation.package).toBe("full_plus_supervision");
    expect(recommendation.reasons.join(" ")).toContain("перепланировка");
  });

  it("escalates to full plus supervision from accepted technical or timeline risks", () => {
    const passport = buildPassport({
      object: { type: "flat", area_m2: 70, city: "Москва" },
      budget: { range: [4_000_000, 6_000_000] },
    });

    expect(recommendPackage(passport, [technicalRisk]).package).toBe("full_plus_supervision");
  });

  it("defaults to full for a self-long project without implementation flags", () => {
    const passport = buildPassport({
      object: { type: "flat", area_m2: 70, city: "Москва" },
      asset_horizon: "self_long",
      budget: { range: [4_000_000, 6_000_000] },
      style: { refs: ["https://example.com"], anti: [], notes: "" },
    });

    const recommendation = recommendPackage(passport);

    expect(recommendation.package).toBe("full");
    expect(recommendation.reasons.length).toBeGreaterThan(0);
  });
});
