import type { Passport, RiskCard, AnswersMap } from "@/lib/types";
import { buildPassport } from "@/lib/brief/passport";
import { evaluateRules } from "@/lib/risks/rules";
import { generateLlmRisks } from "@/lib/risks/llm";
import { dedupeRisks } from "@/lib/risks/dedupe";

export interface RiskPipelineResult {
  passport: Passport;
  cards: RiskCard[];
  llmOk: boolean; // false → сработала деградация, показаны только rule-карточки
  llmError?: string;
}

// Полный проход брифа: buildPassport → слой правил → LLM-проход → дедуп.
// Обязательная деградация: LLM недоступен/вернул мусор → только rule-карточки,
// UX не падает.
export async function runRiskPipeline(answers: AnswersMap): Promise<RiskPipelineResult> {
  const passport = buildPassport(answers);
  const ruleCards = evaluateRules(passport, answers);

  const llm = await generateLlmRisks(passport, answers);
  if (!llm.ok) {
    return { passport, cards: ruleCards, llmOk: false, llmError: llm.error };
  }

  const cards = dedupeRisks(ruleCards, llm.cards);
  return { passport, cards, llmOk: true };
}
