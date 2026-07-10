import { describe, expect, it } from "vitest";
import {
  CUSTOM_QUESTIONS_LIMIT,
  buildBriefPackPrompt,
  buildCustomQuestionPrompt,
  customQuestionToRuntimeQuestion,
  fallbackQuestionFromPhrase,
  fallbackBriefPackFromContext,
  flattenBriefPack,
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
      ...Array.from({ length: 40 }, (_, index) => `Вопрос ${index}?`),
    ]);

    expect(questions).toHaveLength(CUSTOM_QUESTIONS_LIMIT);
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

  it("builds deterministic wellness fallback questions from project context", () => {
    const questions = fallbackBriefPackFromContext({
      project_type: "wellness",
      description: "Массажная студия на Бали",
      area_m2: 300,
      location: "Бали",
    });

    expect(questions.length).toBeGreaterThan(8);
    expect(questions.some((question) => question.title.includes("процедур"))).toBe(true);
    expect(questions.some((question) => question.title.includes("300 м²"))).toBe(true);
    expect(questions.some((question) => question.title.includes("Бали"))).toBe(true);
  });

  it("treats uploaded plans as metadata in the brief pack prompt", () => {
    const prompt = buildBriefPackPrompt({
      project_type: "wellness",
      description: "Массажная студия, нужно подготовить вопросы по плану",
      plan_files: [{ name: "plan.pdf", size: 1200, type: "application/pdf", path: "designer-plans/p/plan.pdf" }],
    });

    expect(prompt).toContain("не утверждай, что прочитал");
    expect(prompt).toContain("plan.pdf");
  });

  it("flattens grouped LLM brief pack questions into editable custom questions", () => {
    const questions = flattenBriefPack({
      groups: [
        {
          title: "Операционная модель",
          questions: [
            {
              title: "Кто будет находиться в пространстве одновременно?",
              type: "multi",
              help: "Нужно для сценариев движения.",
              options: [
                { value: "clients", label: "Клиенты" },
                { value: "staff", label: "Персонал" },
              ],
            },
          ],
        },
      ],
    });

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      source: "llm",
      help: "Блок: Операционная модель. Нужно для сценариев движения.",
    });
  });
});
