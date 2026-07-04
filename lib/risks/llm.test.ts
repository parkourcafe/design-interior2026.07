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

  it("scrubs contacts hidden inside free-text fields", () => {
    const answers = {
      object: { type: "flat", area_m2: 60, city: "Москва" },
      vision: "Пишите в телеграм @maria_design или на почту maria@example.ru",
      pain: "Звоните +7 (999) 000-11-22, обсудим",
      style: {
        refs: ["https://pinterest.com/pin/1234567890"],
        anti: [],
        notes: "как у блогера @cozyhome",
      },
      comments: { vision: "мой номер 8 916 123 45 67" },
    };
    const passport = buildPassport(answers);
    const prompt = buildRiskPrompt(passport, answers);

    // Прямые контакты из свободного текста не утекают.
    expect(prompt).not.toContain("@maria_design");
    expect(prompt).not.toContain("maria@example.ru");
    expect(prompt).not.toContain("999");
    expect(prompt).not.toContain("@cozyhome");
    expect(prompt).not.toContain("8 916 123 45 67");
    // Смысл сохраняется.
    expect(prompt).toContain("телеграм");
    expect(prompt).toContain("блогера");
    // Ссылка-референс остаётся нетронутой (это не контакт).
    expect(prompt).toContain("https://pinterest.com/pin/1234567890");
  });
});
