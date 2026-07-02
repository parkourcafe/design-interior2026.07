import { describe, it, expect } from "vitest";
import { dedupeRisks } from "./dedupe";
import type { RiskCard } from "@/lib/types";

const ruleBudget: RiskCard = {
  risk_type: "budget",
  evidence: ["Премиальные материалы в пожеланиях", "Бюджетный уровень: эконом"],
  impact: "Стоимость материалов и итоговая смета проекта",
  confidence: "high",
  designer_action: "Уточнить приоритет материалов",
  proposal_implication: "Материалы акцентно",
  source: "rule",
};

describe("dedupeRisks", () => {
  it("drops an LLM card that overlaps a rule card of the same type", () => {
    const llmBudget: RiskCard = {
      risk_type: "budget",
      evidence: ["Клиент хочет премиальные материалы при экономном бюджете"],
      impact: "Итоговая стоимость материалов и смета вырастут",
      confidence: "medium",
      designer_action: "Обсудить замены",
      proposal_implication: "Ограничить премиум",
      source: "llm",
    };
    const result = dedupeRisks([ruleBudget], [llmBudget]);
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe("rule");
  });

  it("keeps an LLM card of a different type", () => {
    const llmStyle: RiskCard = {
      risk_type: "style",
      evidence: ["Смешение скандинавского и классического направлений"],
      impact: "Целостность визуальной концепции",
      confidence: "medium",
      designer_action: "Уточнить приоритетное направление",
      proposal_implication: "Зафиксировать одно стилевое направление",
      source: "llm",
    };
    const result = dedupeRisks([ruleBudget], [llmStyle]);
    expect(result).toHaveLength(2);
  });

  it("keeps a same-type LLM card that does not overlap", () => {
    const llmBudget: RiskCard = {
      risk_type: "budget",
      evidence: ["Авторский надзор не заложен в ожидаемую стоимость"],
      impact: "Дополнительные расходы на сопровождение реализации",
      confidence: "low",
      designer_action: "Обсудить необходимость надзора",
      proposal_implication: "Вынести надзор отдельной строкой",
      source: "llm",
    };
    const result = dedupeRisks([ruleBudget], [llmBudget]);
    expect(result).toHaveLength(2);
  });
});
