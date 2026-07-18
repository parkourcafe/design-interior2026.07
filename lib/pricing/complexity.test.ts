import { describe, it, expect } from "vitest";
import { deriveComplexity } from "./complexity";
import type { Passport } from "@/lib/types";

// Минимальный «простой» паспорт; тесты переопределяют нужные поля.
function base(overrides: Partial<Passport> = {}): Passport {
  return {
    object: { type: "flat", area_m2: 50, city: "Москва", condition: "lived", replanning: "no" },
    asset_horizon: "self_long",
    household: { now: "пара", in_5y: "пара", kids: false, pets: false },
    lifestyle: {
      morning_load: "low",
      bathrooms: 1,
      cooking: "basic",
      storage_pressure: "low",
    },
    budget: { range: "undisclosed", risk_level: "low" },
    timeline: { target: "", urgency: "normal" },
    style: { refs: [], anti: [], notes: "" },
    rooms: { zones: [] },
    pain_points: "",
    scope: { package: null },
    ...overrides,
  };
}

describe("deriveComplexity", () => {
  it("простой объект без структурных работ → low", () => {
    expect(deriveComplexity(base())).toBe("low");
  });

  it("один сигнал сложности → mid", () => {
    expect(deriveComplexity(base({ object: { type: "flat", area_m2: 50, city: "Москва", replanning: "yes" } }))).toBe(
      "mid",
    );
  });

  it("два и более сигналов → high", () => {
    const p = base({
      object: { type: "flat", area_m2: 90, city: "Москва", condition: "shell", replanning: "yes" },
    });
    expect(deriveComplexity(p)).toBe("high");
  });

  it("много зон и санузлов → high", () => {
    const p = base({
      lifestyle: { morning_load: "high", bathrooms: 3, cooking: "heavy", storage_pressure: "high" },
      rooms: { zones: ["детская", "кабинет", "гардеробная"] },
    });
    expect(deriveComplexity(p)).toBe("high");
  });

  it("частично нагруженный, но не структурный → mid", () => {
    const p = base({ lifestyle: { morning_load: "mid", bathrooms: 2, cooking: "basic", storage_pressure: "mid" } });
    expect(deriveComplexity(p)).toBe("mid");
  });
});
