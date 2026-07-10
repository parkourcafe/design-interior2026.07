import { describe, expect, it } from "vitest";
import { buildPassport } from "@/lib/brief/passport";
import { derivePackageRecommendation, recommendPackage } from "./package";
import type { RiskCard, RiskStatus } from "@/lib/types";

const technicalRisk: RiskCard & { status?: RiskStatus } = {
  risk_type: "technical",
  evidence: ["балкон"],
  impact: "согласование",
  confidence: "high",
  designer_action: "обсудить ограничения",
  proposal_implication: "зафиксировать ограничения",
  source: "rule",
};

describe("derivePackageRecommendation", () => {
  it("returns fallback concept when data is insufficient", () => {
    const passport = buildPassport({});

    const recommendation = derivePackageRecommendation({ passport });

    expect(recommendation.package_key).toBe("concept");
    expect(recommendation.confidence).toBe("low");
    expect(recommendation.reason_codes).toContain("insufficient_data");
    expect(recommendation.included_service_items.length).toBeGreaterThan(0);
  });

  it("recommends concept for a simple rental or resale project with a tight budget", () => {
    const passport = buildPassport({
      object: { type: "flat", area_m2: 42, city: "Казань" },
      asset_horizon: "rent",
      budget: { range: [1_500_000, 3_500_000] },
    });

    const recommendation = derivePackageRecommendation({ passport });

    expect(recommendation.package_key).toBe("concept");
    expect(recommendation.package_label).toBe("Концепция");
    expect(recommendation.reason_codes).toContain("asset_for_rent_or_resale");
    expect(recommendation.client_facing_explanation).toContain("концепции");
  });

  it("recommends full for a standard full project", () => {
    const passport = buildPassport({
      object: { type: "flat", area_m2: 82, city: "Москва" },
      asset_horizon: "self_long",
      budget: { range: [4_000_000, 6_000_000] },
      bedrooms: "2",
      living_type: "open",
      style: { refs: ["https://example.com"], anti: [], notes: "" },
    });

    const recommendation = derivePackageRecommendation({ passport });

    expect(recommendation.package_key).toBe("full");
    expect(recommendation.reason_codes).toContain("standard_full_project");
    expect(recommendation.included_service_items.join(" ")).toContain("рабочих чертежей");
  });

  it("recommends full plus supervision for implementation-sensitive projects", () => {
    const passport = buildPassport({
      object: { type: "flat", area_m2: 70, city: "Москва" },
      replanning: "yes",
      timeline: "urgent",
    });

    const recommendation = derivePackageRecommendation({ passport });

    expect(recommendation.package_key).toBe("full_plus_supervision");
    expect(recommendation.reason_codes).toContain("implementation_sensitive");
    expect(recommendation.pricing_explanation_points.join(" ")).toContain("сопровождением");
  });

  it("recommends supervision when answers mention furnishing or purchasing scope", () => {
    const answers = {
      object: { type: "flat", area_m2: 70, city: "Москва" },
      asset_horizon: "self_long",
      budget: { range: [4_000_000, 6_000_000] },
      budget_furniture: "yes",
      vision: "Нужна комплектация мебелью, светом и техникой, закупки хочу согласовывать удалённо",
    };
    const passport = buildPassport(answers);

    const recommendation = derivePackageRecommendation({ passport, answers });

    expect(recommendation.package_key).toBe("full_plus_supervision");
    expect(recommendation.reason_codes).toContain("furniture_or_equipment_scope");
  });

  it("escalates to full plus supervision from accepted technical or timeline risks", () => {
    const passport = buildPassport({
      object: { type: "flat", area_m2: 70, city: "Москва" },
      budget: { range: [4_000_000, 6_000_000] },
    });

    expect(derivePackageRecommendation({ passport, riskCards: [{ ...technicalRisk, status: "accepted" }] }).package_key)
      .toBe("full_plus_supervision");
  });

  it("does not escalate public proposal from rejected risks", () => {
    const passport = buildPassport({
      object: { type: "flat", area_m2: 70, city: "Москва" },
      asset_horizon: "self_long",
      budget: { range: [4_000_000, 6_000_000] },
      style: { refs: ["https://example.com"], anti: [], notes: "" },
    });

    const recommendation = derivePackageRecommendation({
      passport,
      riskCards: [{ ...technicalRisk, status: "rejected" }],
    });

    expect(recommendation.package_key).toBe("full");
    expect(recommendation.reason_codes).not.toContain("technical_or_timeline_risk");
    expect(recommendation.internal_notes?.join(" ")).toContain("Отклонённые");
  });

  it("keeps backward-compatible recommendPackage wrapper", () => {
    const passport = buildPassport({
      object: { type: "flat", area_m2: 70, city: "Москва" },
      asset_horizon: "self_long",
      budget: { range: [4_000_000, 6_000_000] },
    });

    const recommendation = recommendPackage(passport);

    expect(recommendation.package).toBe("full");
    expect(recommendation.reasons.length).toBeGreaterThan(0);
  });
});
