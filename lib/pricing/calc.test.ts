import { describe, it, expect } from "vitest";
import { calcPrice } from "./calc";
import type { PricingConfig } from "@/lib/types";

const pricing: PricingConfig = {
  base_rate_per_m2: 3500,
  multipliers: {
    complexity: { low: 0.85, mid: 1.0, high: 1.4 },
    urgency: 1.3,
    package: { concept: 0.6, full: 1.0, full_plus_supervision: 1.35 },
  },
};

describe("calcPrice", () => {
  it("computes a deterministic range for a standard full project", () => {
    const r = calcPrice(pricing, { area_m2: 60, complexity: "mid", urgent: false, package: "full" });
    // point = 3500 * 60 * 1 * 1 * 1 = 210000 → ±10% → [189000, 231000]
    expect(r.range).toEqual([189000, 231000]);
  });

  it("applies complexity, urgency and package multipliers", () => {
    const r = calcPrice(pricing, {
      area_m2: 100,
      complexity: "high",
      urgent: true,
      package: "full_plus_supervision",
    });
    // point = 3500 * 100 * 1.4 * 1.3 * 1.35 = 859950 → [773955→774000, 945945→946000]
    expect(r.range[0]).toBeLessThan(r.range[1]);
    expect(r.range[0]).toBeGreaterThan(700000);
    expect(r.factors.some((f) => f.label === "Срочность")).toBe(true);
  });

  it("omits the urgency factor when not urgent", () => {
    const r = calcPrice(pricing, { area_m2: 50, complexity: "low", urgent: false, package: "concept" });
    expect(r.factors.some((f) => f.label === "Срочность")).toBe(false);
  });

  it("returns a plausible term range", () => {
    const r = calcPrice(pricing, { area_m2: 80, complexity: "mid", urgent: false, package: "full" });
    expect(r.term_weeks[0]).toBeGreaterThanOrEqual(2);
    expect(r.term_weeks[1]).toBe(r.term_weeks[0] + 4);
  });
});
