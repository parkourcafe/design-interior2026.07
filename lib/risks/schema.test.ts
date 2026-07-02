import { describe, it, expect } from "vitest";
import { RiskCardsLlmSchema } from "./schema";
import { extractJson } from "@/lib/llm/provider";

// Парсер LLM-ответа на фикстурах — без сетевых вызовов.

describe("LLM risk-card parsing", () => {
  it("parses a well-formed fenced JSON array", () => {
    const raw = [
      "Вот карточки рисков:",
      "```json",
      JSON.stringify([
        {
          risk_type: "budget",
          evidence: ["натуральный камень при экономном бюджете"],
          impact: "смета вырастет",
          confidence: "high",
          designer_action: "обсудить замены",
          proposal_implication: "ограничить премиум-материалы",
        },
      ]),
      "```",
    ].join("\n");

    const parsed = RiskCardsLlmSchema.safeParse(JSON.parse(extractJson(raw)));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data[0]?.risk_type).toBe("budget");
    }
  });

  it("parses an empty array (no risks)", () => {
    const parsed = RiskCardsLlmSchema.safeParse(JSON.parse(extractJson("[]")));
    expect(parsed.success).toBe(true);
  });

  it("rejects an invalid risk_type", () => {
    const bad = JSON.stringify([
      {
        risk_type: "financial",
        evidence: ["x"],
        impact: "y",
        confidence: "high",
        designer_action: "z",
        proposal_implication: "w",
      },
    ]);
    const parsed = RiskCardsLlmSchema.safeParse(JSON.parse(extractJson(bad)));
    expect(parsed.success).toBe(false);
  });

  it("rejects a card missing required fields", () => {
    const bad = JSON.stringify([{ risk_type: "budget", impact: "y", confidence: "high" }]);
    const parsed = RiskCardsLlmSchema.safeParse(JSON.parse(extractJson(bad)));
    expect(parsed.success).toBe(false);
  });
});
