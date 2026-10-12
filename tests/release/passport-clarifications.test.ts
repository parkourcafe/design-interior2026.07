import { describe, expect, it, vi } from "vitest";
import type { AnswersMap, Passport } from "@/lib/types";

// ТЗ 08.10.2026, FIX-03: комментарии клиента к вопросам брифа становятся
// уточнениями паспорта по question_id (решение владельца 08.10.2026, п. 4):
// входят в ревизию паспорта, не влияют на движок рисков, исполнителю
// автоматически не передаются; сводка исполнителя — по явному списку полей
// (п. 3). Регрессии ревизии/сверки/комплекта на уровне базы — DB4-96.

const llmCalls: { passport: Passport; answers: Record<string, unknown> }[] = [];
vi.mock("@/lib/risks/llm", () => ({
  generateLlmRisks: vi.fn(async (passport: Passport, answers: Record<string, unknown>) => {
    llmCalls.push({ passport, answers });
    return { ok: false, cards: [], error: "ai_disabled" };
  }),
}));

const { buildPassport, passportForRiskEngine } = await import("@/lib/brief/passport");
const { runRiskPipeline } = await import("@/lib/brief/pipeline");
const { evaluateRules } = await import("@/lib/risks/rules");
const { contractorPassport, canonicalJson } = await import("@/lib/project-room/handover");

const base: AnswersMap = {
  object: { type: "flat", area_m2: 64, city: "Казань" },
  asset_horizon: "self_long",
  household: ["alone_or_couple"],
  morning: "high_1bath",
  cooking: "heavy",
  storage: ["clothes", "sport", "tech"],
  budget: { range: [500_000, 900_000] },
  timeline: "urgent",
  style: { refs: [], anti: [], notes: "минимализм, мрамор" },
  pain: "мало хранения",
} as unknown as AnswersMap;

const SECRET_COMMENT = "Готовлю каждый день на шестерых, звоните +7 900 111-22-33, бюджет 4 500 000 ₽";

function withComments(comments: Record<string, string>): AnswersMap {
  return { ...base, comments } as unknown as AnswersMap;
}

describe("passport clarifications", () => {
  it("keeps a unique comments.cooking in the passport, bound to its question", () => {
    const without = buildPassport(base);
    const withNote = buildPassport(withComments({ cooking: SECRET_COMMENT }));
    expect(without.clarifications).toBeUndefined();
    expect(withNote.clarifications).toEqual([
      { question_id: "cooking", question: "Готовите дома?", text: SECRET_COMMENT },
    ]);
    // Остальной паспорт не меняется.
    expect(canonicalJson(passportForRiskEngine(withNote))).toBe(canonicalJson(without));
  });

  it("keeps each comment in its own question context, custom questions included", () => {
    const passport = buildPassport(
      withComments({ custom_1: "Нужен кабинет", pain: "  шумно  ", storage: "лыжи", custom_7: "старый вопрос", cooking: " " }),
      {
        customQuestions: [
          { type: "text", title: "Первый свой вопрос" },
          { type: "text", title: "Где будете работать?" },
        ] as never,
      },
    );
    expect(passport.clarifications).toEqual([
      { question_id: "storage", question: "Что сейчас не помещается?", text: "лыжи" },
      { question_id: "pain", question: "Что больше всего раздражает в текущем жилье?", text: "шумно" },
      { question_id: "custom_1", question: "Где будете работать?", text: "Нужен кабинет" },
      { question_id: "custom_7", question: null, text: "старый вопрос" },
    ]);
  });

  it("does not change the risk engine input or its cards", async () => {
    const plainCards = evaluateRules(buildPassport(base), base);
    llmCalls.length = 0;
    const result = await runRiskPipeline(withComments({ cooking: SECRET_COMMENT }));
    expect(result.passport.clarifications?.[0]?.question_id).toBe("cooking");
    expect(result.cards).toEqual(plainCards);
    expect(plainCards.length).toBeGreaterThan(0);
    expect(llmCalls).toHaveLength(1);
    // Ни паспорт, ни сырые ответы, уходящие в LLM, не несут комментариев.
    expect(llmCalls[0]!.passport).not.toHaveProperty("clarifications");
    expect(llmCalls[0]!.answers).not.toHaveProperty("comments");
    expect(JSON.stringify(llmCalls[0])).not.toContain("шестерых");
    // Входы движка совпадают с входами без комментариев.
    llmCalls.length = 0;
    await runRiskPipeline(base);
    const plainCall = llmCalls[0]!;
    llmCalls.length = 0;
    await runRiskPipeline(withComments({ cooking: SECRET_COMMENT, storage: "лыжи" }));
    expect(canonicalJson(llmCalls[0])).toBe(canonicalJson(plainCall));
  });
});

describe("contractor passport allowlist", () => {
  it("never carries clarifications with synthetic contacts or sums", () => {
    const summary = contractorPassport(buildPassport(withComments({ cooking: SECRET_COMMENT, pain: "test@clarify.test" })));
    const json = JSON.stringify(summary);
    expect(summary).not.toHaveProperty("clarifications");
    expect(json).not.toMatch(/шестерых|900 111|4 500 000|clarify\.test/);
  });

  it("drops unknown top-level and nested fields", () => {
    const passport = {
      ...buildPassport(base),
      future_field: { phone: "+7 900 222-33-44" },
      object: { type: "flat", area_m2: 64, city: "Казань", owner_phone: "+7 900 333-44-55" },
      lifestyle: { morning_load: "high", bathrooms: 1, cooking: "heavy", storage_pressure: "high", private: { email: "a@b.test" } },
      style: { refs: ["https://ref.test/1", { url: "x", note: "+7 900 444-55-66" }], anti: [], notes: "" },
      rooms: { kitchen: { layout: "island", owner_note: "звонить" }, bath: { count: "two" }, secret: "+7 900 555-66-77" },
      budget: { range: [1, 2], risk_level: "mid", includes_furniture: "yes", exact: 4_500_000 },
      scope: { package: "full", price: 100 },
    } as unknown as Passport;
    const summary = contractorPassport(passport) as unknown as Record<string, unknown>;
    expect(Object.keys(summary).sort()).toEqual(
      ["asset_horizon", "budget", "household", "lifestyle", "object", "pain_points", "rooms", "scope", "style", "timeline"],
    );
    expect(summary.object).toEqual({ type: "flat", area_m2: 64, city: "Казань" });
    expect(summary.lifestyle).toEqual({ morning_load: "high", bathrooms: 1, cooking: "heavy", storage_pressure: "high" });
    expect(summary.rooms).toEqual({ kitchen: { layout: "island" }, bath: { count: "two" } });
    expect(summary.budget).toEqual({ range: "undisclosed", risk_level: "mid" });
    expect(summary.scope).toEqual({ package: "full" });
    expect((summary.style as { refs: unknown[] }).refs).toEqual(["https://ref.test/1"]);
    expect(JSON.stringify(summary)).not.toMatch(/900 [2-5]|b\.test|звонить|4500000|"price"/);
  });

  it("gives the same summary as before for a passport without new fields", () => {
    const passport = buildPassport(base);
    const legacy = {
      ...passport,
      contact: undefined,
      source: undefined,
      vision: undefined,
      asset_horizon: "unknown",
      budget: { range: "undisclosed", risk_level: passport.budget.risk_level },
      pain_points: "",
      household: { now: "", in_5y: "", kids: passport.household.kids, pets: passport.household.pets },
    };
    expect(canonicalJson(contractorPassport(passport))).toBe(canonicalJson(legacy));
  });
});
