import { describe, it, expect } from "vitest";
import { buildProposalSections } from "./build";
import { buildPassport } from "@/lib/brief/passport";
import type { RiskCard, ProposalDefaults } from "@/lib/types";
import type { PriceResult } from "@/lib/pricing/calc";

const passport = buildPassport({
  object: { type: "flat", area_m2: 60, city: "Москва" },
  asset_horizon: "self_long",
  household: ["kids_now"],
  budget: { range: [3_000_000, 5_000_000] },
  style: { refs: ["https://ref"], anti: [], notes: "тёплый минимализм" },
  pain: "мало света и хранения",
});

const defaults: ProposalDefaults = {
  exclusions: ["Строительно-монтажные работы"],
  revision_limit: 2,
  stage_completion: "Этап завершён после письменного согласования.",
};

const price: PriceResult = {
  range: [189000, 231000],
  term_weeks: [8, 12],
  factors: [{ label: "Базовая ставка", value: "3500 ₽/м²" }],
};

const acceptedCard: RiskCard = {
  risk_type: "function",
  evidence: ["высокая нагрузка на хранение", "минимализм"],
  impact: "функциональность",
  confidence: "high",
  designer_action: "обсудить скрытое хранение",
  proposal_implication: "включить проект систем хранения",
  source: "rule",
};

describe("buildProposalSections", () => {
  it("includes a price section when price is provided", () => {
    const sections = buildProposalSections({
      passport,
      acceptedCards: [],
      defaults,
      price,
      packageChoice: "full",
    });
    const priceSection = sections.find((s) => s.id === "price");
    expect(priceSection).toBeDefined();
    expect(priceSection?.body).toContain("189");
  });

  it("omits the price section in no-price mode", () => {
    const sections = buildProposalSections({
      passport,
      acceptedCards: [],
      defaults,
      price: null,
      packageChoice: "full",
    });
    expect(sections.find((s) => s.id === "price")).toBeUndefined();
  });

  it("folds accepted risk implications into 'included'", () => {
    const sections = buildProposalSections({
      passport,
      acceptedCards: [acceptedCard],
      defaults,
      price,
      packageChoice: "full",
    });
    const included = sections.find((s) => s.id === "included");
    expect(included?.body).toContain("включить проект систем хранения");
  });

  it("prefills the task section from the passport", () => {
    const sections = buildProposalSections({
      passport,
      acceptedCards: [],
      defaults,
      price,
      packageChoice: "full",
    });
    const task = sections.find((s) => s.id === "task");
    expect(task?.body).toContain("квартира");
    expect(task?.body).toContain("60 м²");
    expect(task?.body).toContain("мало света");
  });

  it("always produces the core section set", () => {
    const sections = buildProposalSections({
      passport,
      acceptedCards: [],
      defaults,
      price,
      packageChoice: "full",
    });
    const ids = sections.map((s) => s.id);
    for (const id of ["task", "works", "stages", "included", "excluded", "revisions", "client_inputs", "stage_completion"]) {
      expect(ids).toContain(id);
    }
  });
});
