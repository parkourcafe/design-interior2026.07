import { describe, expect, it } from "vitest";
import {
  buildCustomQuestionPrompt,
  customQuestionToRuntimeQuestion,
  fallbackQuestionFromPhrase,
  formatCustomAnswer,
  normalizeCustomQuestion,
  normalizeCustomQuestions,
  optionValueFromLabel,
} from "./custom-questions";

describe("custom brief questions", () => {
  it("keeps legacy string questions as text questions", () => {
    expect(normalizeCustomQuestion("Есть ли техника, которую нужно сохранить?")).toMatchObject({
      title: "Есть ли техника, которую нужно сохранить?",
      type: "text",
    });
  });

  it("normalizes structured choice questions with options", () => {
    const question = normalizeCustomQuestion({
      title: "Кто будет согласовывать закупки?",
      type: "choice",
      help: "Нужно для понимания сопровождения.",
      options: ["Только клиент", "Клиент и дизайнер", "Дизайнер"],
    });

    expect(question).toMatchObject({
      title: "Кто будет согласовывать закупки?",
      type: "choice",
    });
    expect(question?.options).toEqual([
      { value: "tolko_klient", label: "Только клиент" },
      { value: "klient_i_dizayner", label: "Клиент и дизайнер" },
      { value: "dizayner", label: "Дизайнер" },
    ]);
  });

  it("falls back to text when choice has no valid options", () => {
    expect(normalizeCustomQuestion({ title: "Что важно уточнить?", type: "choice" })?.type).toBe("text");
  });

  it("deduplicates and limits stored custom questions", () => {
    const questions = normalizeCustomQuestions([
      "Первый вопрос?",
      "Первый вопрос?",
      ...Array.from({ length: 20 }, (_, index) => `Вопрос ${index}?`),
    ]);

    expect(questions).toHaveLength(15);
    expect(questions.filter((question) => question.title === "Первый вопрос?")).toHaveLength(1);
  });

  it("maps structured custom questions into intake runtime questions", () => {
    const question = customQuestionToRuntimeQuestion(
      {
        title: "Сколько рабочих мест нужно?",
        type: "number",
        help: "Для планировки кабинета.",
      },
      2,
    );

    expect(question).toMatchObject({
      id: "custom_2",
      type: "number",
      optional: true,
      passport_field: "custom_2",
    });
  });

  it("formats option answers with human labels", () => {
    const question = normalizeCustomQuestion({
      title: "Какие закупки нужны?",
      type: "multi",
      options: [
        { value: "light", label: "Свет" },
        { value: "furniture", label: "Мебель" },
      ],
    })!;

    expect(formatCustomAnswer(question, ["light", "furniture"])).toBe("Свет, Мебель");
  });

  it("sanitizes prompt and fallback text before LLM structuring", () => {
    const phrase = "Спроси клиента @private, можно ли звонить +7 999 123-45-67";
    const prompt = buildCustomQuestionPrompt(phrase);
    const fallback = fallbackQuestionFromPhrase(phrase, "voice");

    expect(prompt).not.toContain("@private");
    expect(prompt).not.toContain("+7 999");
    expect(fallback.title).toContain("[контакт скрыт]");
  });

  it("creates stable option values from Russian labels", () => {
    expect(optionValueFromLabel("Клиент и дизайнер")).toBe("klient_i_dizayner");
  });
});
