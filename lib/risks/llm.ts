import type { Passport, RiskCard } from "@/lib/types";
import { completeJSON } from "@/lib/llm/provider";
import { RiskCardsLlmSchema } from "./schema";

// Слой 2 — LLM-проход. Один серверный вызов с паспортом + сырыми ответами.
// Промпт требует строго JSON-массив карточек по схеме risk_card.

// PII-редакция: в LLM НЕ уходят город, район, контакты и пути к файлам.
// Rule-карточки и так закрывают базу; для анализа рисков локация не нужна.

// ── Маскировка идентификаторов в свободном тексте ──
// «Видение», боли, заметки о стиле, голосовые комментарии — там клиент легко
// впишет телефон, почту, @-ник или адрес. Имена/адреса полностью так не
// вычистить, но прямые контакты убираем (152-ФЗ: минимизируем, что уходит в
// сторонний LLM).
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// РФ-телефон: +7 / 7 / 8, затем 10 цифр в любом разделении пробел/дефис/скобки.
const PHONE_RE = /(?:\+?7|8)[\s\-()]*\d(?:[\s\-()]*\d){9}/g;
const HANDLE_RE = /(?<![\w@/.])@[a-zA-Z][a-zA-Z0-9_]{2,}/g;
// Длинная цифровая последовательность (7+), не пойманная как телефон.
const LONGNUM_RE = /\d[\d\s\-]{5,}\d/g;

function scrubText(s: string): string {
  return s
    .replace(EMAIL_RE, "[email]")
    .replace(PHONE_RE, "[телефон]")
    .replace(HANDLE_RE, "[контакт]")
    .replace(LONGNUM_RE, "[номер]");
}

// Рекурсивно чистит все строки в структуре, КРОМЕ ссылок-референсов (refs) —
// это URL, их маскировать нельзя.
function scrubDeep(v: unknown, key?: string): unknown {
  if (typeof v === "string") return key === "refs" ? v : scrubText(v);
  if (Array.isArray(v)) return v.map((x) => scrubDeep(x, key));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, scrubDeep(val, k)]));
  }
  return v;
}

function redactPassport(passport: Passport): Passport {
  const { city: _city, district: _district, ...object } = passport.object;
  const { contact: _contact, ...rest } = passport;
  return scrubDeep({ ...rest, object }) as Passport;
}

function redactAnswers(answers: Record<string, unknown>): Record<string, unknown> {
  const { contact: _c, attachments: _a, ...rest } = answers;
  const objectAns = rest["object"];
  if (objectAns && typeof objectAns === "object" && !Array.isArray(objectAns)) {
    const { city: _city, district: _district, ...obj } = objectAns as Record<string, unknown>;
    return scrubDeep({ ...rest, object: obj }) as Record<string, unknown>;
  }
  return scrubDeep(rest) as Record<string, unknown>;
}

export function buildRiskPrompt(passport: Passport, answers: Record<string, unknown>): string {
  const safePassport = redactPassport(passport);
  const safeAnswers = redactAnswers(answers);
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
${JSON.stringify(safePassport, null, 2)}

СЫРЫЕ ОТВЕТЫ КЛИЕНТА:
${JSON.stringify(safeAnswers, null, 2)}`;
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
