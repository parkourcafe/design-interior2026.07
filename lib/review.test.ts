import { describe, it, expect } from "vitest";
import { missingFields, firstMeetingQuestions } from "./review";
import { buildPassport } from "@/lib/brief/passport";

describe("missingFields", () => {
  it("reports empty passport fields", () => {
    const passport = buildPassport({
      object: { type: "flat", city: "Москва" }, // no area
      budget: { range: "undisclosed" },
    });
    const missing = missingFields(passport);
    expect(missing).toContain("Площадь");
    expect(missing).toContain("Бюджетный коридор");
  });

  it("reports nothing when key fields are filled", () => {
    const passport = buildPassport({
      object: { type: "flat", area_m2: 60, city: "Москва" },
      asset_horizon: "self_long",
      budget: { range: [3_000_000, 5_000_000] },
      style: { refs: ["https://ref"], anti: [], notes: "warm" },
      pain: "тесно",
    });
    expect(missingFields(passport)).toHaveLength(0);
  });
});

describe("firstMeetingQuestions", () => {
  it("collects designer_action only from accepted cards", () => {
    const questions = firstMeetingQuestions([
      { designer_action: "обсудить материалы", status: "accepted" },
      { designer_action: "обсудить сроки", status: "rejected" },
      { designer_action: "обсудить санузел", status: "accepted" },
      { designer_action: "не показывать", status: "proposed" },
    ]);
    expect(questions).toEqual(["обсудить материалы", "обсудить санузел"]);
  });
});
