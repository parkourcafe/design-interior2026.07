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

  it("maps the added fields (condition, replanning, decision-makers, etc.)", () => {
    const p = buildPassport({
      object: { type: "flat", area_m2: 60, city: "Москва" },
      condition: "shell",
      replanning: "yes",
      decision_makers: "family",
      furniture_keep: "own",
      budget: { range: [3_000_000, 5_000_000] },
      budget_furniture: "yes",
      requirements: ["warm_floor", "smart", "none"],
      deadline: "  к свадьбе в мае  ",
    });
    expect(p.object.condition).toBe("shell");
    expect(p.object.replanning).toBe("yes");
    expect(p.household.decision_makers).toBe("family");
    expect(p.lifestyle.furniture_keep).toBe("own");
    expect(p.budget.includes_furniture).toBe("yes");
    expect(p.lifestyle.requirements).toEqual(["warm_floor", "smart"]); // 'none' отброшен
    expect(p.timeline.hard_deadline).toBe("к свадьбе в мае");
  });

  it("maps structured style and room details", () => {
    const p = buildPassport({
      object: { type: "flat", area_m2: 60, city: "Москва" },
      style_direction: ["scandi", "minimal", "unknown"],
      palette: "light",
      kitchen_layout: "island",
      kitchen_bar: "yes",
      kitchen_dining: "4",
      bath_count: "two",
      bath_sinks: "two",
      bath_shower: "both",
    });
    expect(p.style.directions).toEqual(["scandi", "minimal"]); // 'unknown' отброшен
    expect(p.style.palette).toBe("light");
    expect(p.rooms?.kitchen?.layout).toBe("island");
    expect(p.rooms?.kitchen?.bar).toBe("yes");
    expect(p.rooms?.bath?.sinks).toBe("two");
    expect(p.rooms?.bath?.shower).toBe("both");
  });

  it("leaves rooms undefined when nothing chosen or all 'unknown'", () => {
    const p = buildPassport({
      object: { type: "flat", area_m2: 60, city: "Москва" },
      kitchen_layout: "unknown",
      bath_count: "unknown",
    });
    expect(p.rooms).toBeUndefined();
  });

  it("maps planning/detail fields (bedrooms, living, balcony, neighbors)", () => {
    const p = buildPassport({
      object: { type: "flat", area_m2: 75, city: "Москва" },
      neighbors_renovation: "active",
      bedrooms: "2",
      living_type: "open",
      hallway: ["wardrobe", "stroller", "none"],
      balcony: "attach",
      view: "yard",
      doors: "hidden",
    });
    expect(p.object.neighbors_renovation).toBe("active");
    expect(p.rooms?.bedrooms).toBe("2");
    expect(p.rooms?.living).toBe("open");
    expect(p.rooms?.hallway).toEqual(["wardrobe", "stroller"]); // 'none' отброшен
    expect(p.rooms?.balcony).toBe("attach");
    expect(p.rooms?.view).toBe("yard");
    expect(p.rooms?.doors).toBe("hidden");
  });

  it("leaves added fields undefined when not answered", () => {
    const p = buildPassport({ object: { type: "flat", area_m2: 60, city: "Москва" } });
    expect(p.object.replanning).toBeUndefined();
    expect(p.lifestyle.requirements).toBeUndefined();
    expect(p.timeline.hard_deadline).toBeUndefined();
  });
});
