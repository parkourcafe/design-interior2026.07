import type { RiskCard } from "@/lib/types";

// Дедупликация карточек слоёв 1 (rule) и 2 (llm). Rule-карточки авторитетнее
// (детерминированы, confidence='high'): если LLM выдал карточку того же типа с
// пересекающимися основаниями — оставляем rule-версию.

// Unicode-aware разбивка на слова: \w/\W в JS не считают кириллицу словом,
// поэтому режем по не-буквам/не-цифрам с флагом u.
const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(WORD_SPLIT)
    .filter((w) => w.length > 4);
}

function overlaps(a: RiskCard, b: RiskCard): boolean {
  if (a.risk_type !== b.risk_type) return false;
  const textA = a.evidence.join(" ") + " " + a.impact;
  const textB = b.evidence.join(" ") + " " + b.impact;
  // грубая мера пересечения по значимым словам (учёт словоформ: сравниваем
  // по 6-символьному префиксу, чтобы «материалы»/«материалов» совпадали).
  const stem = (w: string) => w.slice(0, 6);
  const wordsB = new Set(significantWords(textB).map(stem));
  let hits = 0;
  for (const w of significantWords(textA)) {
    if (wordsB.has(stem(w))) hits++;
  }
  return hits >= 2;
}

export function dedupeRisks(ruleCards: RiskCard[], llmCards: RiskCard[]): RiskCard[] {
  const kept: RiskCard[] = [...ruleCards];
  for (const llm of llmCards) {
    if (!ruleCards.some((rule) => overlaps(rule, llm))) {
      kept.push(llm);
    }
  }
  return kept;
}
