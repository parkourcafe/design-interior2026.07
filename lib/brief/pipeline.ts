import type { Passport, RiskCard, AnswersMap } from "@/lib/types";
import { buildPassport, passportForRiskEngine, type PassportContext } from "@/lib/brief/passport";
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
// UX не падает. Уточнения клиента (комментарии к вопросам) на движок рисков не
// влияют (ТЗ 08.10, FIX-03; решение владельца 08.10.2026, п. 4): ни правила,
// ни LLM не получают ни passport.clarifications, ни сырые answers.comments.
export async function runRiskPipeline(answers: AnswersMap, context: PassportContext = {}): Promise<RiskPipelineResult> {
  const passport = buildPassport(answers, context);
  const engineInput = passportForRiskEngine(passport);
  const { comments: _comments, ...engineAnswers } = answers;
  const ruleCards = evaluateRules(engineInput, engineAnswers);

  const llm = await generateLlmRisks(engineInput, engineAnswers);
  if (!llm.ok) {
    return { passport, cards: ruleCards, llmOk: false, llmError: llm.error };
  }

  const cards = dedupeRisks(ruleCards, llm.cards);
  return { passport, cards, llmOk: true };
}
