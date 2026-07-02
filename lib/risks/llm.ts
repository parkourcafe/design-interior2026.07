import type { Passport, RiskCard } from "@/lib/types";
import { completeJSON } from "@/lib/llm/provider";
import { RiskCardsLlmSchema } from "./schema";

// Слой 2 — LLM-проход. Один серверный вызов с паспортом + сырыми ответами.
// Промпт требует строго JSON-массив карточек по схеме risk_card.

export function buildRiskPrompt(passport: Passport, answers: Record<string, unknown>): string {
  return `Ты — ассистент интерьерного дизайнера. По паспорту проекта и ответам клиента найди возможные РИСКИ и ПРОТИВОРЕЧИЯ (бюджет, сроки, функция, стиль, технические).

Тон строго: «Возможный риск… Рекомендуем обсудить…». НИКОГДА не пиши «клиент противоречит себе». Ты предлагаешь — дизайнер решает.

Верни ТОЛЬКО валидный JSON-массив (без markdown, без пояснений). Каждый элемент строго по схеме:
{
  "risk_type": "budget" | "timeline" | "function" | "style" | "technical",
  "evidence": string[],            // конкретные ответы клиента, из которых следует риск
  "impact": string,                // на что влияет: цена, сроки, планировка, состав работ
  "confidence": "low" | "medium" | "high",
  "designer_action": string,       // что уточнить на первой встрече
  "proposal_implication": string   // что включить в условия или exclusions КП
}

Не выдумывай факты сверх данных. Если явных рисков нет — верни [].

ПАСПОРТ ПРОЕКТА:
${JSON.stringify(passport, null, 2)}

СЫРЫЕ ОТВЕТЫ КЛИЕНТА:
${JSON.stringify(answers, null, 2)}`;
}

export interface LlmRisksResult {
  ok: boolean;
  cards: RiskCard[];
  error?: string;
  repaired?: boolean;
}

// Возвращает LLM-карточки как RiskCard[] (source='llm'). При провале ok=false и
// пустой список — вызывающий код деградирует к rule-карточкам.
export async function generateLlmRisks(
  passport: Passport,
  answers: Record<string, unknown>,
): Promise<LlmRisksResult> {
  const result = await completeJSON(buildRiskPrompt(passport, answers), RiskCardsLlmSchema);
  if (!result.ok) return { ok: false, cards: [], error: result.error };

  const cards: RiskCard[] = result.data.map((c) => ({ ...c, source: "llm" as const }));
  return { ok: true, cards, repaired: result.repaired };
}
