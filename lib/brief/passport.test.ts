import { describe, it, expect } from "vitest";
import { buildPassport } from "./passport";

describe("buildPassport", () => {
  it("maps a full family profile deterministically", () => {
    const p = buildPassport({
      object: { type: "flat", area_m2: 60, city: "Москва" },
      asset_horizon: "self_long",
      household: ["kids_now", "pets"],
      morning: "high_1bath",
      cooking: "heavy",
      cooking_people: 4,
      storage: ["clothes", "sport", "books"],
      budget: { range: [3_000_000, 5_000_000] },
      timeline: "urgent",
      style: { refs: ["https://ref"], anti: ["глянец"], notes: "тёплый минимализм" },
      pain: "мало света",
    });

    expect(p.object).toEqual({ type: "flat", area_m2: 60, city: "Москва" });
    expect(p.asset_horizon).toBe("self_long");
    expect(p.household.kids).toBe(true);
    expect(p.household.pets).toBe(true);
    expect(p.lifestyle.morning_load).toBe("high");
    expect(p.lifestyle.bathrooms).toBe(1);
    expect(p.lifestyle.cooking).toBe("heavy");
    expect(p.lifestyle.storage_pressure).toBe("high"); // 3 реальных пункта
    expect(p.budget.range).toEqual([3_000_000, 5_000_000]);
    expect(p.budget.risk_level).toBe("high"); // 5M/60 ≈ 83k ₽/м² > 50k
    expect(p.timeline.urgency).toBe("urgent");
    expect(p.style.anti).toContain("глянец");
    expect(p.pain_points).toBe("мало света");
    expect(p.scope.package).toBeNull();
  });

  it("treats undisclosed budget as 'undisclosed' with mid tier", () => {
    const p = buildPassport({
      object: { type: "flat", area_m2: 50, city: "Казань" },
      budget: { range: "undisclosed" },
    });
    expect(p.budget.range).toBe("undisclosed");
    expect(p.budget.risk_level).toBe("mid");
  });

  it("classifies a tight economy budget as low tier", () => {
    const p = buildPassport({
      object: { type: "flat", area_m2: 50, city: "Пермь" },
      budget: { range: [400_000, 700_000] }, // 700k/50 = 14k ₽/м² < 20k
    });
    expect(p.budget.risk_level).toBe("low");
  });

  it("falls back to mid tier when area is missing", () => {
    const p = buildPassport({
      object: { type: "flat", city: "Сочи" },
      budget: { range: [1_000_000, 2_000_000] },
    });
    expect(p.object.area_m2).toBeNull();
    expect(p.budget.risk_level).toBe("mid");
  });

  it("derives storage pressure buckets", () => {
    expect(buildPassport({ storage: ["all_fits"] }).lifestyle.storage_pressure).toBe("low");
    expect(buildPassport({ storage: ["clothes"] }).lifestyle.storage_pressure).toBe("mid");
    expect(buildPassport({ storage: ["clothes", "sport"] }).lifestyle.storage_pressure).toBe("mid");
    expect(
      buildPassport({ storage: ["clothes", "sport", "tech", "books"] }).lifestyle.storage_pressure,
    ).toBe("high");
  });

  it("handles two-bathroom morning load", () => {
    const p = buildPassport({ morning: "mid_2bath" });
    expect(p.lifestyle.morning_load).toBe("mid");
    expect(p.lifestyle.bathrooms).toBe(2);
  });
});
