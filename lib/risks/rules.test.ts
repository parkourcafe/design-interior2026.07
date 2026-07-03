import { describe, it, expect } from "vitest";
import { evaluateRules } from "./rules";
import { buildPassport } from "@/lib/brief/passport";

function passportFrom(answers: Record<string, unknown>) {
  return buildPassport(answers);
}

describe("evaluateRules", () => {
  it("flags premium materials on a low/mid budget (rule 1)", () => {
    const answers = {
      object: { type: "flat", area_m2: 60, city: "Уфа" },
      budget: { range: [600_000, 900_000] }, // 15k ₽/м² → low
      style: { refs: [], anti: [], notes: "хочу натуральный камень и мрамор" },
    };
    const cards = evaluateRules(passportFrom(answers), answers);
    const budget = cards.find((c) => c.risk_type === "budget");
    expect(budget).toBeDefined();
    expect(budget?.source).toBe("rule");
    expect(budget?.confidence).toBe("high");
  });

  it("does NOT flag premium materials on a high budget", () => {
    const answers = {
      object: { type: "flat", area_m2: 60, city: "Москва" },
      budget: { range: [4_000_000, 6_000_000] }, // 100k ₽/м² → high
      style: { refs: [], anti: [], notes: "натуральный камень" },
    };
    const cards = evaluateRules(passportFrom(answers), answers);
    expect(cards.find((c) => c.risk_type === "budget")).toBeUndefined();
  });

  it("flags sell/rent horizon with deep customization (rule 2)", () => {
    const answers = {
      object: { type: "flat", area_m2: 55, city: "Тюмень" },
      asset_horizon: "sell_2_5y",
      budget: { range: [2_000_000, 3_000_000] },
      style: { refs: [], anti: [], notes: "вся мебель на заказ, встроенные шкафы, столярка" },
    };
    const cards = evaluateRules(passportFrom(answers), answers);
    expect(cards.some((c) => c.risk_type === "budget")).toBe(true);
  });

  it("flags urgency with custom furniture (rule 3)", () => {
    const answers = {
      object: { type: "flat", area_m2: 55, city: "Омск" },
      timeline: "urgent",
      budget: { range: [2_000_000, 3_000_000] },
      style: { refs: [], anti: [], notes: "кухня и шкафы — мебель на заказ" },
    };
    const cards = evaluateRules(passportFrom(answers), answers);
    expect(cards.some((c) => c.risk_type === "timeline")).toBe(true);
  });

  it("flags high storage pressure with minimalism (rule 4)", () => {
    const answers = {
      object: { type: "flat", area_m2: 45, city: "Самара" },
      storage: ["clothes", "sport", "books", "tech"],
      budget: { range: [1_500_000, 2_500_000] },
      style: { refs: [], anti: [], notes: "строгий минимализм, ничего лишнего" },
    };
    const cards = evaluateRules(passportFrom(answers), answers);
    expect(cards.some((c) => c.risk_type === "function")).toBe(true);
  });

  it("flags high morning load with a single bathroom (rule 5)", () => {
    const answers = {
      object: { type: "flat", area_m2: 70, city: "Пермь" },
      morning: "high_1bath",
      budget: { range: [2_000_000, 3_000_000] },
    };
    const cards = evaluateRules(passportFrom(answers), answers);
    const fn = cards.find((c) => c.risk_type === "function");
    expect(fn).toBeDefined();
    expect(fn?.evidence.length).toBeGreaterThan(0);
  });

  it("flags replanning under urgency (rule 6)", () => {
    const answers = {
      object: { type: "flat", area_m2: 60, city: "Москва" },
      replanning: "yes",
      timeline: "urgent",
      budget: { range: [3_000_000, 5_000_000] },
    };
    const cards = evaluateRules(passportFrom(answers), answers);
    expect(cards.some((c) => c.risk_type === "timeline")).toBe(true);
  });

  it("flags furniture-in-budget on a low/mid budget (rule 7)", () => {
    const answers = {
      object: { type: "flat", area_m2: 60, city: "Пермь" },
      budget: { range: [800_000, 1_100_000] }, // ~18k ₽/м² → low
      budget_furniture: "yes",
    };
    const cards = evaluateRules(passportFrom(answers), answers);
    expect(cards.some((c) => c.risk_type === "budget")).toBe(true);
  });

  it("flags balcony attachment as a technical risk (rule 8)", () => {
    const answers = {
      object: { type: "flat", area_m2: 60, city: "Москва" },
      balcony: "attach",
      budget: { range: [3_000_000, 5_000_000] },
    };
    const cards = evaluateRules(passportFrom(answers), answers);
    expect(cards.some((c) => c.risk_type === "technical")).toBe(true);
  });

  it("returns no cards for a conflict-free brief", () => {
    const answers = {
      object: { type: "flat", area_m2: 80, city: "Москва" },
      asset_horizon: "self_long",
      morning: "low_1bath",
      cooking: "basic",
      storage: ["all_fits"],
      budget: { range: [4_000_000, 6_000_000] }, // high tier
      timeline: "flex",
      style: { refs: ["https://ref"], anti: [], notes: "спокойный современный стиль" },
      pain: "хочется больше света",
    };
    expect(evaluateRules(passportFrom(answers), answers)).toHaveLength(0);
  });
});
