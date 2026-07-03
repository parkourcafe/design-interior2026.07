import { describe, it, expect } from "vitest";
import { buildRiskPrompt } from "./llm";
import { buildPassport } from "@/lib/brief/passport";

describe("buildRiskPrompt PII redaction", () => {
  it("does not leak city, district or contact into the LLM prompt", () => {
    const answers = {
      object: { type: "flat", area_m2: 60, city: "Новосибирск", district: "Академгородок" },
      contact: { name: "Мария", phone: "+79990001122", email: "maria@example.ru" },
      budget: { range: [3_000_000, 5_000_000] },
      style: { refs: [], anti: [], notes: "тёплый минимализм" },
    };
    const passport = buildPassport(answers);
    const prompt = buildRiskPrompt(passport, answers);

    expect(prompt).not.toContain("Новосибирск");
    expect(prompt).not.toContain("Академгородок");
    expect(prompt).not.toContain("Мария");
    expect(prompt).not.toContain("+79990001122");
    expect(prompt).not.toContain("maria@example.ru");
    // но содержательные данные для анализа остаются
    expect(prompt).toContain("минимализм");
  });
});
